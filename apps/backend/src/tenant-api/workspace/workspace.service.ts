import type { Paginated } from '@acadlyx/tenant-config';
import type {
  AccessRow,
  AccountState,
  ClassDetail,
  ClassSummary,
  DashboardSummary,
  ProfileAccount,
  ProfileKind,
  SearchResults,
  StudentStatus,
  TeacherStatus,
} from '@acadlyx/types';
import { addDays, localToday, SEARCH_LIMIT_PER_TYPE, SEARCH_MIN_LENGTH } from '@acadlyx/validation';
import { Injectable } from '@nestjs/common';
import { currentAuth } from '../../auth/core/access.guard.js';
import type { PermissionKey } from '@acadlyx/permissions';
import type { Prisma, School } from '../../generated/prisma/client.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import { AcademicStore, isoDate } from '../academic/academic-store.js';
import { ImportsService } from '../imports/imports.service.js';
import {
  ACCOUNT_SELECT,
  fullNameSearch,
  nameSearch,
  paginated,
  paging,
  toAccount,
} from '../people/people-mappers.js';
import { parentScope, sectionScope, studentScope, withScope } from '../people/people-scope.js';
import { myAssignments } from '../operations/ops-scope.js';
import { recentActivity } from './activity.js';
import { WORKSPACE_ERRORS } from './workspace-errors.js';
import type {
  AccessQueryDto,
  ClassListQueryDto,
  SearchQueryDto,
  WorkspaceContextDto,
} from './workspace.dto.js';

const STUDENT_STATUSES: StudentStatus[] = ['ACTIVE', 'INACTIVE', 'WITHDRAWN', 'GRADUATED'];
const TEACHER_STATUSES: TeacherStatus[] = ['ACTIVE', 'INACTIVE'];
const USER_STATES = ['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'DISABLED'] as const;
const ROSTER_LIMIT = 500;
const SECTION_INCLUDE = { grade: true, branch: true, academicYear: true } as const;

function can(...permissions: PermissionKey[]): boolean {
  const held = currentAuth().permissions;
  return permissions.every((p) => held.includes(p));
}

function personName(p: { firstName: string; middleName: string | null; lastName: string | null }) {
  return [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ');
}

interface Context {
  year: { id: string; name: string; isCurrent: boolean; status?: string } | null;
  branch: { id: string; name: string } | null;
}

/**
 * School Admin workspace read models (Phase 6). Pure composition over the Phase 4/5 domain in the
 * tenant context (TenantPrisma → FORCE RLS). Every block is permission-gated and every people
 * query applies the people data scope; counts use COUNT/GROUP BY (no N+1, nothing loaded into
 * memory to be counted).
 */
@Injectable()
export class WorkspaceService {
  constructor(
    private readonly store: AcademicStore,
    private readonly imports: ImportsService,
  ) {}

  dashboard(query: WorkspaceContextDto): Promise<DashboardSummary> {
    return this.store
      .run(async (tx) => {
        const school = await this.store.school(tx);
        const ctx = await this.context(tx, school, query);
        const s = { schoolId: school.id };
        const inContext: Prisma.StudentEnrollmentWhereInput = {
          ...s,
          status: 'ACTIVE',
          ...(ctx.year ? { academicYearId: ctx.year.id } : {}),
          ...(ctx.branch ? { section: { branchId: ctx.branch.id } } : {}),
        };
        const out: DashboardSummary = {
          context: {
            academicYear: ctx.year
              ? { id: ctx.year.id, name: ctx.year.name, isCurrent: ctx.year.isCurrent }
              : null,
            branch: ctx.branch,
          },
        };
        const schoolWide = can('people.read_all');

        if (schoolWide && can('student.read')) {
          const [byStatus, enrolled] = await Promise.all([
            tx.student.groupBy({ by: ['status'], where: s, _count: { _all: true } }),
            tx.studentEnrollment.count({ where: { ...inContext, student: { status: 'ACTIVE' } } }),
          ]);
          out.students = {
            byStatus: tally(
              STUDENT_STATUSES,
              byStatus,
              (r) => r.status,
              (r) => r._count._all,
            ),
            enrolled,
          };
        }
        if (can('teacher.read')) {
          const byStatus = await tx.teacher.groupBy({
            by: ['status'],
            where: s,
            _count: { _all: true },
          });
          out.teachers = {
            byStatus: tally(
              TEACHER_STATUSES,
              byStatus,
              (r) => r.status,
              (r) => r._count._all,
            ),
          };
        }
        if (schoolWide && can('parent.read')) {
          const [total, guardianLinks] = await Promise.all([
            tx.parent.count({ where: s }),
            tx.studentGuardian.count({ where: s }),
          ]);
          out.parents = { total, guardianLinks };
        }
        if (can('section.read')) {
          const where: Prisma.SectionWhereInput = {
            ...s,
            ...(ctx.year ? { academicYearId: ctx.year.id } : {}),
            ...(ctx.branch ? { branchId: ctx.branch.id } : {}),
          };
          const [sections, activeSections] = await Promise.all([
            tx.section.count({ where }),
            tx.section.count({ where: { ...where, isActive: true } }),
          ]);
          out.classes = { sections, activeSections };
        }
        if (can('people_account.manage')) out.accounts = await this.accountCounts(tx, school);
        if (schoolWide && can('student.read')) {
          const [noEnrollment, noGuardian, noAssignment] = await Promise.all([
            tx.student.count({
              where: {
                ...s,
                status: 'ACTIVE',
                enrollments: {
                  none: { status: 'ACTIVE', ...(ctx.year ? { academicYearId: ctx.year.id } : {}) },
                },
              },
            }),
            tx.student.count({ where: { ...s, status: 'ACTIVE', guardians: { none: {} } } }),
            can('teacher.read')
              ? tx.teacher.count({
                  where: { ...s, status: 'ACTIVE', assignments: { none: { endedAt: null } } },
                })
              : Promise.resolve(0),
          ]);
          out.dataQuality = {
            activeStudentsWithoutEnrollment: noEnrollment,
            activeStudentsWithoutGuardian: noGuardian,
            activeTeachersWithoutAssignment: noAssignment,
          };
        }
        out.operations = await this.operations(tx, school, ctx);
        if (Object.keys(out.operations).length === 0) delete out.operations;
        if (can('school_activity.read')) out.activity = await recentActivity(tx, school);
        if (can('bulk_import.read')) {
          const pending = await tx.bulkImportJob.count({
            where: { ...s, status: { in: ['READY', 'QUEUED', 'PROCESSING'] } },
          });
          out.imports = { recent: [], pending };
        }
        return out;
      })
      .then(async (out) => {
        // Recent imports reuse the Phase 5 import service (same mapping, same scope).
        if (out.imports) out.imports.recent = (await this.imports.list({ pageSize: 5 })).items;
        return out;
      });
  }

  classes(query: ClassListQueryDto): Promise<ClassSummary[]> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const ctx = await this.context(tx, school, query);
      if (
        query.gradeId &&
        !(await tx.grade.findFirst({ where: { id: query.gradeId, schoolId: school.id } }))
      )
        throw WORKSPACE_ERRORS.contextNotFound();
      const where = withScope<Prisma.SectionWhereInput>(
        {
          schoolId: school.id,
          ...(ctx.year ? { academicYearId: ctx.year.id } : {}),
          ...(ctx.branch ? { branchId: ctx.branch.id } : {}),
          ...(query.gradeId ? { gradeId: query.gradeId } : {}),
        },
        sectionScope(),
      );
      const rows = await tx.section.findMany({
        where,
        include: {
          ...SECTION_INCLUDE,
          _count: {
            select: {
              enrollments: { where: { status: 'ACTIVE' } },
              assignments: { where: { endedAt: null } },
            },
          },
        },
        orderBy: [
          { academicYear: { startDate: 'desc' } },
          { grade: { displayOrder: 'asc' } },
          { branch: { name: 'asc' } },
          { displayOrder: 'asc' },
        ],
        take: 1000,
      });
      return rows.map((r) => ({
        ...classSummary(r),
        studentCount: r._count.enrollments,
        teacherAssignmentCount: r._count.assignments,
      }));
    });
  }

  classDetail(sectionId: string): Promise<ClassDetail> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const section = await tx.section.findFirst({
        where: withScope<Prisma.SectionWhereInput>(
          { id: sectionId, schoolId: school.id },
          sectionScope(),
        ),
        include: SECTION_INCLUDE,
      });
      if (!section) throw WORKSPACE_ERRORS.classNotFound();
      const guardianNames = can('parent.read');
      const [enrollments, assignments, subjects] = await Promise.all([
        tx.studentEnrollment.findMany({
          where: { sectionId: section.id, schoolId: school.id, status: 'ACTIVE' },
          include: {
            student: {
              include: {
                user: ACCOUNT_SELECT,
                _count: { select: { guardians: true } },
                guardians: {
                  where: { isPrimary: true },
                  take: 1,
                  include: {
                    parent: { select: { firstName: true, middleName: true, lastName: true } },
                  },
                },
              },
            },
          },
          orderBy: [
            { student: { lastName: 'asc' } },
            { student: { firstName: 'asc' } },
            { id: 'asc' },
          ],
          take: ROSTER_LIMIT,
        }),
        can('teacher_assignment.read')
          ? tx.teacherAssignment.findMany({
              where: { sectionId: section.id, schoolId: school.id, endedAt: null },
              include: { teacher: true, subject: true },
              orderBy: [{ type: 'asc' }, { startedAt: 'asc' }],
            })
          : Promise.resolve(null),
        can('subject.read')
          ? tx.gradeSubject.findMany({
              where: { gradeId: section.gradeId, schoolId: school.id },
              include: { subject: true },
              orderBy: [{ displayOrder: 'asc' }],
            })
          : Promise.resolve(null),
      ]);
      const detail: ClassDetail = {
        ...classSummary(section),
        studentCount: enrollments.length,
        teacherAssignmentCount: assignments?.length ?? 0,
        roster: enrollments.map((e) => {
          const primary = e.student.guardians[0];
          return {
            id: e.student.id,
            admissionNumber: e.student.admissionNumber,
            firstName: e.student.firstName,
            middleName: e.student.middleName,
            lastName: e.student.lastName,
            preferredName: e.student.preferredName,
            status: e.student.status,
            enrollmentId: e.id,
            startDate: isoDate(e.startDate),
            account: toAccount(e.student.user),
            guardianCount: e.student._count.guardians,
            primaryGuardian:
              guardianNames && primary
                ? { ...primary.parent, relationship: primary.relationship }
                : null,
          };
        }),
      };
      if (assignments)
        detail.teachers = assignments.map((a) => ({
          assignmentId: a.id,
          type: a.type,
          teacherId: a.teacherId,
          teacherName: personName(a.teacher),
          employeeId: a.teacher.employeeId,
          teacherStatus: a.teacher.status,
          subjectId: a.subjectId,
          subjectName: a.subject?.name ?? null,
        }));
      if (subjects)
        detail.subjects = subjects.map((g) => ({
          id: g.subject.id,
          code: g.subject.code,
          name: g.subject.name,
          isRequired: g.isRequired,
        }));
      return detail;
    });
  }

  /**
   * Global search: only entity types the caller may read, people scope applied, at most
   * SEARCH_LIMIT_PER_TYPE per type, and minimal identifying fields (no phone/email/DOB — and
   * contact fields are not searchable here, so they cannot be probed).
   */
  search(query: SearchQueryDto): Promise<SearchResults> {
    const q = query.q.trim();
    if (q.length < SEARCH_MIN_LENGTH) throw WORKSPACE_ERRORS.searchTooShort(SEARCH_MIN_LENGTH);
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const s = { schoolId: school.id };
      const upper = q.toUpperCase();
      const take = SEARCH_LIMIT_PER_TYPE;
      const names = [...nameSearch(q), ...fullNameSearch(q)];
      const [students, parents, teachers, classes] = await Promise.all([
        can('student.read')
          ? tx.student.findMany({
              where: withScope<Prisma.StudentWhereInput>(
                { ...s, OR: [...names, { admissionNumber: { contains: upper } }] },
                studentScope(),
              ),
              select: {
                id: true,
                firstName: true,
                middleName: true,
                lastName: true,
                admissionNumber: true,
                status: true,
              },
              orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
              take,
            })
          : null,
        can('parent.read')
          ? tx.parent.findMany({
              where: withScope<Prisma.ParentWhereInput>(
                { ...s, OR: [...names, { parentCode: { contains: upper } }] },
                parentScope(),
              ),
              select: {
                id: true,
                firstName: true,
                middleName: true,
                lastName: true,
                parentCode: true,
              },
              orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
              take,
            })
          : null,
        can('teacher.read')
          ? tx.teacher.findMany({
              where: { ...s, OR: [...names, { employeeId: { contains: upper } }] },
              select: {
                id: true,
                firstName: true,
                middleName: true,
                lastName: true,
                employeeId: true,
                status: true,
              },
              orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
              take,
            })
          : null,
        can('section.read', 'enrollment.read') ? this.searchClasses(tx, school, q) : null,
      ]);
      const out: SearchResults = { query: q };
      if (students)
        out.students = students.map((r) => ({
          id: r.id,
          label: personName(r),
          admissionNumber: r.admissionNumber,
          status: r.status,
        }));
      if (parents)
        out.parents = parents.map((r) => ({
          id: r.id,
          label: personName(r),
          parentCode: r.parentCode,
        }));
      if (teachers)
        out.teachers = teachers.map((r) => ({
          id: r.id,
          label: personName(r),
          employeeId: r.employeeId,
          status: r.status,
        }));
      if (classes) out.classes = classes;
      return out;
    });
  }

  /** Profiles that still need login access: no account, or not (yet) ACTIVE. */
  access(query: AccessQueryDto): Promise<Paginated<AccessRow>> {
    const { page, pageSize, skip, take } = paging(query);
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const state: Prisma.StudentWhereInput & Prisma.ParentWhereInput & Prisma.TeacherWhereInput =
        query.state === 'NONE'
          ? { userId: null }
          : query.state
            ? { user: { status: query.state } }
            : { OR: [{ userId: null }, { user: { status: { not: 'ACTIVE' } } }] };
      const names = query.q ? [...nameSearch(query.q), ...fullNameSearch(query.q)] : null;
      const upper = query.q?.toUpperCase() ?? '';
      const order = [
        { lastName: 'asc' as const },
        { firstName: 'asc' as const },
        { id: 'asc' as const },
      ];
      const base = { schoolId: school.id, ...state };
      if (query.kind === 'students') {
        const where: Prisma.StudentWhereInput = {
          AND: [
            base,
            ...(names ? [{ OR: [...names, { admissionNumber: { contains: upper } }] }] : []),
          ],
        };
        const [total, rows] = await Promise.all([
          tx.student.count({ where }),
          tx.student.findMany({
            where,
            include: { user: ACCOUNT_SELECT },
            orderBy: order,
            skip,
            take,
          }),
        ]);
        return paginated(
          rows.map((r) => accessRow('students', r, r.admissionNumber, false, false)),
          total,
          page,
          pageSize,
        );
      }
      if (query.kind === 'parents') {
        const where: Prisma.ParentWhereInput = {
          AND: [base, ...(names ? [{ OR: [...names, { parentCode: { contains: upper } }] }] : [])],
        };
        const [total, rows] = await Promise.all([
          tx.parent.count({ where }),
          tx.parent.findMany({
            where,
            include: { user: ACCOUNT_SELECT },
            orderBy: order,
            skip,
            take,
          }),
        ]);
        return paginated(
          rows.map((r) =>
            accessRow('parents', r, r.parentCode, Boolean(r.email), Boolean(r.phone)),
          ),
          total,
          page,
          pageSize,
        );
      }
      const where: Prisma.TeacherWhereInput = {
        AND: [base, ...(names ? [{ OR: [...names, { employeeId: { contains: upper } }] }] : [])],
      };
      const [total, rows] = await Promise.all([
        tx.teacher.count({ where }),
        tx.teacher.findMany({
          where,
          include: { user: ACCOUNT_SELECT },
          orderBy: order,
          skip,
          take,
        }),
      ]);
      return paginated(
        rows.map((r) => accessRow('teachers', r, r.employeeId, Boolean(r.email), Boolean(r.phone))),
        total,
        page,
        pageSize,
      );
    });
  }

  // ---- helpers ---------------------------------------------------------------------------------

  /** Phase 7 counts, scoped exactly like the modules (teachers: their own classes/subjects). */
  private async operations(
    tx: TenantTransaction,
    school: School,
    ctx: Context,
  ): Promise<NonNullable<DashboardSummary['operations']>> {
    const out: NonNullable<DashboardSummary['operations']> = {};
    if (!ctx.year || !(can('attendance.read') || can('homework.read') || can('assignment.read')))
      return out;
    const scope = await myAssignments(tx, school);
    const inScope = scope === null ? {} : { id: { in: [...scope.sections] } };
    const sections = await tx.section.findMany({
      where: {
        schoolId: school.id,
        academicYearId: ctx.year.id,
        isActive: true,
        ...(ctx.branch ? { branchId: ctx.branch.id } : {}),
        ...inScope,
        enrollments: { some: { status: 'ACTIVE' } },
      },
      select: { id: true, branch: { select: { timezone: true } } },
    });
    const today = (tz: string) => localToday(tz);
    const tz = sections[0]?.branch.timezone ?? school.timezone;
    if (can('attendance.read') && ctx.year.status === 'ACTIVE') {
      const todays = [...new Set(sections.map((x) => today(x.branch.timezone)))];
      const done = await tx.attendanceSession.findMany({
        where: {
          schoolId: school.id,
          sectionId: { in: sections.map((x) => x.id) },
          date: { in: todays.map((d) => new Date(`${d}T00:00:00.000Z`)) },
        },
        select: { sectionId: true, date: true },
      });
      const marked = new Set(
        done.map((d) => `${d.sectionId}:${d.date.toISOString().slice(0, 10)}`),
      );
      out.attendanceToMark = sections.filter(
        (x) => !marked.has(`${x.id}:${today(x.branch.timezone)}`),
      ).length;
    }
    const from = today(tz);
    const window = {
      schoolId: school.id,
      status: 'PUBLISHED' as const,
      section: {
        academicYearId: ctx.year.id,
        ...(ctx.branch ? { branchId: ctx.branch.id } : {}),
        ...(scope === null ? {} : { id: { in: [...scope.sections] } }),
      },
      dueDate: {
        gte: new Date(`${from}T00:00:00.000Z`),
        lte: new Date(`${addDays(from, 7)}T00:00:00.000Z`),
      },
    };
    const [hw, asg] = await Promise.all([
      can('homework.read') ? tx.homework.count({ where: window }) : Promise.resolve(undefined),
      can('assignment.read') ? tx.assignment.count({ where: window }) : Promise.resolve(undefined),
    ]);
    if (hw !== undefined) out.homeworkDueSoon = hw;
    if (asg !== undefined) out.assignmentsDueSoon = asg;
    return out;
  }

  /** Validates UI-supplied context ids against THIS school; defaults year to the current one. */
  private async context(
    tx: TenantTransaction,
    school: School,
    q: WorkspaceContextDto,
  ): Promise<Context> {
    const [year, branch] = await Promise.all([
      q.academicYearId
        ? tx.academicYear.findFirst({ where: { id: q.academicYearId, schoolId: school.id } })
        : tx.academicYear.findFirst({ where: { schoolId: school.id, isCurrent: true } }),
      q.branchId ? tx.branch.findFirst({ where: { id: q.branchId, schoolId: school.id } }) : null,
    ]);
    if ((q.academicYearId && !year) || (q.branchId && !branch))
      throw WORKSPACE_ERRORS.contextNotFound();
    return {
      year: year
        ? { id: year.id, name: year.name, isCurrent: year.isCurrent, status: year.status }
        : null,
      branch: branch ? { id: branch.id, name: branch.name } : null,
    };
  }

  private async accountCounts(
    tx: TenantTransaction,
    school: School,
  ): Promise<Record<ProfileKind, Record<AccountState, number>>> {
    const s = { schoolId: school.id };
    const [sNone, pNone, tNone, sUsers, pUsers, tUsers] = await Promise.all([
      tx.student.count({ where: { ...s, userId: null } }),
      tx.parent.count({ where: { ...s, userId: null } }),
      tx.teacher.count({ where: { ...s, userId: null } }),
      tx.user.groupBy({ by: ['status'], where: { student: { is: s } }, _count: { _all: true } }),
      tx.user.groupBy({ by: ['status'], where: { parent: { is: s } }, _count: { _all: true } }),
      tx.user.groupBy({ by: ['status'], where: { teacher: { is: s } }, _count: { _all: true } }),
    ]);
    const bucket = (none: number, rows: { status: string; _count: { _all: number } }[]) => ({
      NONE: none,
      ...tally(
        USER_STATES,
        rows,
        (r) => r.status,
        (r) => r._count._all,
      ),
    });
    return {
      students: bucket(sNone, sUsers),
      parents: bucket(pNone, pUsers),
      teachers: bucket(tNone, tUsers),
    };
  }

  private async searchClasses(tx: TenantTransaction, school: School, q: string) {
    const current = await tx.academicYear.findFirst({
      where: { schoolId: school.id, isCurrent: true },
    });
    const rows = await tx.section.findMany({
      where: withScope<Prisma.SectionWhereInput>(
        {
          schoolId: school.id,
          ...(current ? { academicYearId: current.id } : {}),
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { grade: { name: { contains: q, mode: 'insensitive' } } },
            { grade: { code: { contains: q.toUpperCase() } } },
          ],
        },
        sectionScope(),
      ),
      include: { grade: true, branch: true },
      orderBy: [{ grade: { displayOrder: 'asc' } }, { displayOrder: 'asc' }],
      take: SEARCH_LIMIT_PER_TYPE,
    });
    return rows.map((r) => ({ id: r.id, label: `${r.grade.name} ${r.name} · ${r.branch.name}` }));
  }
}

function tally<K extends string, R>(
  keys: readonly K[],
  rows: R[],
  key: (r: R) => string,
  count: (r: R) => number,
): Record<K, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const r of rows) {
    const k = key(r);
    if ((keys as readonly string[]).includes(k)) out[k as K] = count(r);
  }
  return out;
}

function classSummary(r: Prisma.SectionGetPayload<{ include: typeof SECTION_INCLUDE }>) {
  return {
    sectionId: r.id,
    sectionName: `${r.grade.name} ${r.name}`,
    sectionCode: r.code,
    isActive: r.isActive,
    capacity: r.capacity,
    gradeId: r.gradeId,
    gradeName: r.grade.name,
    branchId: r.branchId,
    branchName: r.branch.name,
    academicYearId: r.academicYearId,
    academicYearName: r.academicYear.name,
  };
}

function accessRow(
  kind: ProfileKind,
  r: {
    id: string;
    firstName: string;
    middleName: string | null;
    lastName: string | null;
    user: { id: string; status: ProfileAccount['status'] } | null;
  },
  code: string | null,
  hasEmail: boolean,
  hasPhone: boolean,
): AccessRow {
  return {
    kind,
    id: r.id,
    firstName: r.firstName,
    middleName: r.middleName,
    lastName: r.lastName,
    code,
    account: toAccount(r.user),
    hasEmail,
    hasPhone,
  };
}
