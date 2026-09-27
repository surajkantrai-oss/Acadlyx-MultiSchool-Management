import type { Paginated } from '@acadlyx/tenant-config';
import type { ParentDetail, ParentSummary } from '@acadlyx/types';
import { Injectable } from '@nestjs/common';
import { isUniqueViolation } from '../../common/errors/domain-errors.js';
import type { Prisma, School } from '../../generated/prisma/client.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import { AcademicStore, changedFields, definedOnly } from '../academic/academic-store.js';
import { PEOPLE_ERRORS } from './people-errors.js';
import {
  ACCOUNT_SELECT,
  fullNameSearch,
  nameSearch,
  normalizeContact,
  paginated,
  paging,
  toAccount,
} from './people-mappers.js';
import type { CreateParentDto, PagingQueryDto, UpdateParentDto } from './people.dto.js';
import { toGuardianLink } from './students.service.js';

const LIST_INCLUDE = { user: ACCOUNT_SELECT, _count: { select: { children: true } } } as const;

/**
 * Parent/guardian profiles. Contact data is NOT unique (families share phones/emails); the only
 * school-unique key is the optional parent_code, which imports use to identify a parent.
 */
@Injectable()
export class ParentsService {
  constructor(private readonly store: AcademicStore) {}

  list(query: PagingQueryDto & { active?: boolean }): Promise<Paginated<ParentSummary>> {
    const { page, pageSize, skip, take } = paging(query);
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const digits = (query.q ?? '').replace(/\D/g, '');
      const where: Prisma.ParentWhereInput = {
        schoolId: school.id,
        ...(query.q
          ? {
              OR: [
                ...nameSearch(query.q),
                ...fullNameSearch(query.q),
                { email: { contains: query.q.toLowerCase() } },
                { parentCode: { contains: query.q.toUpperCase() } },
                ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
              ],
            }
          : {}),
      };
      const [total, rows] = await Promise.all([
        tx.parent.count({ where }),
        tx.parent.findMany({
          where,
          include: LIST_INCLUDE,
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
          skip,
          take,
        }),
      ]);
      return paginated(rows.map(summary), total, page, pageSize);
    });
  }

  get(id: string): Promise<ParentDetail> {
    return this.store.run((tx) => this.detail(tx, id));
  }

  create(dto: CreateParentDto): Promise<ParentDetail> {
    return this.guard(() =>
      this.store.transact(async (tx, school, events) => {
        const parent = await this.createIn(tx, school, dto);
        events.push({
          action: 'PARENT_CREATED',
          resourceType: 'parent',
          resourceId: parent,
          changedFields: Object.keys(definedOnly(dto)),
        });
        return this.detail(tx, parent);
      }),
    );
  }

  /** Shared with the import worker. */
  async createIn(tx: TenantTransaction, school: School, dto: CreateParentDto): Promise<string> {
    if (
      dto.parentCode &&
      (await tx.parent.findFirst({ where: { schoolId: school.id, parentCode: dto.parentCode } }))
    )
      throw PEOPLE_ERRORS.duplicateParentCode();
    const contact = normalizeContact({ email: dto.email ?? null, phone: dto.phone ?? null });
    const parent = await tx.parent.create({
      data: {
        tenantId: school.tenantId,
        schoolId: school.id,
        parentCode: dto.parentCode ?? null,
        firstName: dto.firstName,
        middleName: dto.middleName ?? null,
        lastName: dto.lastName ?? null,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
      },
    });
    return parent.id;
  }

  update(id: string, dto: UpdateParentDto): Promise<ParentDetail> {
    return this.guard(() =>
      this.store.transact(async (tx, school, events) => {
        const parent = await this.find(tx, school, id);
        const patch = { ...definedOnly(dto), ...normalizeContact(dto) };
        const fields = changedFields(parent, patch);
        if (fields.length > 0) {
          if (patch.parentCode && patch.parentCode !== parent.parentCode) {
            if (
              await tx.parent.findFirst({
                where: { schoolId: school.id, parentCode: patch.parentCode },
              })
            )
              throw PEOPLE_ERRORS.duplicateParentCode();
          }
          await tx.parent.update({ where: { id }, data: patch });
          events.push({
            action: 'PARENT_UPDATED',
            resourceType: 'parent',
            resourceId: id,
            changedFields: fields,
          });
        }
        return this.detail(tx, id);
      }),
    );
  }

  /** Deactivation keeps links and history; the login account is not touched. */
  setActive(id: string, active: boolean): Promise<ParentDetail> {
    return this.store.transact(async (tx, school, events) => {
      const parent = await this.find(tx, school, id);
      if (parent.isActive !== active) {
        await tx.parent.update({ where: { id }, data: { isActive: active } });
        events.push({
          action: active ? 'PARENT_ACTIVATED' : 'PARENT_DEACTIVATED',
          resourceType: 'parent',
          resourceId: id,
          changedFields: ['isActive'],
        });
      }
      return this.detail(tx, id);
    });
  }

  private async find(tx: TenantTransaction, school: School, id: string) {
    const parent = await tx.parent.findFirst({ where: { id, schoolId: school.id } });
    if (!parent) throw PEOPLE_ERRORS.parentNotFound();
    return parent;
  }

  private async detail(tx: TenantTransaction, id: string): Promise<ParentDetail> {
    const school = await this.store.school(tx);
    const r = await tx.parent.findFirst({
      where: { id, schoolId: school.id },
      include: {
        ...LIST_INCLUDE,
        children: { include: { student: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!r) throw PEOPLE_ERRORS.parentNotFound();
    return {
      ...summary(r),
      children: r.children.map((c) => ({
        ...toGuardianLink(c),
        student: {
          id: c.student.id,
          admissionNumber: c.student.admissionNumber,
          firstName: c.student.firstName,
          middleName: c.student.middleName,
          lastName: c.student.lastName,
          status: c.student.status,
        },
      })),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (isUniqueViolation(error, 'parents_school_parent_code_key'))
        throw PEOPLE_ERRORS.duplicateParentCode();
      throw error;
    }
  }
}

function summary(r: Prisma.ParentGetPayload<{ include: typeof LIST_INCLUDE }>): ParentSummary {
  return {
    id: r.id,
    parentCode: r.parentCode,
    firstName: r.firstName,
    middleName: r.middleName,
    lastName: r.lastName,
    email: r.email,
    phone: r.phone,
    isActive: r.isActive,
    account: toAccount(r.user),
    childrenCount: r._count.children,
  };
}
