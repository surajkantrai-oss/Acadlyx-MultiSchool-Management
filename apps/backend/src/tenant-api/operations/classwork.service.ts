import type { Paginated } from '@acadlyx/tenant-config';
import type { ClassworkItem, ClassworkKind, ClassworkTarget } from '@acadlyx/types';
import { Injectable } from '@nestjs/common';
import { currentAuth } from '../../auth/core/access.guard.js';
import type { AuditEvent } from '../../common/audit/audit.service.js';
import type { Prisma, School } from '../../generated/prisma/client.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import { AcademicStore } from '../academic/academic-store.js';
import { paginated, paging } from '../people/people-mappers.js';
import { OPS_ERRORS } from './ops-errors.js';
import {
  authUserId,
  fromIsoDate,
  isoDate,
  myAssignments,
  personName,
  type Scope,
  SECTION_OPS_INCLUDE,
  type SectionWithOps,
  sectionUsable,
  toOpsSection,
} from './ops-scope.js';
import type {
  ClassworkQueryDto,
  CreateClassworkDto,
  UpdateClassworkDto,
} from './operations.dto.js';

type Status = 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'ARCHIVED';
const INCLUDE = {
  section: { include: SECTION_OPS_INCLUDE },
  subject: true,
  teacher: true,
} as const;

interface Row {
  id: string;
  sectionId: string;
  subjectId: string;
  teacherId: string | null;
  title: string;
  instructions: string | null;
  assignedDate: Date;
  dueDate: Date;
  status: Status;
  version: number;
  createdByUserId: string;
  publishedAt: Date | null;
  closedAt?: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  section: SectionWithOps;
  subject: { id: string; name: string };
  teacher: {
    id: string;
    firstName: string;
    middleName: string | null;
    lastName: string | null;
  } | null;
}

/**
 * Homework and Assignments (Phase 7, decisions F–L). Two tables with different lifecycles, one
 * implementation (no duplicated logic):
 *   Homework:   DRAFT → PUBLISHED → ARCHIVED
 *   Assignment: DRAFT → PUBLISHED → CLOSED → ARCHIVED (PUBLISHED → ARCHIVED also allowed)
 * Drafts are deletable (DB-enforced by a restrictive RLS policy); published work is never
 * hard-deleted. Dates are school-local, date-only; due ≥ assigned. No submissions (Phase 8), no
 * grading (Phase 9), no attachments (documents phase), no notifications.
 *
 * Scope: school-wide users see and manage everything; a teacher sees work of sections they teach,
 * drafts only if they created them, and manages only section + subject pairs they hold an open
 * SUBJECT_TEACHER assignment for. The author is always taken from the session (never the body).
 */
@Injectable()
export class ClassworkService {
  constructor(private readonly store: AcademicStore) {}

  private model(tx: TenantTransaction, kind: ClassworkKind) {
    return (kind === 'homework' ? tx.homework : tx.assignment) as unknown as typeof tx.homework;
  }

  list(kind: ClassworkKind, query: ClassworkQueryDto): Promise<Paginated<ClassworkItem>> {
    const { page, pageSize, skip, take } = paging(query);
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const scope = await myAssignments(tx, school);
      const where: Prisma.HomeworkWhereInput = {
        AND: [
          { schoolId: school.id },
          scopeFilter(scope),
          query.status ? { status: query.status as 'DRAFT' } : { status: { not: 'ARCHIVED' } },
          query.sectionId ? { sectionId: query.sectionId } : {},
          query.subjectId ? { subjectId: query.subjectId } : {},
          query.teacherId ? { teacherId: query.teacherId } : {},
          query.academicYearId ? { section: { academicYearId: query.academicYearId } } : {},
          query.dueFrom || query.dueTo
            ? {
                dueDate: {
                  ...(query.dueFrom ? { gte: fromIsoDate(query.dueFrom) } : {}),
                  ...(query.dueTo ? { lte: fromIsoDate(query.dueTo) } : {}),
                },
              }
            : {},
          query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {},
        ],
      };
      const m = this.model(tx, kind);
      const [total, rows] = await Promise.all([
        m.count({ where }),
        m.findMany({
          where,
          include: INCLUDE,
          orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          skip,
          take,
        }),
      ]);
      const names = await this.creatorNames(tx, rows);
      return paginated(
        (rows as unknown as Row[]).map((r) => this.toItem(kind, r, scope, names)),
        total,
        page,
        pageSize,
      );
    });
  }

  get(kind: ClassworkKind, id: string): Promise<ClassworkItem> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const scope = await myAssignments(tx, school);
      const row = await this.find(tx, kind, school, scope, id);
      return this.toItem(kind, row, scope, await this.creatorNames(tx, [row]));
    });
  }

  /** Section + subject pairs the caller may create work for (for the form selectors). */
  targets(): Promise<ClassworkTarget[]> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const scope = await myAssignments(tx, school);
      const sections = await tx.section.findMany({
        where: {
          schoolId: school.id,
          isActive: true,
          academicYear: { status: 'ACTIVE' },
          ...(scope
            ? { id: { in: [...new Set([...scope.pairs].map((p) => p.split(':')[0] ?? ''))] } }
            : {}),
        },
        include: {
          ...SECTION_OPS_INCLUDE,
          grade: {
            include: {
              gradeSubjects: { include: { subject: true }, orderBy: { displayOrder: 'asc' } },
            },
          },
        },
        orderBy: [{ grade: { displayOrder: 'asc' } }, { displayOrder: 'asc' }],
      });
      return sections
        .map((s) => ({
          ...toOpsSection(s),
          gradeName: s.grade.name,
          subjects: s.grade.gradeSubjects
            .filter(
              (g) =>
                g.subject.isActive && (scope === null || scope.pairs.has(`${s.id}:${g.subjectId}`)),
            )
            .map((g) => ({ id: g.subject.id, name: g.subject.name })),
        }))
        .filter((t) => t.subjects.length > 0);
    });
  }

  create(kind: ClassworkKind, dto: CreateClassworkDto): Promise<ClassworkItem> {
    return this.store
      .transact(async (tx, school, events) => {
        const scope = await myAssignments(tx, school);
        const section = await this.writableTarget(tx, school, scope, dto.sectionId, dto.subjectId);
        this.checkDates(section, dto.assignedDate, dto.dueDate);
        const teacherId = await this.responsibleTeacher(
          tx,
          school,
          scope,
          dto.sectionId,
          dto.subjectId,
          dto.teacherId,
        );
        const row = await this.model(tx, kind).create({
          data: {
            tenantId: school.tenantId,
            schoolId: school.id,
            sectionId: section.id,
            subjectId: dto.subjectId,
            teacherId,
            title: dto.title,
            instructions: dto.instructions ?? null,
            assignedDate: fromIsoDate(dto.assignedDate),
            dueDate: fromIsoDate(dto.dueDate),
            status: 'DRAFT',
            createdByUserId: authUserId(),
          },
        });
        events.push(
          audit(kind, 'CREATED', row.id, { sectionId: section.id, subjectId: dto.subjectId }),
        );
        return row.id;
      })
      .then((id) => this.get(kind, id));
  }

  update(kind: ClassworkKind, id: string, dto: UpdateClassworkDto): Promise<ClassworkItem> {
    return this.store
      .transact(async (tx, school, events) => {
        const scope = await myAssignments(tx, school);
        const row = await this.find(tx, kind, school, scope, id);
        this.assertManage(kind, scope, row);
        if (row.status !== 'DRAFT' && row.status !== 'PUBLISHED') throw OPS_ERRORS.notEditable();
        if (row.section.academicYear.status === 'CLOSED') throw OPS_ERRORS.yearClosed();
        const assigned = dto.assignedDate ?? isoDate(row.assignedDate);
        const due = dto.dueDate ?? isoDate(row.dueDate);
        this.checkDates(row.section, assigned, due);
        const teacherId =
          dto.teacherId !== undefined
            ? await this.responsibleTeacher(
                tx,
                school,
                scope,
                row.sectionId,
                row.subjectId,
                dto.teacherId,
              )
            : row.teacherId;
        const data = {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.instructions !== undefined ? { instructions: dto.instructions ?? null } : {}),
          ...(dto.assignedDate !== undefined
            ? { assignedDate: fromIsoDate(dto.assignedDate) }
            : {}),
          ...(dto.dueDate !== undefined ? { dueDate: fromIsoDate(dto.dueDate) } : {}),
          ...(dto.teacherId !== undefined ? { teacherId } : {}),
        };
        const res = await this.model(tx, kind).updateMany({
          where: { id: row.id, version: dto.expectedVersion, status: row.status as 'DRAFT' },
          data: { ...data, version: { increment: 1 } },
        });
        if (res.count !== 1) throw OPS_ERRORS.staleVersion();
        events.push({
          ...audit(kind, 'UPDATED', row.id, { sectionId: row.sectionId }),
          changedFields: Object.keys(data), // names only — never the text bodies
        });
        return row.id;
      })
      .then(() => this.get(kind, id));
  }

  /** DRAFT → PUBLISHED (re-validates everything), PUBLISHED → CLOSED (assignments), → ARCHIVED. */
  transition(
    kind: ClassworkKind,
    id: string,
    to: 'PUBLISHED' | 'CLOSED' | 'ARCHIVED',
    expectedVersion: number,
  ) {
    return this.store
      .transact(async (tx, school, events) => {
        const scope = await myAssignments(tx, school);
        const row = await this.find(tx, kind, school, scope, id);
        this.assertManage(kind, scope, row);
        const allowed: Record<string, Status[]> =
          kind === 'homework'
            ? { PUBLISHED: ['DRAFT'], ARCHIVED: ['PUBLISHED'] }
            : { PUBLISHED: ['DRAFT'], CLOSED: ['PUBLISHED'], ARCHIVED: ['PUBLISHED', 'CLOSED'] };
        if (!(allowed[to] ?? []).includes(row.status))
          throw OPS_ERRORS.invalidTransition(row.status, to);
        if (row.section.academicYear.status === 'CLOSED') throw OPS_ERRORS.yearClosed();
        if (to === 'PUBLISHED') {
          // Publishing re-checks the class, subject mapping, assignment and dates as of now.
          await this.writableTarget(tx, school, scope, row.sectionId, row.subjectId);
          this.checkDates(row.section, isoDate(row.assignedDate), isoDate(row.dueDate));
        }
        const now = new Date();
        const stamp =
          to === 'PUBLISHED'
            ? { publishedAt: now }
            : to === 'CLOSED'
              ? { closedAt: now }
              : { archivedAt: now };
        const res = await this.model(tx, kind).updateMany({
          where: { id: row.id, version: expectedVersion, status: row.status as 'DRAFT' },
          data: {
            status: to as 'PUBLISHED',
            ...stamp,
            version: { increment: 1 },
          },
        });
        if (res.count !== 1) throw OPS_ERRORS.staleVersion();
        events.push(
          audit(
            kind,
            to === 'PUBLISHED' ? 'PUBLISHED' : to === 'CLOSED' ? 'CLOSED' : 'ARCHIVED',
            row.id,
            { sectionId: row.sectionId },
          ),
        );
        return row.id;
      })
      .then(() => this.get(kind, id));
  }

  remove(kind: ClassworkKind, id: string): Promise<void> {
    return this.store.transact(async (tx, school, events) => {
      const scope = await myAssignments(tx, school);
      const row = await this.find(tx, kind, school, scope, id);
      this.assertManage(kind, scope, row);
      if (row.status !== 'DRAFT') throw OPS_ERRORS.invalidTransition(row.status, 'DELETED');
      // The DB policy also refuses deleting anything but a draft.
      const res = await this.model(tx, kind).deleteMany({ where: { id: row.id, status: 'DRAFT' } });
      if (res.count !== 1) throw OPS_ERRORS.staleVersion();
      events.push(audit(kind, 'DELETED', row.id, { sectionId: row.sectionId }));
    });
  }

  // ---- helpers ---------------------------------------------------------------------------------

  private async find(
    tx: TenantTransaction,
    kind: ClassworkKind,
    school: School,
    scope: Scope,
    id: string,
  ): Promise<Row> {
    const row = (await this.model(tx, kind).findFirst({
      where: { AND: [{ id, schoolId: school.id }, scopeFilter(scope)] },
      include: INCLUDE,
    })) as unknown as Row | null;
    if (!row) throw OPS_ERRORS.classworkNotFound(kind);
    return row;
  }

  /** Section must be usable in an ACTIVE year; subject mapped to its grade; teacher holds the pair. */
  private async writableTarget(
    tx: TenantTransaction,
    school: School,
    scope: Scope,
    sectionId: string,
    subjectId: string,
  ) {
    if (scope !== null && !scope.sections.has(sectionId)) throw OPS_ERRORS.sectionNotFound();
    const section = await tx.section.findFirst({
      where: { id: sectionId, schoolId: school.id },
      include: SECTION_OPS_INCLUDE,
    });
    if (!section) throw OPS_ERRORS.sectionNotFound();
    const subject = await tx.subject.findFirst({ where: { id: subjectId, schoolId: school.id } });
    if (!subject) throw OPS_ERRORS.subjectNotFound();
    if (scope !== null && !scope.pairs.has(`${sectionId}:${subjectId}`))
      throw OPS_ERRORS.notAssigned();
    if (section.academicYear.status === 'CLOSED') throw OPS_ERRORS.yearClosed();
    if (section.academicYear.status !== 'ACTIVE') throw OPS_ERRORS.yearNotActive();
    if (!sectionUsable(section) || !subject.isActive) throw OPS_ERRORS.sectionUnavailable();
    const mapped = await tx.gradeSubject.findFirst({
      where: { gradeId: section.gradeId, subjectId, schoolId: school.id },
    });
    if (!mapped) throw OPS_ERRORS.subjectNotInGrade();
    return section;
  }

  private checkDates(section: SectionWithOps, assigned: string, due: string) {
    if (due < assigned) throw OPS_ERRORS.dueBeforeAssigned();
    const start = isoDate(section.academicYear.startDate);
    const end = isoDate(section.academicYear.endDate);
    if (assigned < start || assigned > end || due < start || due > end)
      throw OPS_ERRORS.dateOutsideYear();
  }

  /** Teachers are always themselves; leadership may name an ACTIVE teacher who holds the pair. */
  private async responsibleTeacher(
    tx: TenantTransaction,
    school: School,
    scope: Scope,
    sectionId: string,
    subjectId: string,
    requested: string | null | undefined,
  ): Promise<string | null> {
    if (scope !== null) return scope.teacherId;
    if (!requested) return null;
    const teacher = await tx.teacher.findFirst({ where: { id: requested, schoolId: school.id } });
    if (!teacher) throw OPS_ERRORS.teacherNotFound();
    if (teacher.status !== 'ACTIVE') throw OPS_ERRORS.teacherInactive();
    const holds = await tx.teacherAssignment.findFirst({
      where: {
        teacherId: teacher.id,
        sectionId,
        subjectId,
        endedAt: null,
        type: 'SUBJECT_TEACHER',
      },
    });
    if (!holds) throw OPS_ERRORS.teacherNotAssigned();
    return teacher.id;
  }

  private assertManage(kind: ClassworkKind, scope: Scope, row: Row) {
    const needed = kind === 'homework' ? 'homework.manage' : 'assignment.manage';
    if (!currentAuth().permissions.includes(needed)) throw OPS_ERRORS.notAssigned();
    if (scope !== null && !scope.pairs.has(`${row.sectionId}:${row.subjectId}`))
      throw OPS_ERRORS.notAssigned();
  }

  private async creatorNames(tx: TenantTransaction, rows: Row[]) {
    const users = await tx.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.createdByUserId))] } },
      select: { id: true, displayName: true },
    });
    return new Map(users.map((u) => [u.id, u.displayName]));
  }

  private toItem(
    kind: ClassworkKind,
    r: Row,
    scope: Scope,
    names: Map<string, string>,
  ): ClassworkItem {
    const canManage =
      currentAuth().permissions.includes(
        kind === 'homework' ? 'homework.manage' : 'assignment.manage',
      ) &&
      (scope === null || scope.pairs.has(`${r.sectionId}:${r.subjectId}`)) &&
      r.section.academicYear.status !== 'CLOSED';
    return {
      ...toOpsSection(r.section),
      id: r.id,
      kind,
      gradeName: r.section.grade.name,
      subjectId: r.subjectId,
      subjectName: r.subject.name,
      teacher: r.teacher ? { id: r.teacher.id, name: personName(r.teacher) } : null,
      title: r.title,
      instructions: r.instructions,
      assignedDate: isoDate(r.assignedDate),
      dueDate: isoDate(r.dueDate),
      status: r.status,
      version: r.version,
      createdByName: names.get(r.createdByUserId) ?? null,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      closedAt: r.closedAt?.toISOString() ?? null,
      archivedAt: r.archivedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      can: {
        edit: canManage && (r.status === 'DRAFT' || r.status === 'PUBLISHED'),
        publish: canManage && r.status === 'DRAFT',
        close: canManage && kind === 'assignments' && r.status === 'PUBLISHED',
        archive: canManage && (r.status === 'PUBLISHED' || r.status === 'CLOSED'),
        delete: canManage && r.status === 'DRAFT',
      },
    };
  }
}

/** Teachers: sections they teach; drafts only their own. */
function scopeFilter(scope: Scope): Prisma.HomeworkWhereInput {
  if (scope === null) return {};
  return {
    sectionId: { in: [...scope.sections] },
    OR: [{ status: { not: 'DRAFT' } }, { createdByUserId: authUserId() }],
  };
}

function audit(
  kind: ClassworkKind,
  verb: string,
  id: string,
  metadata: Record<string, unknown>,
): AuditEvent {
  const noun = kind === 'homework' ? 'HOMEWORK' : 'ASSIGNMENT';
  return {
    action: `${noun}_${verb}`,
    resourceType: kind === 'homework' ? 'homework' : 'assignment',
    resourceId: id,
    metadata,
  };
}
