import type {
  TimetableEntry as EntryDto,
  TimetablePeriod as PeriodDto,
  TimetableWeek,
  Weekday,
} from '@acadlyx/types';
import { Injectable } from '@nestjs/common';
import { currentAuth } from '../../auth/core/access.guard.js';
import type { Prisma, School } from '../../generated/prisma/client.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import { uuidv7 } from '../../common/ids/uuid.js';
import { AcademicStore } from '../academic/academic-store.js';
import { OPS_ERRORS, violates } from './ops-errors.js';
import {
  fromHhmm,
  hhmm,
  myAssignments,
  personName,
  scopedSection,
  sectionUsable,
} from './ops-scope.js';
import type {
  CreateEntryDto,
  CreatePeriodDto,
  PeriodListQueryDto,
  ReorderPeriodsDto,
  UpdateEntryDto,
  UpdatePeriodDto,
} from './operations.dto.js';

const WEEK: Weekday[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];
/**
 * NOTE: never traverse TimetableEntry.period through Prisma — its composite key includes @db.Time
 * columns, which the Prisma 7 driver adapter cannot re-serialise as relation parameters. Periods
 * are loaded by id instead (one query per request, no N+1).
 */
const ENTRY_INCLUDE = {
  section: { include: { grade: true, branch: true } },
  subject: true,
  teacher: true,
} as const;
type EntryRow = Prisma.TimetableEntryGetPayload<{ include: typeof ENTRY_INCLUDE }>;
type PeriodNames = Map<string, string>;

/**
 * Weekly timetable (Phase 7, decisions M–P).
 *
 * - Named periods per Branch + AcademicYear (INSTRUCTIONAL / BREAK / LUNCH / ASSEMBLY) with explicit
 *   order; periods of one bell schedule never overlap (DB exclusion constraint).
 * - One recurring timetable per academic year (no effective dating — a documented V1 limitation).
 * - Entry = Section × weekday × period → Subject + Teacher. Entries copy their period's branch,
 *   year, type and local times through a composite FK (ON UPDATE CASCADE), so the database itself
 *   refuses: a section double-booked in a slot (unique), a teacher overlapping in real time even
 *   across branches (exclusion), a lesson in a non-instructional period (check). Service checks
 *   add: working day, subject in grade, ACTIVE teacher holding an open SUBJECT_TEACHER assignment.
 * - Setup allowed for PLANNED and ACTIVE years; CLOSED years are read-only.
 * - Teachers read their own timetable and their sections'; only `timetable.manage` edits.
 */
@Injectable()
export class TimetableService {
  constructor(private readonly store: AcademicStore) {}

  // ---- Periods -------------------------------------------------------------------------------

  periods(query: PeriodListQueryDto): Promise<PeriodDto[]> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      await this.scopeOf(tx, school, query.branchId, query.academicYearId);
      const rows = await tx.timetablePeriod.findMany({
        where: {
          schoolId: school.id,
          branchId: query.branchId,
          academicYearId: query.academicYearId,
        },
        include: { _count: { select: { entries: true } } },
        orderBy: [{ displayOrder: 'asc' }, { startTime: 'asc' }],
      });
      return rows.map((p) => ({ ...toPeriod(p), entryCount: p._count.entries }));
    });
  }

  createPeriod(dto: CreatePeriodDto): Promise<PeriodDto> {
    return this.guard(() =>
      this.store.mutate(async (tx, school, events) => {
        await this.scopeOf(tx, school, dto.branchId, dto.academicYearId, true);
        if (!(dto.startTime < dto.endTime)) throw OPS_ERRORS.periodTimes();
        const last = await tx.timetablePeriod.aggregate({
          where: {
            schoolId: school.id,
            branchId: dto.branchId,
            academicYearId: dto.academicYearId,
          },
          _max: { displayOrder: true },
        });
        const p = await tx.timetablePeriod.create({
          data: {
            tenantId: school.tenantId,
            schoolId: school.id,
            branchId: dto.branchId,
            academicYearId: dto.academicYearId,
            name: dto.name,
            type: dto.type,
            startTime: fromHhmm(dto.startTime),
            endTime: fromHhmm(dto.endTime),
            displayOrder: (last._max.displayOrder ?? -1) + 1,
          },
        });
        events.push({
          action: 'TIMETABLE_PERIOD_CREATED',
          resourceType: 'timetable_period',
          resourceId: p.id,
          metadata: { branchId: dto.branchId, academicYearId: dto.academicYearId },
        });
        return { ...toPeriod(p), entryCount: 0 };
      }),
    );
  }

  updatePeriod(id: string, dto: UpdatePeriodDto): Promise<PeriodDto> {
    return this.guard(() =>
      this.store.mutate(async (tx, school, events) => {
        const p = await tx.timetablePeriod.findFirst({ where: { id, schoolId: school.id } });
        if (!p) throw OPS_ERRORS.periodNotFound();
        await this.scopeOf(tx, school, p.branchId, p.academicYearId, true);
        const start = dto.startTime ?? hhmm(p.startTime);
        const end = dto.endTime ?? hhmm(p.endTime);
        if (!(start < end)) throw OPS_ERRORS.periodTimes();
        const data = {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(dto.startTime !== undefined ? { startTime: fromHhmm(dto.startTime) } : {}),
          ...(dto.endTime !== undefined ? { endTime: fromHhmm(dto.endTime) } : {}),
        };
        // Time/type changes cascade to the period's lessons; the DB re-checks teacher overlaps.
        const updated = await tx.timetablePeriod.update({
          where: { id },
          data,
          include: { _count: { select: { entries: true } } },
        });
        events.push({
          action: 'TIMETABLE_PERIOD_UPDATED',
          resourceType: 'timetable_period',
          resourceId: id,
          changedFields: Object.keys(data),
        });
        return { ...toPeriod(updated), entryCount: updated._count.entries };
      }),
    );
  }

  removePeriod(id: string): Promise<void> {
    return this.guard(() =>
      this.store.mutate(async (tx, school, events) => {
        const p = await tx.timetablePeriod.findFirst({
          where: { id, schoolId: school.id },
          include: { _count: { select: { entries: true } } },
        });
        if (!p) throw OPS_ERRORS.periodNotFound();
        await this.scopeOf(tx, school, p.branchId, p.academicYearId, true);
        if (p._count.entries > 0) throw OPS_ERRORS.periodInUse();
        await tx.timetablePeriod.delete({ where: { id } });
        events.push({
          action: 'TIMETABLE_PERIOD_REMOVED',
          resourceType: 'timetable_period',
          resourceId: id,
        });
      }),
    );
  }

  reorderPeriods(dto: ReorderPeriodsDto): Promise<PeriodDto[]> {
    return this.guard(() =>
      this.store.mutate(async (tx, school, events) => {
        await this.scopeOf(tx, school, dto.branchId, dto.academicYearId, true);
        const current = await tx.timetablePeriod.findMany({
          where: {
            schoolId: school.id,
            branchId: dto.branchId,
            academicYearId: dto.academicYearId,
          },
          select: { id: true },
        });
        const ids = new Set(current.map((c) => c.id));
        if (dto.ids.length !== ids.size || dto.ids.some((i) => !ids.has(i)))
          throw OPS_ERRORS.periodNotFound();
        // The (branch, year, display_order) unique is DEFERRABLE, so permutations commit cleanly.
        for (const [i, pid] of dto.ids.entries())
          await tx.timetablePeriod.update({ where: { id: pid }, data: { displayOrder: i } });
        events.push({
          action: 'TIMETABLE_PERIOD_UPDATED',
          resourceType: 'timetable_period',
          resourceId: dto.ids[0],
          changedFields: ['displayOrder'],
        });
        return (
          await tx.timetablePeriod.findMany({
            where: {
              schoolId: school.id,
              branchId: dto.branchId,
              academicYearId: dto.academicYearId,
            },
            include: { _count: { select: { entries: true } } },
            orderBy: { displayOrder: 'asc' },
          })
        ).map((p) => ({ ...toPeriod(p), entryCount: p._count.entries }));
      }),
    );
  }

  // ---- Entries -------------------------------------------------------------------------------

  createEntry(dto: CreateEntryDto): Promise<EntryDto> {
    return this.guard(() =>
      this.store.transact(async (tx, school, events) => {
        const v = await this.validateEntry(
          tx,
          school,
          dto.sectionId,
          dto.periodId,
          dto.weekday,
          dto.subjectId,
          dto.teacherId,
        );
        // Parameterised SQL: Prisma mis-serialises @db.Time values that are part of a composite FK.
        // Same transaction → same RLS/constraints; times are cast explicitly.
        const [{ id: newId }] = (await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO "timetable_entries" ("id", "tenant_id", "school_id", "branch_id", "academic_year_id",
            "section_id", "period_id", "period_type", "start_time", "end_time", "weekday", "subject_id", "teacher_id", "updated_at")
          VALUES (${uuidv7()}::uuid, ${school.tenantId}::uuid, ${school.id}::uuid, ${v.period.branchId}::uuid,
            ${v.period.academicYearId}::uuid, ${dto.sectionId}::uuid, ${v.period.id}::uuid,
            ${v.period.type}::"timetable_period_type", ${hhmm(v.period.startTime)}::time, ${hhmm(v.period.endTime)}::time,
            ${dto.weekday}::"weekday", ${dto.subjectId}::uuid, ${dto.teacherId}::uuid, now())
          RETURNING "id"`) as [{ id: string }];
        const row = await tx.timetableEntry.findUniqueOrThrow({
          where: { id: newId },
          include: ENTRY_INCLUDE,
        });
        const names: PeriodNames = new Map([[v.period.id, v.period.name]]);
        events.push({
          action: 'TIMETABLE_ENTRY_CREATED',
          resourceType: 'timetable_entry',
          resourceId: row.id,
          metadata: { sectionId: dto.sectionId, weekday: dto.weekday },
        });
        return toEntry(row, names);
      }),
    );
  }

  updateEntry(id: string, dto: UpdateEntryDto): Promise<EntryDto> {
    return this.guard(() =>
      this.store.transact(async (tx, school, events) => {
        const e = await tx.timetableEntry.findFirst({ where: { id, schoolId: school.id } });
        if (!e) throw OPS_ERRORS.entryNotFound();
        const v = await this.validateEntry(
          tx,
          school,
          e.sectionId,
          dto.periodId ?? e.periodId,
          dto.weekday ?? e.weekday,
          dto.subjectId ?? e.subjectId,
          dto.teacherId ?? e.teacherId,
        );
        await tx.$executeRaw`
          UPDATE "timetable_entries"
             SET "period_id" = ${v.period.id}::uuid,
                 "period_type" = ${v.period.type}::"timetable_period_type",
                 "start_time" = ${hhmm(v.period.startTime)}::time,
                 "end_time" = ${hhmm(v.period.endTime)}::time,
                 "weekday" = ${dto.weekday ?? e.weekday}::"weekday",
                 "subject_id" = ${dto.subjectId ?? e.subjectId}::uuid,
                 "teacher_id" = ${dto.teacherId ?? e.teacherId}::uuid,
                 "updated_at" = now()
           WHERE "id" = ${id}::uuid`;
        const row = await tx.timetableEntry.findUniqueOrThrow({
          where: { id },
          include: ENTRY_INCLUDE,
        });
        const names: PeriodNames = new Map([[v.period.id, v.period.name]]);
        events.push({
          action: 'TIMETABLE_ENTRY_UPDATED',
          resourceType: 'timetable_entry',
          resourceId: id,
          metadata: { sectionId: e.sectionId },
          changedFields: Object.keys(dto),
        });
        return toEntry(row, names);
      }),
    );
  }

  removeEntry(id: string): Promise<void> {
    return this.store.transact(async (tx, school, events) => {
      const e = await tx.timetableEntry.findFirst({
        where: { id, schoolId: school.id },
        include: { section: { include: { academicYear: true } } },
      });
      if (!e) throw OPS_ERRORS.entryNotFound();
      if (e.section.academicYear.status === 'CLOSED') throw OPS_ERRORS.yearClosed();
      await tx.timetableEntry.delete({ where: { id } });
      events.push({
        action: 'TIMETABLE_ENTRY_REMOVED',
        resourceType: 'timetable_entry',
        resourceId: id,
        metadata: { sectionId: e.sectionId, weekday: e.weekday },
      });
    });
  }

  // ---- Weekly views ---------------------------------------------------------------------------

  sectionWeek(sectionId: string): Promise<TimetableWeek> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const scope = await myAssignments(tx, school);
      const section = await scopedSection(tx, school, scope, sectionId);
      const [periods, entries] = await Promise.all([
        tx.timetablePeriod.findMany({
          where: {
            schoolId: school.id,
            branchId: section.branchId,
            academicYearId: section.academicYearId,
          },
          orderBy: [{ displayOrder: 'asc' }, { startTime: 'asc' }],
        }),
        tx.timetableEntry.findMany({ where: { sectionId: section.id }, include: ENTRY_INCLUDE }),
      ]);
      return {
        view: 'section',
        title: `${section.grade.name} ${section.name} · ${section.branch.name}`,
        academicYearId: section.academicYearId,
        academicYearName: section.academicYear.name,
        workingDays: orderedDays(school),
        periods: periods.map(toPeriod),
        entries: entries.map((e) => toEntry(e, new Map(periods.map((p) => [p.id, p.name])))),
        editable:
          currentAuth().permissions.includes('timetable.manage') &&
          section.academicYear.status !== 'CLOSED',
      };
    });
  }

  /** A teacher's week: 'me' = the caller's own profile; other teachers only for school-wide readers. */
  teacherWeek(teacherId: string, academicYearId?: string): Promise<TimetableWeek> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const scope = await myAssignments(tx, school);
      const id = teacherId === 'me' ? (scope?.teacherId ?? null) : teacherId;
      if (!id || (scope !== null && id !== scope.teacherId)) throw OPS_ERRORS.teacherNotFound();
      const teacher = await tx.teacher.findFirst({ where: { id, schoolId: school.id } });
      if (!teacher) throw OPS_ERRORS.teacherNotFound();
      const year = academicYearId
        ? await tx.academicYear.findFirst({ where: { id: academicYearId, schoolId: school.id } })
        : await tx.academicYear.findFirst({ where: { schoolId: school.id, isCurrent: true } });
      if (!year) throw OPS_ERRORS.contextNotFound();
      const entries = await tx.timetableEntry.findMany({
        where: { teacherId: teacher.id, academicYearId: year.id },
        include: ENTRY_INCLUDE,
      });
      // A teacher may span branches: rows are the union of the periods they teach in, by time.
      const periods = (
        await tx.timetablePeriod.findMany({
          where: { id: { in: [...new Set(entries.map((e) => e.periodId))] } },
        })
      ).sort((a, b) => hhmm(a.startTime).localeCompare(hhmm(b.startTime)));
      return {
        view: 'teacher',
        title: personName(teacher),
        academicYearId: year.id,
        academicYearName: year.name,
        workingDays: orderedDays(school),
        periods: periods.map(toPeriod),
        entries: entries.map((e) => toEntry(e, new Map(periods.map((p) => [p.id, p.name])))),
        editable: false,
      };
    });
  }

  // ---- helpers ---------------------------------------------------------------------------------

  /** Validates branch + year belong to the school; for writes the year must not be CLOSED. */
  private async scopeOf(
    tx: TenantTransaction,
    school: School,
    branchId: string,
    yearId: string,
    write = false,
  ) {
    const [branch, year] = await Promise.all([
      tx.branch.findFirst({ where: { id: branchId, schoolId: school.id } }),
      tx.academicYear.findFirst({ where: { id: yearId, schoolId: school.id } }),
    ]);
    if (!branch || !year) throw OPS_ERRORS.contextNotFound();
    if (write && year.status === 'CLOSED') throw OPS_ERRORS.yearClosed();
    return { branch, year };
  }

  private async validateEntry(
    tx: TenantTransaction,
    school: School,
    sectionId: string,
    periodId: string,
    weekday: Weekday,
    subjectId: string,
    teacherId: string,
  ) {
    const section = await tx.section.findFirst({
      where: { id: sectionId, schoolId: school.id },
      include: { branch: true, grade: true, academicYear: true },
    });
    if (!section) throw OPS_ERRORS.sectionNotFound();
    if (section.academicYear.status === 'CLOSED') throw OPS_ERRORS.yearClosed();
    if (!sectionUsable(section)) throw OPS_ERRORS.sectionUnavailable();
    const period = await tx.timetablePeriod.findFirst({
      where: { id: periodId, schoolId: school.id },
    });
    if (!period) throw OPS_ERRORS.periodNotFound();
    if (period.branchId !== section.branchId || period.academicYearId !== section.academicYearId)
      throw OPS_ERRORS.periodWrongBranch();
    if (period.type !== 'INSTRUCTIONAL') throw OPS_ERRORS.periodNotInstructional();
    if (!school.workingDays.includes(weekday)) throw OPS_ERRORS.nonWorkingDay();
    const subject = await tx.subject.findFirst({ where: { id: subjectId, schoolId: school.id } });
    if (!subject) throw OPS_ERRORS.subjectNotFound();
    if (
      !(await tx.gradeSubject.findFirst({
        where: { gradeId: section.gradeId, subjectId, schoolId: school.id },
      }))
    )
      throw OPS_ERRORS.subjectNotInGrade();
    const teacher = await tx.teacher.findFirst({ where: { id: teacherId, schoolId: school.id } });
    if (!teacher) throw OPS_ERRORS.teacherNotFound();
    if (teacher.status !== 'ACTIVE') throw OPS_ERRORS.teacherInactive();
    const holds = await tx.teacherAssignment.findFirst({
      where: { teacherId, sectionId, subjectId, endedAt: null, type: 'SUBJECT_TEACHER' },
    });
    if (!holds) throw OPS_ERRORS.teacherNotAssigned();
    return { section, period };
  }

  /** Database guarantees → stable domain errors (never constraint names). */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (violates(error, 'timetable_entries_teacher_no_overlap'))
        throw OPS_ERRORS.teacherConflict();
      if (violates(error, 'timetable_entries_section_id_weekday_period_id_key'))
        throw OPS_ERRORS.sectionConflict();
      if (violates(error, 'timetable_periods_no_overlap')) throw OPS_ERRORS.periodOverlap();
      if (violates(error, 'timetable_periods_branch_id_academic_year_id_name_key'))
        throw OPS_ERRORS.periodNameTaken();
      if (violates(error, 'timetable_entries_instructional_only')) throw OPS_ERRORS.periodInUse();
      if (violates(error, 'timetable_periods_times_ordered')) throw OPS_ERRORS.periodTimes();
      throw error;
    }
  }
}

function orderedDays(school: School): Weekday[] {
  const start = WEEK.indexOf(school.weekStartDay);
  return [...WEEK.slice(start), ...WEEK.slice(0, start)].filter((d) =>
    school.workingDays.includes(d),
  );
}

function toPeriod(p: {
  id: string;
  branchId: string;
  academicYearId: string;
  name: string;
  type: PeriodDto['type'];
  startTime: Date;
  endTime: Date;
  displayOrder: number;
}): Omit<PeriodDto, 'entryCount'> {
  return {
    id: p.id,
    branchId: p.branchId,
    academicYearId: p.academicYearId,
    name: p.name,
    type: p.type,
    startTime: hhmm(p.startTime),
    endTime: hhmm(p.endTime),
    displayOrder: p.displayOrder,
  };
}

function toEntry(e: EntryRow, names: PeriodNames): EntryDto {
  return {
    id: e.id,
    sectionId: e.sectionId,
    sectionName: `${e.section.grade.name} ${e.section.name}`,
    branchName: e.section.branch.name,
    weekday: e.weekday,
    periodId: e.periodId,
    periodName: names.get(e.periodId) ?? '',
    startTime: hhmm(e.startTime),
    endTime: hhmm(e.endTime),
    subjectId: e.subjectId,
    subjectName: e.subject.name,
    teacherId: e.teacherId,
    teacherName: personName(e.teacher),
  };
}
