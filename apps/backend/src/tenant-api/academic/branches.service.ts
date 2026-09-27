import type { Branch } from '@acadlyx/types';
import { Injectable } from '@nestjs/common';
import { isUniqueViolation } from '../../common/errors/domain-errors.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import { ACADEMIC_ERRORS } from './academic-errors.js';
import { AcademicStore, changedFields, definedOnly, toBranch } from './academic-store.js';
import type { CreateBranchDto, ListBranchesQueryDto, UpdateBranchDto } from './academic.dto.js';

/**
 * Branches (campuses). Invariant: once a school has any branch, exactly one is primary and the
 * primary is active (partial unique index + CHECK; the first branch becomes primary). Branches
 * are deactivated, never deleted — later phases reference them.
 */
@Injectable()
export class BranchesService {
  constructor(private readonly store: AcademicStore) {}

  list(query: ListBranchesQueryDto): Promise<Branch[]> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const rows = await tx.branch.findMany({
        where: {
          schoolId: school.id,
          ...(query.active ? { isActive: query.active === 'true' } : {}),
          ...(query.q
            ? {
                OR: [
                  { name: { contains: query.q, mode: 'insensitive' } },
                  { code: { contains: query.q.toUpperCase() } },
                  { city: { contains: query.q, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }, { id: 'asc' }],
      });
      return rows.map(toBranch);
    });
  }

  get(id: string): Promise<Branch> {
    return this.store.run(async (tx) => toBranch(await this.find(tx, id)));
  }

  async create(dto: CreateBranchDto): Promise<Branch> {
    return this.guard(() =>
      this.store.mutate(async (tx, school, events) => {
        await this.assertCodeFree(tx, school.id, dto.code);
        const first = (await tx.branch.count({ where: { schoolId: school.id } })) === 0;
        const created = await tx.branch.create({
          data: {
            ...definedOnly(dto),
            name: dto.name,
            code: dto.code,
            tenantId: school.tenantId,
            schoolId: school.id,
            timezone: dto.timezone ?? school.timezone,
            isPrimary: first,
            isActive: true,
          },
        });
        events.push({
          action: 'BRANCH_CREATED',
          resourceType: 'branch',
          resourceId: created.id,
          changedFields: Object.keys(definedOnly(dto)),
          metadata: { code: created.code, isPrimary: first },
        });
        return toBranch(created);
      }),
    );
  }

  async update(id: string, dto: UpdateBranchDto): Promise<Branch> {
    return this.guard(() =>
      this.store.mutate(async (tx, school, events) => {
        const branch = await this.find(tx, id);
        const patch = definedOnly(dto);
        if (patch.code && patch.code !== branch.code)
          await this.assertCodeFree(tx, school.id, patch.code);
        const fields = changedFields(branch, patch);
        if (fields.length === 0) return toBranch(branch);
        const updated = await tx.branch.update({ where: { id: branch.id }, data: patch });
        events.push({
          action: 'BRANCH_UPDATED',
          resourceType: 'branch',
          resourceId: id,
          changedFields: fields,
        });
        return toBranch(updated);
      }),
    );
  }

  setActive(id: string, active: boolean): Promise<Branch> {
    return this.store.mutate(async (tx, _school, events) => {
      const branch = await this.find(tx, id);
      if (branch.isActive === active) return toBranch(branch);
      if (!active && branch.isPrimary) throw ACADEMIC_ERRORS.primaryBranchRequired();
      const updated = await tx.branch.update({ where: { id }, data: { isActive: active } });
      events.push({
        action: active ? 'BRANCH_ACTIVATED' : 'BRANCH_DEACTIVATED',
        resourceType: 'branch',
        resourceId: id,
        changedFields: ['isActive'],
      });
      return toBranch(updated);
    });
  }

  /** Atomic switch: the previous primary is unset and the new one set in the same transaction. */
  setPrimary(id: string): Promise<Branch> {
    return this.store.mutate(async (tx, school, events) => {
      const branch = await this.find(tx, id);
      if (branch.isPrimary) return toBranch(branch);
      if (!branch.isActive) throw ACADEMIC_ERRORS.branchInactive();
      const previous = await tx.branch.findFirst({
        where: { schoolId: school.id, isPrimary: true },
      });
      await tx.branch.updateMany({
        where: { schoolId: school.id, isPrimary: true },
        data: { isPrimary: false },
      });
      const updated = await tx.branch.update({ where: { id }, data: { isPrimary: true } });
      events.push({
        action: 'PRIMARY_BRANCH_CHANGED',
        resourceType: 'branch',
        resourceId: id,
        changedFields: ['isPrimary'],
        metadata: { previousPrimaryBranchId: previous?.id ?? null },
      });
      return toBranch(updated);
    });
  }

  private async find(tx: TenantTransaction, id: string) {
    const school = await this.store.school(tx);
    const branch = await tx.branch.findFirst({ where: { id, schoolId: school.id } });
    if (!branch) throw ACADEMIC_ERRORS.branchNotFound();
    return branch;
  }

  private async assertCodeFree(
    tx: TenantTransaction,
    schoolId: string,
    code: string,
  ): Promise<void> {
    if (await tx.branch.findFirst({ where: { schoolId, code }, select: { id: true } }))
      throw ACADEMIC_ERRORS.duplicateBranchCode();
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (isUniqueViolation(error, 'branches_school_id_code_key'))
        throw ACADEMIC_ERRORS.duplicateBranchCode();
      throw error;
    }
  }
}
