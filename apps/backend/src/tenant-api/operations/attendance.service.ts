import type { Paginated } from '@acadlyx/tenant-config';
import type {
  AttendanceClass,
  AttendanceCounts,
  AttendanceHistoryDay,
  AttendanceRecordChange,
  AttendanceSheet,
  AttendanceStatus,
  StudentAttendanceSummary,
} from '@acadlyx/types';
import {
  addDays,
  attendancePercentage,
  roundRate,
  TEACHER_ATTENDANCE_WINDOW_DAYS,
} from '@acadlyx/validation';
import { Injectable } from '@nestjs/common';
import { currentAuth } from '../../auth/core/access.guard.js';
import { isUniqueViolation } from '../../common/errors/domain-errors.js';
import type { School } from '../../generated/prisma/client.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import { AcademicStore } from '../academic/academic-store.js';
import { paginated, paging } from '../people/people-mappers.js';
import { studentScope, withScope } from '../people/people-scope.js';
import { OPS_ERRORS } from './ops-errors.js';
import {
  authUserId,
  fromIsoDate,
  isoDate,
  myAssignments,
  personName,
  type Scope,
  scopedSection,
  SECTION_OPS_INCLUDE,
  type SectionWithOps,
  sectionUsable,
  sectionWhere,
  todayFor,
  toOpsSection,
} from './ops-scope.js';
import type {
  AttendanceClassesQueryDto,
  AttendanceHistoryQueryDto,
  SaveAttendanceDto,
} from './operations.dto.js';

const STATUSES: AttendanceStatus[] = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];
const emptyCounts = (): AttendanceCounts => ({
  PRESENT: 0,
  ABSENT: 0,
  LATE: 0,
  EXCUSED: 0,
  UNMARKED: 0,
});

/**
 * Daily class attendance (Phase 7, decisions A–E).
 *
 * - One session per Section + school-local date (DB unique); one record per student (DB unique).
 * - Roster for date D: students whose enrollment in THIS section covers D
 *   (start_date ≤ D and (end_date IS NULL or end_date > D) — a transfer/withdrawal takes effect
 *   on its end date), plus anyone already recorded on the sheet so history never disappears.
 * - Immediate save; later saves are corrections. Optimistic concurrency via `version`.
 * - Every value change is appended to attendance_record_history (who, when, old → new).
 * - Future dates are always rejected; CLOSED/PLANNED years and inactive structures are read-only;
 *   teachers are limited to today and the previous 7 local days, `attendance.backdate` holders
 *   (Principal, School Admin) to any past date inside the (ACTIVE) academic year.
 */
@Injectable()
export class AttendanceService {
  constructor(private readonly store: AcademicStore) {}

  classes(query: AttendanceClassesQueryDto): Promise<AttendanceClass[]> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const scope = await myAssignments(tx, school);
      const year = query.academicYearId
        ? await tx.academicYear.findFirst({
            where: { id: query.academicYearId, schoolId: school.id },
          })
        : await tx.academicYear.findFirst({ where: { schoolId: school.id, isCurrent: true } });
      if (query.academicYearId && !year) throw OPS_ERRORS.contextNotFound();
      if (!year) return [];
      const scopeWhere = sectionWhere(scope);
      const sections = await tx.section.findMany({
        where: {
          schoolId: school.id,
          academicYearId: year.id,
          ...(query.branchId ? { branchId: query.branchId } : {}),
          ...(scopeWhere ?? {}),
        },
        include: {
          ...SECTION_OPS_INCLUDE,
          _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
        },
        orderBy: [
          { grade: { displayOrder: 'asc' } },
          { branch: { name: 'asc' } },
          { displayOrder: 'asc' },
        ],
      });
      // One query for "saved today" across all branches' local dates.
      const todays = [...new Set(sections.map((s) => todayFor(s)))];
      const marked = await tx.attendanceSession.findMany({
        where: {
          schoolId: school.id,
          sectionId: { in: sections.map((s) => s.id) },
          date: { in: todays.map(fromIsoDate) },
        },
        select: { sectionId: true, date: true },
      });
      const done = new Set(marked.map((m) => `${m.sectionId}:${isoDate(m.date)}`));
      return sections.map((s) => ({
        ...toOpsSection(s),
        gradeName: s.grade.name,
        today: todayFor(s),
        markedToday: done.has(`${s.id}:${todayFor(s)}`),
        studentCount: s._count.enrollments,
      }));
    });
  }

  sheet(sectionId: string, date: string | undefined): Promise<AttendanceSheet> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const scope = await myAssignments(tx, school);
      const section = await scopedSection(tx, school, scope, sectionId);
      return this.buildSheet(tx, school, scope, section, date ?? todayFor(section));
    });
  }

  save(dto: SaveAttendanceDto): Promise<AttendanceSheet> {
    return this.store
      .transact(async (tx, school, events) => {
        const scope = await myAssignments(tx, school);
        const section = await scopedSection(tx, school, scope, dto.sectionId);
        const lock = this.lockReason(section, dto.date, scope);
        if (lock) throw lockError(lock);

        const eligible = await this.eligibleStudentIds(tx, school, section.id, dto.date);
        const seen = new Set<string>();
        for (const r of dto.records) {
          if (seen.has(r.studentId)) throw OPS_ERRORS.duplicateStudent();
          seen.add(r.studentId);
        }
        const existingSession = await tx.attendanceSession.findUnique({
          where: { sectionId_date: { sectionId: section.id, date: fromIsoDate(dto.date) } },
        });
        const existing = existingSession
          ? await tx.attendanceRecord.findMany({ where: { sessionId: existingSession.id } })
          : [];
        const byStudent = new Map(existing.map((r) => [r.studentId, r]));
        for (const r of dto.records)
          if (!eligible.has(r.studentId) && !byStudent.has(r.studentId))
            throw OPS_ERRORS.notOnRoster();

        const me = authUserId();
        let session = existingSession;
        if (!session) {
          session = await tx.attendanceSession.create({
            data: {
              tenantId: school.tenantId,
              schoolId: school.id,
              sectionId: section.id,
              academicYearId: section.academicYearId,
              date: fromIsoDate(dto.date),
              createdByUserId: me,
              updatedByUserId: me,
            },
          });
        } else {
          if (dto.expectedVersion === undefined) throw OPS_ERRORS.expectedVersionRequired();
          const bumped = await tx.attendanceSession.updateMany({
            where: { id: session.id, version: dto.expectedVersion },
            data: { version: { increment: 1 }, updatedByUserId: me },
          });
          if (bumped.count !== 1) throw OPS_ERRORS.staleVersion('Attendance for this class');
        }

        const history: {
          recordId: string;
          fromStatus: AttendanceStatus | null;
          toStatus: AttendanceStatus;
          fromNote: string | null;
          toNote: string | null;
        }[] = [];
        let created = 0;
        let changed = 0;
        for (const r of dto.records) {
          const note = r.note?.trim() ? r.note.trim() : null;
          const prev = byStudent.get(r.studentId);
          if (!prev) {
            const rec = await tx.attendanceRecord.create({
              data: {
                tenantId: school.tenantId,
                schoolId: school.id,
                sessionId: session.id,
                studentId: r.studentId,
                status: r.status,
                note,
              },
            });
            history.push({
              recordId: rec.id,
              fromStatus: null,
              toStatus: r.status,
              fromNote: null,
              toNote: note,
            });
            created += 1;
          } else if (prev.status !== r.status || prev.note !== note) {
            await tx.attendanceRecord.update({
              where: { id: prev.id },
              data: { status: r.status, note },
            });
            history.push({
              recordId: prev.id,
              fromStatus: prev.status,
              toStatus: r.status,
              fromNote: prev.note,
              toNote: note,
            });
            changed += 1;
          }
        }
        if (history.length)
          await tx.attendanceRecordHistory.createMany({
            data: history.map((h) => ({
              ...h,
              tenantId: school.tenantId,
              schoolId: school.id,
              changedByUserId: me,
            })),
          });
        // Session-level audit only: no student ids, statuses or notes (those live in the history).
        events.push({
          action: existingSession ? 'ATTENDANCE_CORRECTED' : 'ATTENDANCE_RECORDED',
          resourceType: 'attendance_session',
          resourceId: session.id,
          metadata: { sectionId: section.id, date: dto.date, marked: created, corrected: changed },
        });
        return { sectionId: section.id, date: dto.date };
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error, 'attendance_sessions_section_id_date_key'))
          throw OPS_ERRORS.sessionExists();
        if (isUniqueViolation(error, 'attendance_records_session_id_student_id_key'))
          throw OPS_ERRORS.sessionExists();
        throw error;
      })
      .then(({ sectionId, date }) => this.sheet(sectionId, date));
  }

  history(
    sectionId: string,
    query: AttendanceHistoryQueryDto,
  ): Promise<Paginated<AttendanceHistoryDay>> {
    const { page, pageSize, skip, take } = paging(query);
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const scope = await myAssignments(tx, school);
      const section = await scopedSection(tx, school, scope, sectionId);
      const where = {
        sectionId: section.id,
        ...(query.from || query.to
          ? {
              date: {
                ...(query.from ? { gte: fromIsoDate(query.from) } : {}),
                ...(query.to ? { lte: fromIsoDate(query.to) } : {}),
              },
            }
          : {}),
      };
      const [total, sessions] = await Promise.all([
        tx.attendanceSession.count({ where }),
        tx.attendanceSession.findMany({ where, orderBy: { date: 'desc' }, skip, take }),
      ]);
      const grouped = sessions.length
        ? await tx.attendanceRecord.groupBy({
            by: ['sessionId', 'status'],
            where: { sessionId: { in: sessions.map((s) => s.id) } },
            _count: { _all: true },
          })
        : [];
      return paginated(
        sessions.map((s) => {
          const counts = emptyCounts();
          for (const g of grouped) if (g.sessionId === s.id) counts[g.status] = g._count._all;
          return {
            date: isoDate(s.date),
            sessionId: s.id,
            counts,
            updatedAt: s.updatedAt.toISOString(),
          };
        }),
        total,
        page,
        pageSize,
      );
    });
  }

  /** Correction trail of one sheet (initial marks and every change), newest first. */
  changes(sectionId: string, date: string): Promise<AttendanceRecordChange[]> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const scope = await myAssignments(tx, school);
      const section = await scopedSection(tx, school, scope, sectionId);
      const session = await tx.attendanceSession.findUnique({
        where: { sectionId_date: { sectionId: section.id, date: fromIsoDate(date) } },
      });
      if (!session) return [];
      const rows = await tx.attendanceRecordHistory.findMany({
        where: { record: { sessionId: session.id } },
        include: { record: { include: { student: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
      });
      const actors = new Map(
        (
          await tx.user.findMany({
            where: { id: { in: [...new Set(rows.map((r) => r.changedByUserId))] } },
            select: { id: true, displayName: true },
          })
        ).map((u) => [u.id, u.displayName]),
      );
      return rows.map((r) => ({
        at: r.createdAt.toISOString(),
        studentName: personName(r.record.student),
        admissionNumber: r.record.student.admissionNumber,
        fromStatus: r.fromStatus,
        toStatus: r.toStatus,
        fromNote: r.fromNote,
        toNote: r.toNote,
        changedByName: actors.get(r.changedByUserId) ?? null,
      }));
    });
  }

  /** Per-student summary for the current (or given) academic year — denominator documented. */
  studentSummary(
    studentId: string,
    academicYearId?: string,
  ): Promise<StudentAttendanceSummary | null> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const student = await tx.student.findFirst({
        where: withScope({ id: studentId, schoolId: school.id }, studentScope()),
        select: { id: true },
      });
      if (!student) throw OPS_ERRORS.studentNotFound();
      return attendanceSummaryFor(tx, school, student.id, academicYearId);
    });
  }

  // ---- helpers ---------------------------------------------------------------------------------

  private async buildSheet(
    tx: TenantTransaction,
    school: School,
    scope: Scope,
    section: SectionWithOps,
    date: string,
  ): Promise<AttendanceSheet> {
    const session = await tx.attendanceSession.findUnique({
      where: { sectionId_date: { sectionId: section.id, date: fromIsoDate(date) } },
    });
    const eligible = await tx.studentEnrollment.findMany({
      where: this.enrollmentOn(school, section.id, date),
      include: { student: true },
    });
    const records = session
      ? await tx.attendanceRecord.findMany({
          where: { sessionId: session.id },
          include: { student: true },
        })
      : [];
    const byStudent = new Map(records.map((r) => [r.studentId, r]));
    const students = new Map(eligible.map((e) => [e.student.id, e.student]));
    for (const r of records) students.set(r.student.id, r.student);
    const roster = [...students.values()]
      .sort(
        (a, b) =>
          (a.lastName ?? '').localeCompare(b.lastName ?? '') ||
          a.firstName.localeCompare(b.firstName) ||
          a.id.localeCompare(b.id),
      )
      .map((s) => {
        const r = byStudent.get(s.id);
        return {
          studentId: s.id,
          admissionNumber: s.admissionNumber,
          firstName: s.firstName,
          middleName: s.middleName,
          lastName: s.lastName,
          studentStatus: s.status,
          status: r?.status ?? null,
          note: r?.note ?? null,
        };
      });
    const counts = emptyCounts();
    for (const r of roster) counts[r.status ?? 'UNMARKED'] += 1;
    const lock = currentAuth().permissions.includes('attendance.manage')
      ? this.lockReason(section, date, scope)
      : 'READ_ONLY';
    const updatedBy = session
      ? await tx.user.findFirst({
          where: { id: session.updatedByUserId },
          select: { displayName: true },
        })
      : null;
    return {
      ...toOpsSection(section),
      date,
      today: todayFor(section),
      session: session
        ? {
            id: session.id,
            version: session.version,
            updatedAt: session.updatedAt.toISOString(),
            updatedByName: updatedBy?.displayName ?? null,
          }
        : null,
      editable: lock === null,
      lockedReason: lock,
      roster,
      counts,
    };
  }

  private enrollmentOn(school: School, sectionId: string, date: string) {
    const d = fromIsoDate(date);
    return {
      schoolId: school.id,
      sectionId,
      startDate: { lte: d },
      OR: [{ endDate: null }, { endDate: { gt: d } }],
    };
  }

  private async eligibleStudentIds(
    tx: TenantTransaction,
    school: School,
    sectionId: string,
    date: string,
  ) {
    const rows = await tx.studentEnrollment.findMany({
      where: this.enrollmentOn(school, sectionId, date),
      select: { studentId: true },
    });
    return new Set(rows.map((r) => r.studentId));
  }

  /** Null when the caller may save this sheet; otherwise the (first) reason it is locked. */
  private lockReason(
    section: SectionWithOps,
    date: string,
    scope: Scope,
  ): AttendanceSheet['lockedReason'] {
    const today = todayFor(section);
    if (date > today) return 'FUTURE_DATE';
    if (section.academicYear.status !== 'ACTIVE') return 'YEAR_NOT_ACTIVE';
    if (
      date < isoDate(section.academicYear.startDate) ||
      date > isoDate(section.academicYear.endDate)
    )
      return 'OUTSIDE_YEAR';
    if (!sectionUsable(section)) return 'READ_ONLY';
    const backdate = currentAuth().permissions.includes('attendance.backdate') && scope === null;
    if (!backdate && date < addDays(today, -TEACHER_ATTENDANCE_WINDOW_DAYS))
      return 'OUTSIDE_TEACHER_WINDOW';
    return null;
  }
}

function lockError(reason: NonNullable<AttendanceSheet['lockedReason']>) {
  switch (reason) {
    case 'FUTURE_DATE':
      return OPS_ERRORS.futureDate();
    case 'OUTSIDE_TEACHER_WINDOW':
      return OPS_ERRORS.outsideTeacherWindow(TEACHER_ATTENDANCE_WINDOW_DAYS);
    case 'YEAR_NOT_ACTIVE':
      return OPS_ERRORS.yearNotActive();
    case 'OUTSIDE_YEAR':
      return OPS_ERRORS.dateOutsideYear();
    default:
      return OPS_ERRORS.sectionUnavailable();
  }
}

export { STATUSES as ATTENDANCE_STATUS_ORDER };

/**
 * One student's attendance summary for the given (default: current) year — the single
 * implementation of the Phase 7 formula, shared by the staff API and the Phase 8 mobile views.
 * The caller must already have authorised access to this student.
 */
export async function attendanceSummaryFor(
  tx: TenantTransaction,
  school: School,
  studentId: string,
  academicYearId?: string,
): Promise<StudentAttendanceSummary | null> {
  const year = academicYearId
    ? await tx.academicYear.findFirst({ where: { id: academicYearId, schoolId: school.id } })
    : await tx.academicYear.findFirst({ where: { schoolId: school.id, isCurrent: true } });
  if (!year) return null;
  const where = { studentId, session: { academicYearId: year.id } };
  const [grouped, recent] = await Promise.all([
    tx.attendanceRecord.groupBy({ by: ['status'], where, _count: { _all: true } }),
    tx.attendanceRecord.findMany({
      where,
      include: { session: { include: { section: { include: { grade: true } } } } },
      orderBy: { session: { date: 'desc' } },
      take: 10,
    }),
  ]);
  const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
  for (const g of grouped) counts[g.status] = g._count._all;
  return {
    academicYearId: year.id,
    academicYearName: year.name,
    counts,
    attendanceRate: roundRate(attendancePercentage(counts)),
    recent: recent.map((r) => ({
      date: isoDate(r.session.date),
      sectionName: `${r.session.section.grade.name} ${r.session.section.name}`,
      status: r.status,
      note: r.note,
    })),
  };
}
