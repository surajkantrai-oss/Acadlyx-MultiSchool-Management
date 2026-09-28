import type { ActivityItem } from '@acadlyx/types';
import { Prisma, type School } from '../../generated/prisma/client.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';

/** How many humanised events the dashboard shows, and the bounded candidate window scanned. */
export const ACTIVITY_LIMIT = 10;
const CANDIDATES = 60;

type Resolved = { name: string | null; href: string | null } | null;

interface Row {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  actor_user_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

const IMPORT_TYPE: Record<string, string> = {
  STUDENTS: 'Student',
  PARENTS: 'Guardian',
  TEACHERS: 'Teacher',
};
const STATUS: Record<string, string> = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  WITHDRAWN: 'withdrawn',
  GRADUATED: 'graduated',
};

/**
 * Supported AuditLog actions → fixed school-facing messages. Only actions the Phase 5 code
 * actually records are listed; anything else (security events, platform actions, profile edits
 * with before/after fields) is never selected.
 */
const MESSAGES: Record<string, (m: Record<string, unknown>) => string> = {
  STUDENT_CREATED: () => 'Student profile created',
  STUDENT_STATUS_CHANGED: (m) => `Student marked ${STATUS[String(m.to)] ?? 'updated'}`,
  GUARDIAN_LINKED: () => 'Guardian linked to student',
  GUARDIAN_UNLINKED: () => 'Guardian unlinked from student',
  ENROLLMENT_CREATED: () => 'Student placed in a class',
  ENROLLMENT_TRANSFERRED: () => 'Student moved to another class',
  ENROLLMENT_UPDATED: () => 'Class placement ended',
  PARENT_CREATED: () => 'Guardian profile created',
  TEACHER_CREATED: () => 'Teacher profile created',
  TEACHER_STATUS_CHANGED: (m) =>
    m.to === 'INACTIVE' ? 'Teacher deactivated' : 'Teacher activated',
  TEACHER_ASSIGNMENT_CREATED: () => 'Teacher assigned to a class',
  TEACHER_ASSIGNMENT_REMOVED: () => 'Teacher assignment ended',
  IMPORT_COMPLETED: (m) => `${IMPORT_TYPE[String(m.type)] ?? 'Bulk'} import completed`,
  IMPORT_FAILED: () => 'Bulk import failed',
  PROFILE_ACCOUNT_CREATED: () => 'Login account created',
  PROFILE_ACCOUNT_LINKED: () => 'Login account linked',
  ACTIVATION_CODE_ISSUED: () => 'Account activation started',
  // Phase 7 — class-level wording only: never an individual student's attendance.
  ATTENDANCE_RECORDED: () => 'Attendance recorded',
  ATTENDANCE_CORRECTED: () => 'Attendance corrected',
  HOMEWORK_PUBLISHED: () => 'Homework published',
  ASSIGNMENT_PUBLISHED: () => 'Assignment published',
  TIMETABLE_ENTRY_CREATED: () => 'Timetable updated',
  TIMETABLE_ENTRY_REMOVED: () => 'Timetable updated',
};
const ACTIONS = Object.keys(MESSAGES);

const name = (p: { firstName: string; middleName: string | null; lastName: string | null }) =>
  [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ');
const ids = (rows: Row[], pick: (r: Row) => unknown) => [
  ...new Set(rows.map(pick).filter((v): v is string => typeof v === 'string')),
];

/**
 * Recent school activity from the existing AuditLog (no new table, events or queue).
 *
 * - Runs inside the tenant transaction (acadlyx_app → FORCE RLS on audit_logs).
 * - One bounded query: supported actions only, newest first, LIMIT 60. Per-row audit entries
 *   written by the bulk-import worker (metadata.importJobId) are excluded; the import itself
 *   appears once as "… import completed".
 * - AuditLog has no school column, so every candidate is resolved against THIS school's tables
 *   (≈8 batched id lookups). Events whose record is not in this school are dropped — this is what
 *   keeps a second school of the same tenant out.
 * - Output is a fixed message + display names only; no ids as text, no IP/user agent/metadata.
 */
export async function recentActivity(
  tx: TenantTransaction,
  school: School,
): Promise<ActivityItem[]> {
  const rows = await tx.$queryRaw<Row[]>(Prisma.sql`
    SELECT id, action, resource_type, resource_id, actor_user_id, metadata, created_at
      FROM audit_logs
     WHERE tenant_id = ${school.tenantId}::uuid
       AND action IN (${Prisma.join(ACTIONS)})
       AND (action LIKE 'IMPORT_%' OR metadata IS NULL OR NOT (metadata ? 'importJobId'))
       AND NOT (action = 'ENROLLMENT_UPDATED' AND resource_type <> 'student_enrollment')
     ORDER BY created_at DESC, id DESC
     LIMIT ${CANDIDATES}`);
  if (rows.length === 0) return [];

  const s = { schoolId: school.id };
  const of = (type: string) => rows.filter((r) => r.resource_type === type);
  const studentIds = [
    ...ids(of('student'), (r) => r.resource_id),
    ...ids(rows, (r) => r.metadata?.studentId),
  ];
  const personSelect = { id: true, firstName: true, middleName: true, lastName: true } as const;
  const sectionIds = [
    ...ids(of('timetable_entry'), (r) => r.metadata?.sectionId),
    ...ids(of('attendance_session'), (r) => r.metadata?.sectionId),
    ...ids(of('homework'), (r) => r.metadata?.sectionId),
    ...ids(of('assignment'), (r) => r.metadata?.sectionId),
  ];
  const [sessions, homework, classAssignments, sections] = await Promise.all([
    tx.attendanceSession.findMany({
      where: { ...s, id: { in: ids(of('attendance_session'), (r) => r.resource_id) } },
      select: { id: true, sectionId: true, date: true },
    }),
    tx.homework.findMany({
      where: { ...s, id: { in: ids(of('homework'), (r) => r.resource_id) } },
      select: { id: true, sectionId: true },
    }),
    tx.assignment.findMany({
      where: { ...s, id: { in: ids(of('assignment'), (r) => r.resource_id) } },
      select: { id: true, sectionId: true },
    }),
    tx.section.findMany({
      where: { ...s, id: { in: sectionIds } },
      select: { id: true, name: true, grade: { select: { name: true } } },
    }),
  ]);
  const [students, parents, teachers, enrollments, assignments, jobs, profiles, actors] =
    await Promise.all([
      tx.student.findMany({ where: { ...s, id: { in: studentIds } }, select: personSelect }),
      tx.parent.findMany({
        where: { ...s, id: { in: ids(of('parent'), (r) => r.resource_id) } },
        select: personSelect,
      }),
      tx.teacher.findMany({
        where: { ...s, id: { in: ids(of('teacher'), (r) => r.resource_id) } },
        select: personSelect,
      }),
      tx.studentEnrollment.findMany({
        where: { ...s, id: { in: ids(of('student_enrollment'), (r) => r.resource_id) } },
        select: { id: true, student: { select: personSelect } },
      }),
      tx.teacherAssignment.findMany({
        where: { ...s, id: { in: ids(of('teacher_assignment'), (r) => r.resource_id) } },
        select: { id: true, teacher: { select: personSelect } },
      }),
      tx.bulkImportJob.findMany({
        where: { ...s, id: { in: ids(of('bulk_import'), (r) => r.resource_id) } },
        select: { id: true },
      }),
      // Activation events reference the login (user); show them only if that login belongs to a
      // profile of this school.
      (async () => {
        const userIds = ids(of('user'), (r) => r.resource_id);
        if (!userIds.length) return [] as { userId: string; label: string; href: string }[];
        const where = { ...s, userId: { in: userIds } };
        const sel = { ...personSelect, userId: true } as const;
        const [a, b, c] = await Promise.all([
          tx.student.findMany({ where, select: sel }),
          tx.parent.findMany({ where, select: sel }),
          tx.teacher.findMany({ where, select: sel }),
        ]);
        return [
          ...a.map((p) => ({
            userId: p.userId ?? '',
            label: name(p),
            href: `/people/students/${p.id}`,
          })),
          ...b.map((p) => ({
            userId: p.userId ?? '',
            label: name(p),
            href: `/people/parents/${p.id}`,
          })),
          ...c.map((p) => ({
            userId: p.userId ?? '',
            label: name(p),
            href: `/people/teachers/${p.id}`,
          })),
        ];
      })(),
      tx.user.findMany({
        where: { id: { in: ids(rows, (r) => r.actor_user_id) } },
        select: { id: true, displayName: true },
      }),
    ]);

  const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
  const st = byId(students);
  const pa = byId(parents);
  const te = byId(teachers);
  const en = byId(enrollments);
  const as = byId(assignments);
  const jb = byId(jobs);
  const pr = new Map(profiles.map((p) => [p.userId, p]));
  const ac = new Map(actors.map((u) => [u.id, u.displayName]));
  const se = new Map(sections.map((x) => [x.id, `${x.grade.name} ${x.name}`]));
  const ss = new Map(sessions.map((x) => [x.id, x]));
  const hw = new Map(homework.map((x) => [x.id, x]));
  const ca = new Map(classAssignments.map((x) => [x.id, x]));
  const cls = (sectionId: string | undefined, href: string | null): Resolved => {
    const label = sectionId ? se.get(sectionId) : undefined;
    return label ? { name: label, href } : null;
  };
  const student = (id: unknown): Resolved => {
    const p = typeof id === 'string' ? st.get(id) : undefined;
    return p ? { name: name(p), href: `/people/students/${p.id}` } : null;
  };

  const resolve = (r: Row): Resolved => {
    const id = r.resource_id ?? '';
    switch (r.resource_type) {
      case 'student':
        return student(id);
      case 'parent': {
        const p = pa.get(id);
        return p ? { name: name(p), href: `/people/parents/${p.id}` } : null;
      }
      case 'teacher': {
        const p = te.get(id);
        return p ? { name: name(p), href: `/people/teachers/${p.id}` } : null;
      }
      case 'student_enrollment': {
        const e = en.get(id);
        return e ? { name: name(e.student), href: `/people/students/${e.student.id}` } : null;
      }
      case 'student_guardian':
        return student(r.metadata?.studentId);
      case 'teacher_assignment': {
        const a = as.get(id);
        return a ? { name: name(a.teacher), href: `/people/teachers/${a.teacher.id}` } : null;
      }
      case 'bulk_import':
        return jb.has(id) ? { name: null, href: `/people/imports/${id}` } : null;
      case 'attendance_session': {
        const x = ss.get(id);
        return x
          ? cls(x.sectionId, `/attendance/${x.sectionId}?date=${x.date.toISOString().slice(0, 10)}`)
          : null;
      }
      case 'homework': {
        const x = hw.get(id);
        return x ? cls(x.sectionId, `/homework/${x.id}`) : null;
      }
      case 'assignment': {
        const x = ca.get(id);
        return x ? cls(x.sectionId, `/assignments/${x.id}`) : null;
      }
      case 'timetable_entry': {
        const sid = typeof r.metadata?.sectionId === 'string' ? r.metadata.sectionId : undefined;
        return cls(sid, sid ? `/timetable?section=${sid}` : null);
      }
      case 'user': {
        const p = pr.get(id);
        return p ? { name: p.label, href: p.href } : null;
      }
      default:
        return null;
    }
  };

  const out: ActivityItem[] = [];
  for (const r of rows) {
    const found = resolve(r);
    if (!found) continue; // not (or no longer) a record of this school
    const message = MESSAGES[r.action]?.(r.metadata ?? {});
    if (!message) continue;
    out.push({
      key: r.id,
      at: r.created_at.toISOString(),
      message,
      subject: found.name,
      actorName: r.actor_user_id ? (ac.get(r.actor_user_id) ?? null) : null,
      href: found.href,
    });
    if (out.length === ACTIVITY_LIMIT) break;
  }
  return out;
}
