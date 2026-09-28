import type { Enrollment, GuardianLink, StudentDetail, StudentSummary } from '@acadlyx/types';
import type { Paginated } from '@acadlyx/tenant-config';
import { canTransitionStudent } from '@acadlyx/validation';
import { Injectable } from '@nestjs/common';
import { currentAuth } from '../../auth/core/access.guard.js';
import type { AuditEvent } from '../../common/audit/audit.service.js';
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
import { accountFilter, studentScope, withScope } from './people-scope.js';
import {
  ACCOUNT_SELECT,
  currentPlacement,
  fullNameSearch,
  nameSearch,
  paginated,
  paging,
  SECTION_CONTEXT,
  toAccount,
  toEnrollment,
} from './people-mappers.js';
import type {
  ChangeStudentStatusDto,
  CreateEnrollmentDto,
  CreateStudentDto,
  EndEnrollmentDto,
  LinkGuardianDto,
  StudentListQueryDto,
  TransferEnrollmentDto,
  UpdateGuardianDto,
  UpdateStudentDto,
} from './people.dto.js';

const STUDENT_LIST_INCLUDE = {
  user: ACCOUNT_SELECT,
  enrollments: { where: { status: 'ACTIVE' as const }, include: { section: SECTION_CONTEXT } },
} as const;

/** Today as a calendar date (UTC). */
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Student profiles, status lifecycle, guardian links and enrollments (Phase 5).
 * Invariants live in the database (unique admission number per school, one ACTIVE enrollment per
 * student per year, 0/1 primary guardian, composite school/tenant FKs); violations map to
 * domain errors. Nothing is deleted except a guardian link.
 */
@Injectable()
export class StudentsService {
  constructor(private readonly store: AcademicStore) {}

  list(query: StudentListQueryDto): Promise<Paginated<StudentSummary>> {
    const { page, pageSize, skip, take } = paging(query);
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const placement: Prisma.StudentEnrollmentWhereInput = definedOnly({
        status: 'ACTIVE' as const,
        sectionId: query.sectionId,
        academicYearId: query.academicYearId,
        section:
          query.branchId || query.gradeId
            ? definedOnly({ branchId: query.branchId, gradeId: query.gradeId })
            : undefined,
      });
      const filtered = Boolean(
        query.sectionId ?? query.academicYearId ?? query.branchId ?? query.gradeId,
      );
      // Data-quality filters (Phase 6) describe situations, not errors: an ACTIVE student with no
      // ACTIVE placement (in the chosen year, if any), or with no guardian linked.
      const quality: Prisma.StudentWhereInput =
        query.quality === 'NO_ENROLLMENT'
          ? {
              status: 'ACTIVE',
              enrollments: {
                none: definedOnly({
                  status: 'ACTIVE' as const,
                  academicYearId: query.academicYearId,
                }),
              },
            }
          : query.quality === 'NO_GUARDIAN'
            ? { status: 'ACTIVE', guardians: { none: {} } }
            : {};
      const base: Prisma.StudentWhereInput = {
        schoolId: school.id,
        ...(query.status ? { status: query.status } : {}),
        ...(filtered && query.quality !== 'NO_ENROLLMENT'
          ? { enrollments: { some: placement } }
          : {}),
        ...quality,
        ...accountFilter(query.account),
        ...(query.q
          ? {
              OR: [
                ...nameSearch(query.q),
                ...fullNameSearch(query.q),
                { preferredName: { contains: query.q, mode: 'insensitive' } },
                { admissionNumber: { contains: query.q.toUpperCase() } },
              ],
            }
          : {}),
      };
      const where = withScope(base, studentScope());
      const [total, rows] = await Promise.all([
        tx.student.count({ where }),
        tx.student.findMany({
          where,
          include: STUDENT_LIST_INCLUDE,
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
          skip,
          take,
        }),
      ]);
      return paginated(
        rows.map((r) => this.summary(r)),
        total,
        page,
        pageSize,
      );
    });
  }

  /** Read path: also applies the people data scope (out-of-scope ids are 404). */
  get(id: string): Promise<StudentDetail> {
    return this.store.run(async (tx) => {
      await this.visible(tx, id);
      return this.detail(tx, id);
    });
  }

  create(dto: CreateStudentDto): Promise<StudentDetail> {
    return this.guard(() =>
      this.store.transact(async (tx, school, events) => {
        if (
          await tx.student.findFirst({
            where: { schoolId: school.id, admissionNumber: dto.admissionNumber },
          })
        )
          throw PEOPLE_ERRORS.duplicateAdmissionNumber();
        const student = await tx.student.create({
          data: {
            tenantId: school.tenantId,
            schoolId: school.id,
            admissionNumber: dto.admissionNumber,
            firstName: dto.firstName,
            middleName: dto.middleName ?? null,
            lastName: dto.lastName ?? null,
            preferredName: dto.preferredName ?? null,
            dateOfBirth: dto.dateOfBirth ? fromIsoDate(dto.dateOfBirth) : null,
            admissionDate: dto.admissionDate ? fromIsoDate(dto.admissionDate) : null,
            status: 'ACTIVE',
          },
        });
        await tx.studentStatusHistory.create({
          data: {
            tenantId: school.tenantId,
            schoolId: school.id,
            studentId: student.id,
            fromStatus: null,
            toStatus: 'ACTIVE',
            reason: 'Created',
            changedByUserId: actor(),
          },
        });
        events.push({
          action: 'STUDENT_CREATED',
          resourceType: 'student',
          resourceId: student.id,
          changedFields: Object.keys(definedOnly(dto)).filter(
            (k) => k !== 'enrollment' && k !== 'guardians',
          ),
        });
        if (dto.enrollment) {
          await this.enrollIn(
            tx,
            school,
            student.id,
            dto.enrollment.sectionId,
            dto.enrollment.startDate,
            events,
          );
        }
        for (const g of dto.guardians ?? []) await this.linkIn(tx, school, student.id, g, events);
        return this.detail(tx, student.id);
      }),
    );
  }

  update(id: string, dto: UpdateStudentDto): Promise<StudentDetail> {
    return this.guard(() =>
      this.store.transact(async (tx, school, events) => {
        const student = await this.find(tx, school, id);
        const patch = definedOnly({
          ...definedOnly(dto),
          dateOfBirth:
            dto.dateOfBirth === undefined
              ? undefined
              : dto.dateOfBirth
                ? fromIsoDate(dto.dateOfBirth)
                : null,
          admissionDate:
            dto.admissionDate === undefined
              ? undefined
              : dto.admissionDate
                ? fromIsoDate(dto.admissionDate)
                : null,
        });
        const fields = changedFields(student, patch);
        if (fields.length > 0) {
          if (patch.admissionNumber && patch.admissionNumber !== student.admissionNumber) {
            if (
              await tx.student.findFirst({
                where: { schoolId: school.id, admissionNumber: patch.admissionNumber },
              })
            )
              throw PEOPLE_ERRORS.duplicateAdmissionNumber();
          }
          await tx.student.update({ where: { id }, data: patch });
          events.push({
            action: 'STUDENT_UPDATED',
            resourceType: 'student',
            resourceId: id,
            changedFields: fields,
          });
        }
        return this.detail(tx, id);
      }),
    );
  }

  /**
   * Approved lifecycle: ACTIVE ⇄ INACTIVE; ACTIVE/INACTIVE → WITHDRAWN | GRADUATED;
   * WITHDRAWN → ACTIVE. Withdrawal ends the active enrollment(s) as WITHDRAWN, graduation as
   * COMPLETED. The linked login account is NOT changed (separate lifecycle).
   */
  changeStatus(id: string, dto: ChangeStudentStatusDto): Promise<StudentDetail> {
    return this.store.transact(async (tx, school, events) => {
      const student = await this.find(tx, school, id);
      if (!canTransitionStudent(student.status, dto.status))
        throw PEOPLE_ERRORS.studentTransition(student.status, dto.status);
      await tx.student.update({ where: { id }, data: { status: dto.status } });
      await tx.studentStatusHistory.create({
        data: {
          tenantId: school.tenantId,
          schoolId: school.id,
          studentId: id,
          fromStatus: student.status,
          toStatus: dto.status,
          reason: dto.reason ?? null,
          changedByUserId: actor(),
        },
      });
      if (dto.status === 'WITHDRAWN' || dto.status === 'GRADUATED') {
        const ended = await tx.studentEnrollment.updateMany({
          where: { studentId: id, status: 'ACTIVE' },
          data: {
            status: dto.status === 'WITHDRAWN' ? 'WITHDRAWN' : 'COMPLETED',
            endDate: fromIsoDate(today()),
          },
        });
        if (ended.count > 0)
          events.push({
            action: 'ENROLLMENT_UPDATED',
            resourceType: 'student',
            resourceId: id,
            changedFields: ['status', 'endDate'],
            metadata: { reason: `student_${dto.status.toLowerCase()}`, count: ended.count },
          });
      }
      events.push({
        action: 'STUDENT_STATUS_CHANGED',
        resourceType: 'student',
        resourceId: id,
        changedFields: ['status'],
        metadata: { from: student.status, to: dto.status },
      });
      return this.detail(tx, id);
    });
  }

  // ---- Guardians -------------------------------------------------------------------------------

  linkGuardian(studentId: string, dto: LinkGuardianDto): Promise<StudentDetail> {
    return this.guard(() =>
      this.store.transact(async (tx, school, events) => {
        await this.find(tx, school, studentId);
        await this.linkIn(tx, school, studentId, dto, events);
        return this.detail(tx, studentId);
      }),
    );
  }

  updateGuardian(
    studentId: string,
    linkId: string,
    dto: UpdateGuardianDto,
  ): Promise<StudentDetail> {
    return this.guard(() =>
      this.store.transact(async (tx, school, events) => {
        const link = await tx.studentGuardian.findFirst({
          where: { id: linkId, studentId, schoolId: school.id },
        });
        if (!link) throw PEOPLE_ERRORS.guardianNotFound();
        const patch = definedOnly(dto);
        const fields = changedFields(link, patch);
        if (fields.length > 0) {
          if (patch.isPrimary === true)
            await tx.studentGuardian.updateMany({
              where: { studentId, isPrimary: true, NOT: { id: linkId } },
              data: { isPrimary: false },
            });
          await tx.studentGuardian.update({ where: { id: linkId }, data: patch });
          events.push({
            action: 'GUARDIAN_UPDATED',
            resourceType: 'student_guardian',
            resourceId: linkId,
            changedFields: fields,
            metadata: { studentId, parentId: link.parentId },
          });
        }
        return this.detail(tx, studentId);
      }),
    );
  }

  unlinkGuardian(studentId: string, linkId: string): Promise<StudentDetail> {
    return this.store.transact(async (tx, school, events) => {
      const link = await tx.studentGuardian.findFirst({
        where: { id: linkId, studentId, schoolId: school.id },
      });
      if (!link) throw PEOPLE_ERRORS.guardianNotFound();
      await tx.studentGuardian.delete({ where: { id: linkId } });
      events.push({
        action: 'GUARDIAN_UNLINKED',
        resourceType: 'student_guardian',
        resourceId: linkId,
        metadata: { studentId, parentId: link.parentId, relationship: link.relationship },
      });
      return this.detail(tx, studentId);
    });
  }

  // ---- Enrollments -----------------------------------------------------------------------------

  enrollments(studentId: string): Promise<Enrollment[]> {
    return this.store.run(async (tx) => {
      await this.visible(tx, studentId);
      const rows = await tx.studentEnrollment.findMany({
        where: { studentId },
        include: { section: SECTION_CONTEXT },
        orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      });
      return rows.map(toEnrollment);
    });
  }

  enroll(studentId: string, dto: CreateEnrollmentDto): Promise<StudentDetail> {
    return this.guard(() =>
      this.store.transact(async (tx, school, events) => {
        await this.enrollIn(tx, school, studentId, dto.sectionId, dto.startDate, events);
        return this.detail(tx, studentId);
      }),
    );
  }

  /** Same-year move: old enrollment → TRANSFERRED (end date), new ACTIVE — one transaction. */
  transfer(
    studentId: string,
    enrollmentId: string,
    dto: TransferEnrollmentDto,
  ): Promise<StudentDetail> {
    return this.guard(() =>
      this.store.transact(async (tx, school, events) => {
        const current = await this.findEnrollment(tx, school, studentId, enrollmentId);
        if (current.status !== 'ACTIVE') throw PEOPLE_ERRORS.enrollmentNotActive();
        if (current.sectionId === dto.sectionId) throw PEOPLE_ERRORS.sameSection();
        const target = await this.usableSection(tx, school, dto.sectionId);
        if (target.academicYearId !== current.academicYearId)
          throw PEOPLE_ERRORS.transferYearMismatch();
        const date = this.dateInYear(target.academicYear, dto.date);
        if (date < isoDate(current.startDate)) throw PEOPLE_ERRORS.endBeforeStart();
        await tx.studentEnrollment.update({
          where: { id: current.id },
          data: { status: 'TRANSFERRED', endDate: fromIsoDate(date) },
        });
        const created = await tx.studentEnrollment.create({
          data: {
            tenantId: school.tenantId,
            schoolId: school.id,
            studentId,
            sectionId: target.id,
            academicYearId: target.academicYearId,
            status: 'ACTIVE',
            startDate: fromIsoDate(date),
          },
        });
        events.push({
          action: 'ENROLLMENT_TRANSFERRED',
          resourceType: 'student_enrollment',
          resourceId: created.id,
          changedFields: ['sectionId'],
          metadata: {
            studentId,
            fromEnrollmentId: current.id,
            fromSectionId: current.sectionId,
            toSectionId: target.id,
          },
        });
        return this.detail(tx, studentId);
      }),
    );
  }

  endEnrollment(
    studentId: string,
    enrollmentId: string,
    dto: EndEnrollmentDto,
  ): Promise<StudentDetail> {
    return this.store.transact(async (tx, school, events) => {
      const current = await this.findEnrollment(tx, school, studentId, enrollmentId);
      if (current.status !== 'ACTIVE') throw PEOPLE_ERRORS.enrollmentNotActive();
      const date = dto.date ?? today();
      if (date < isoDate(current.startDate)) throw PEOPLE_ERRORS.endBeforeStart();
      await tx.studentEnrollment.update({
        where: { id: current.id },
        data: { status: dto.status, endDate: fromIsoDate(date) },
      });
      events.push({
        action: 'ENROLLMENT_UPDATED',
        resourceType: 'student_enrollment',
        resourceId: current.id,
        changedFields: ['status', 'endDate'],
        metadata: { studentId, to: dto.status },
      });
      return this.detail(tx, studentId);
    });
  }

  // ---- Internals -------------------------------------------------------------------------------

  /** Shared with the import worker (same rules for manual and bulk enrollment). */
  async enrollIn(
    tx: TenantTransaction,
    school: School,
    studentId: string,
    sectionId: string,
    startDate: string | undefined,
    events: AuditEvent[],
  ): Promise<string> {
    const student = await this.find(tx, school, studentId);
    if (student.status !== 'ACTIVE') throw PEOPLE_ERRORS.studentNotActive();
    const section = await this.usableSection(tx, school, sectionId);
    const date = this.dateInYear(section.academicYear, startDate);
    if (
      await tx.studentEnrollment.findFirst({
        where: { studentId, academicYearId: section.academicYearId, status: 'ACTIVE' },
      })
    )
      throw PEOPLE_ERRORS.activeEnrollmentExists();
    const created = await tx.studentEnrollment.create({
      data: {
        tenantId: school.tenantId,
        schoolId: school.id,
        studentId,
        sectionId: section.id,
        academicYearId: section.academicYearId,
        status: 'ACTIVE',
        startDate: fromIsoDate(date),
      },
    });
    events.push({
      action: 'ENROLLMENT_CREATED',
      resourceType: 'student_enrollment',
      resourceId: created.id,
      metadata: { studentId, sectionId: section.id, academicYearId: section.academicYearId },
    });
    return created.id;
  }

  /** Shared with the import worker. Setting a new primary unsets the previous one atomically. */
  async linkIn(
    tx: TenantTransaction,
    school: School,
    studentId: string,
    dto: LinkGuardianDto,
    events: AuditEvent[],
  ): Promise<GuardianLink> {
    const parent = await tx.parent.findFirst({ where: { id: dto.parentId, schoolId: school.id } });
    if (!parent) throw PEOPLE_ERRORS.parentNotFound();
    if (!parent.isActive) throw PEOPLE_ERRORS.parentInactive();
    if (await tx.studentGuardian.findFirst({ where: { studentId, parentId: parent.id } }))
      throw PEOPLE_ERRORS.guardianAlreadyLinked();
    if (dto.isPrimary)
      await tx.studentGuardian.updateMany({
        where: { studentId, isPrimary: true },
        data: { isPrimary: false },
      });
    const link = await tx.studentGuardian.create({
      data: {
        tenantId: school.tenantId,
        schoolId: school.id,
        studentId,
        parentId: parent.id,
        relationship: dto.relationship,
        isPrimary: dto.isPrimary ?? false,
        pickupAuthorized: dto.pickupAuthorized ?? false,
        isEmergencyContact: dto.isEmergencyContact ?? false,
      },
    });
    events.push({
      action: 'GUARDIAN_LINKED',
      resourceType: 'student_guardian',
      resourceId: link.id,
      metadata: {
        studentId,
        parentId: parent.id,
        relationship: dto.relationship,
        isPrimary: link.isPrimary,
      },
    });
    return toGuardianLink(link);
  }

  private async visible(tx: TenantTransaction, id: string): Promise<void> {
    const school = await this.store.school(tx);
    const found = await tx.student.findFirst({
      where: withScope<Prisma.StudentWhereInput>({ id, schoolId: school.id }, studentScope()),
      select: { id: true },
    });
    if (!found) throw PEOPLE_ERRORS.studentNotFound();
  }

  private async find(tx: TenantTransaction, school: School, id: string) {
    const student = await tx.student.findFirst({ where: { id, schoolId: school.id } });
    if (!student) throw PEOPLE_ERRORS.studentNotFound();
    return student;
  }

  private async findEnrollment(
    tx: TenantTransaction,
    school: School,
    studentId: string,
    id: string,
  ) {
    const e = await tx.studentEnrollment.findFirst({
      where: { id, studentId, schoolId: school.id },
    });
    if (!e) throw PEOPLE_ERRORS.enrollmentNotFound();
    return e;
  }

  /** Section of THIS school that can receive students: active section/branch/grade, year not CLOSED. */
  private async usableSection(tx: TenantTransaction, school: School, sectionId: string) {
    const section = await tx.section.findFirst({
      where: { id: sectionId, schoolId: school.id },
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
    return section;
  }

  /** Explicit date must lie in the year; default = today clamped into the year. */
  private dateInYear(year: { startDate: Date; endDate: Date }, date?: string): string {
    const start = isoDate(year.startDate);
    const end = isoDate(year.endDate);
    if (date) {
      if (date < start || date > end) throw PEOPLE_ERRORS.dateOutsideYear();
      return date;
    }
    const t = today();
    return t < start ? start : t > end ? end : t;
  }

  private summary(
    r: Prisma.StudentGetPayload<{ include: typeof STUDENT_LIST_INCLUDE }>,
  ): StudentSummary {
    return {
      id: r.id,
      admissionNumber: r.admissionNumber,
      firstName: r.firstName,
      middleName: r.middleName,
      lastName: r.lastName,
      preferredName: r.preferredName,
      status: r.status,
      account: toAccount(r.user),
      currentPlacement: currentPlacement(r.enrollments),
    };
  }

  private async detail(tx: TenantTransaction, id: string): Promise<StudentDetail> {
    const school = await this.store.school(tx);
    const r = await tx.student.findFirst({
      where: { id, schoolId: school.id },
      include: {
        user: ACCOUNT_SELECT,
        enrollments: {
          include: { section: SECTION_CONTEXT },
          orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
        },
        guardians: {
          include: { parent: true },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
        statusHistory: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!r) throw PEOPLE_ERRORS.studentNotFound();
    const actorIds = [
      ...new Set(r.statusHistory.map((h) => h.changedByUserId).filter((v) => v !== null)),
    ];
    const actors = new Map(
      actorIds.length
        ? (
            await tx.user.findMany({
              where: { id: { in: actorIds } },
              select: { id: true, displayName: true },
            })
          ).map((u) => [u.id, u.displayName])
        : [],
    );
    return {
      ...this.summary({ ...r, enrollments: r.enrollments.filter((e) => e.status === 'ACTIVE') }),
      dateOfBirth: r.dateOfBirth ? isoDate(r.dateOfBirth) : null,
      admissionDate: r.admissionDate ? isoDate(r.admissionDate) : null,
      enrollments: r.enrollments.map(toEnrollment),
      guardians: r.guardians.map((g) => ({
        ...toGuardianLink(g),
        parent: {
          id: g.parent.id,
          firstName: g.parent.firstName,
          middleName: g.parent.middleName,
          lastName: g.parent.lastName,
          phone: g.parent.phone,
          email: g.parent.email,
        },
      })),
      statusHistory: r.statusHistory.map((h) => ({
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        reason: h.reason,
        at: h.createdAt.toISOString(),
        actorName: h.changedByUserId ? (actors.get(h.changedByUserId) ?? null) : null,
      })),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw mapStudentUniqueViolation(error);
    }
  }
}

export function toGuardianLink(g: {
  id: string;
  studentId: string;
  parentId: string;
  relationship: GuardianLink['relationship'];
  isPrimary: boolean;
  pickupAuthorized: boolean;
  isEmergencyContact: boolean;
}): GuardianLink {
  return {
    id: g.id,
    studentId: g.studentId,
    parentId: g.parentId,
    relationship: g.relationship,
    isPrimary: g.isPrimary,
    pickupAuthorized: g.pickupAuthorized,
    isEmergencyContact: g.isEmergencyContact,
  };
}

export function mapStudentUniqueViolation(error: unknown): unknown {
  if (isUniqueViolation(error, 'students_school_id_admission_number_key'))
    return PEOPLE_ERRORS.duplicateAdmissionNumber();
  if (isUniqueViolation(error, 'student_enrollments_one_active_per_year'))
    return PEOPLE_ERRORS.activeEnrollmentExists();
  if (isUniqueViolation(error, 'student_guardians_student_id_parent_id_key'))
    return PEOPLE_ERRORS.guardianAlreadyLinked();
  if (isUniqueViolation(error, 'student_guardians_one_primary'))
    return PEOPLE_ERRORS.primaryGuardianConflict();
  return error;
}

/** The authenticated tenant user performing the change (for status history). */
function actor(): string | null {
  try {
    const auth = currentAuth();
    return auth.scope === 'TENANT' ? auth.userId : null;
  } catch {
    return null;
  }
}
