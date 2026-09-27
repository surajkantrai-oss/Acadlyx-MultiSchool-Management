import type { Paginated } from '@acadlyx/tenant-config';
import type { TeacherAssignment, TeacherDetail, TeacherSummary } from '@acadlyx/types';
import { Injectable } from '@nestjs/common';
import { isUniqueViolation } from '../../common/errors/domain-errors.js';
import type { Prisma, School } from '../../generated/prisma/client.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import {
  AcademicStore,
  changedFields,
  definedOnly,
  fromIsoDate,
  isoDate,
} from '../academic/academic-store.js';
import { PEOPLE_ERRORS } from './people-errors.js';
import {
  ACCOUNT_SELECT,
  fullNameSearch,
  nameSearch,
  normalizeContact,
  paginated,
  paging,
  SECTION_CONTEXT,
  toAccount,
  toAssignment,
} from './people-mappers.js';
import type {
  CreateAssignmentDto,
  CreateTeacherDto,
  TeacherListQueryDto,
  TeacherStatusDto,
  UpdateTeacherDto,
} from './people.dto.js';

const LIST_INCLUDE = {
  user: ACCOUNT_SELECT,
  _count: { select: { assignments: { where: { endedAt: null } } } },
} as const;
const ASSIGNMENT_INCLUDE = { section: SECTION_CONTEXT, subject: true } as const;

/**
 * Teacher profiles (ACTIVE/INACTIVE only — no HR workflow) and their section/subject
 * assignments. Ending an assignment keeps it as history (ended_at).
 */
@Injectable()
export class TeachersService {
  constructor(private readonly store: AcademicStore) {}

  list(query: TeacherListQueryDto): Promise<Paginated<TeacherSummary>> {
    const { page, pageSize, skip, take } = paging(query);
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const where: Prisma.TeacherWhereInput = {
        schoolId: school.id,
        ...(query.status ? { status: query.status } : {}),
        ...(query.q
          ? {
              OR: [
                ...nameSearch(query.q),
                ...fullNameSearch(query.q),
                { employeeId: { contains: query.q.toUpperCase() } },
                { email: { contains: query.q.toLowerCase() } },
              ],
            }
          : {}),
      };
      const [total, rows] = await Promise.all([
        tx.teacher.count({ where }),
        tx.teacher.findMany({
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

  get(id: string): Promise<TeacherDetail> {
    return this.store.run((tx) => this.detail(tx, id));
  }

  create(dto: CreateTeacherDto): Promise<TeacherDetail> {
    return this.guard(() =>
      this.store.transact(async (tx, school, events) => {
        const id = await this.createIn(tx, school, dto);
        events.push({
          action: 'TEACHER_CREATED',
          resourceType: 'teacher',
          resourceId: id,
          changedFields: Object.keys(definedOnly(dto)),
        });
        return this.detail(tx, id);
      }),
    );
  }

  /** Shared with the import worker. */
  async createIn(tx: TenantTransaction, school: School, dto: CreateTeacherDto): Promise<string> {
    if (await tx.teacher.findFirst({ where: { schoolId: school.id, employeeId: dto.employeeId } }))
      throw PEOPLE_ERRORS.duplicateEmployeeId();
    const contact = normalizeContact({ email: dto.email ?? null, phone: dto.phone ?? null });
    const teacher = await tx.teacher.create({
      data: {
        tenantId: school.tenantId,
        schoolId: school.id,
        employeeId: dto.employeeId,
        firstName: dto.firstName,
        middleName: dto.middleName ?? null,
        lastName: dto.lastName ?? null,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
        joiningDate: dto.joiningDate ? fromIsoDate(dto.joiningDate) : null,
      },
    });
    return teacher.id;
  }

  update(id: string, dto: UpdateTeacherDto): Promise<TeacherDetail> {
    return this.guard(() =>
      this.store.transact(async (tx, school, events) => {
        const teacher = await this.find(tx, school, id);
        const patch = definedOnly({
          ...definedOnly(dto),
          ...normalizeContact(dto),
          joiningDate:
            dto.joiningDate === undefined
              ? undefined
              : dto.joiningDate
                ? fromIsoDate(dto.joiningDate)
                : null,
        });
        const fields = changedFields(teacher, patch);
        if (fields.length > 0) {
          if (patch.employeeId && patch.employeeId !== teacher.employeeId) {
            if (
              await tx.teacher.findFirst({
                where: { schoolId: school.id, employeeId: patch.employeeId },
              })
            )
              throw PEOPLE_ERRORS.duplicateEmployeeId();
          }
          await tx.teacher.update({ where: { id }, data: patch });
          events.push({
            action: 'TEACHER_UPDATED',
            resourceType: 'teacher',
            resourceId: id,
            changedFields: fields,
          });
        }
        return this.detail(tx, id);
      }),
    );
  }

  /** Profile status only — the login account is a separate lifecycle and is not changed. */
  setStatus(id: string, dto: TeacherStatusDto): Promise<TeacherDetail> {
    return this.store.transact(async (tx, school, events) => {
      const teacher = await this.find(tx, school, id);
      if (teacher.status !== dto.status) {
        await tx.teacher.update({ where: { id }, data: { status: dto.status } });
        events.push({
          action: 'TEACHER_STATUS_CHANGED',
          resourceType: 'teacher',
          resourceId: id,
          changedFields: ['status'],
          metadata: { from: teacher.status, to: dto.status },
        });
      }
      return this.detail(tx, id);
    });
  }

  assignments(teacherId: string, includeEnded: boolean): Promise<TeacherAssignment[]> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      await this.find(tx, school, teacherId);
      const rows = await tx.teacherAssignment.findMany({
        where: { teacherId, ...(includeEnded ? {} : { endedAt: null }) },
        include: ASSIGNMENT_INCLUDE,
        orderBy: [{ endedAt: { sort: 'desc', nulls: 'first' } }, { startedAt: 'desc' }],
      });
      return rows.map(toAssignment);
    });
  }

  /**
   * Rules: teacher ACTIVE; section of this school usable (active section/branch/grade, year not
   * CLOSED); SUBJECT_TEACHER needs a subject mapped to the section's grade (GradeSubject);
   * CLASS_TEACHER has no subject and at most one is active per section. Co-teaching allowed.
   */
  assign(teacherId: string, dto: CreateAssignmentDto): Promise<TeacherDetail> {
    return this.guard(() =>
      this.store.transact(async (tx, school, events) => {
        const teacher = await this.find(tx, school, teacherId);
        if (teacher.status !== 'ACTIVE') throw PEOPLE_ERRORS.teacherInactive();
        const section = await tx.section.findFirst({
          where: { id: dto.sectionId, schoolId: school.id },
          ...SECTION_CONTEXT,
        });
        if (!section) throw PEOPLE_ERRORS.sectionNotFound();
        if (
          !section.isActive ||
          !section.branch.isActive ||
          !section.grade.isActive ||
          section.academicYear.status === 'CLOSED'
        )
          throw PEOPLE_ERRORS.sectionUnavailable();
        if (dto.type === 'SUBJECT_TEACHER') {
          if (!dto.subjectId) throw PEOPLE_ERRORS.subjectRequired();
          const subject = await tx.subject.findFirst({
            where: { id: dto.subjectId, schoolId: school.id },
          });
          if (!subject) throw PEOPLE_ERRORS.subjectNotFound();
          const mapped = await tx.gradeSubject.findFirst({
            where: { gradeId: section.gradeId, subjectId: subject.id },
          });
          if (!mapped || !subject.isActive) throw PEOPLE_ERRORS.subjectNotInGrade();
          if (
            await tx.teacherAssignment.findFirst({
              where: { teacherId, sectionId: section.id, subjectId: subject.id, endedAt: null },
            })
          )
            throw PEOPLE_ERRORS.duplicateAssignment();
        } else {
          if (dto.subjectId) throw PEOPLE_ERRORS.subjectNotAllowed();
          if (
            await tx.teacherAssignment.findFirst({
              where: { sectionId: section.id, type: 'CLASS_TEACHER', endedAt: null },
            })
          )
            throw PEOPLE_ERRORS.classTeacherExists();
        }
        const created = await tx.teacherAssignment.create({
          data: {
            tenantId: school.tenantId,
            schoolId: school.id,
            teacherId,
            sectionId: section.id,
            subjectId: dto.type === 'SUBJECT_TEACHER' ? (dto.subjectId ?? null) : null,
            type: dto.type,
          },
        });
        events.push({
          action: 'TEACHER_ASSIGNMENT_CREATED',
          resourceType: 'teacher_assignment',
          resourceId: created.id,
          metadata: {
            teacherId,
            sectionId: section.id,
            subjectId: created.subjectId,
            type: dto.type,
          },
        });
        return this.detail(tx, teacherId);
      }),
    );
  }

  endAssignment(teacherId: string, assignmentId: string): Promise<TeacherDetail> {
    return this.store.transact(async (tx, school, events) => {
      const a = await tx.teacherAssignment.findFirst({
        where: { id: assignmentId, teacherId, schoolId: school.id },
      });
      if (!a) throw PEOPLE_ERRORS.assignmentNotFound();
      if (a.endedAt) throw PEOPLE_ERRORS.assignmentEnded();
      await tx.teacherAssignment.update({ where: { id: a.id }, data: { endedAt: new Date() } });
      events.push({
        action: 'TEACHER_ASSIGNMENT_REMOVED',
        resourceType: 'teacher_assignment',
        resourceId: a.id,
        changedFields: ['endedAt'],
        metadata: { teacherId, sectionId: a.sectionId, subjectId: a.subjectId, type: a.type },
      });
      return this.detail(tx, teacherId);
    });
  }

  private async find(tx: TenantTransaction, school: School, id: string) {
    const teacher = await tx.teacher.findFirst({ where: { id, schoolId: school.id } });
    if (!teacher) throw PEOPLE_ERRORS.teacherNotFound();
    return teacher;
  }

  private async detail(tx: TenantTransaction, id: string): Promise<TeacherDetail> {
    const school = await this.store.school(tx);
    const r = await tx.teacher.findFirst({
      where: { id, schoolId: school.id },
      include: {
        ...LIST_INCLUDE,
        assignments: {
          include: ASSIGNMENT_INCLUDE,
          orderBy: [{ endedAt: { sort: 'desc', nulls: 'first' } }, { startedAt: 'desc' }],
        },
      },
    });
    if (!r) throw PEOPLE_ERRORS.teacherNotFound();
    return {
      ...summary(r),
      joiningDate: r.joiningDate ? isoDate(r.joiningDate) : null,
      assignments: r.assignments.map(toAssignment),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (isUniqueViolation(error, 'teachers_school_id_employee_id_key'))
        throw PEOPLE_ERRORS.duplicateEmployeeId();
      if (isUniqueViolation(error, 'teacher_assignments_active_subject_key'))
        throw PEOPLE_ERRORS.duplicateAssignment();
      if (isUniqueViolation(error, 'teacher_assignments_one_class_teacher'))
        throw PEOPLE_ERRORS.classTeacherExists();
      throw error;
    }
  }
}

function summary(r: Prisma.TeacherGetPayload<{ include: typeof LIST_INCLUDE }>): TeacherSummary {
  return {
    id: r.id,
    employeeId: r.employeeId,
    firstName: r.firstName,
    middleName: r.middleName,
    lastName: r.lastName,
    email: r.email,
    phone: r.phone,
    status: r.status,
    account: toAccount(r.user),
    activeAssignments: r._count.assignments,
  };
}
