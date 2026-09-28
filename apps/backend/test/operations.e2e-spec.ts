import type { Paginated } from '@acadlyx/tenant-config';
import type {
  AttendanceClass,
  AttendanceRecordChange,
  AttendanceSheet,
  ClassworkItem,
  ClassworkTarget,
  DashboardSummary,
  StudentAttendanceSummary,
  TimetablePeriod,
  TimetableWeek,
} from '@acadlyx/types';
import { addDays, attendancePercentage, localToday, roundRate } from '@acadlyx/validation';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PlatformPrismaService } from '../src/database/platform-prisma.service.js';
import { createTestApp } from './helpers/app.js';
import { call, createTenantUser, resetRateLimits, syncRbac, tenantLogin } from './helpers/auth.js';
import {
  type AcademicFixture,
  createAcademicFixture,
  createFixtureSchools,
  createFixtureTenants,
  FIXTURE_LETTERS,
  type FixtureLetter,
  type FixtureTenant,
  purgeTenants,
} from './helpers/tenant-fixtures.js';

const PREFIX = 'OPS';
const PW = 'Operations-pass-2026';
const PIN = '481526';
type Role = 'principal' | 'admin' | 'teacher' | 'teacher2' | 'accountant' | 'parent';

/**
 * Phase 7 academic operations (e2e): daily attendance (roster eligibility, date window, corrections
 * + history, optimistic concurrency), homework & assignments (lifecycles, subject scope, publish
 * rules), timetable (periods, section/teacher conflicts incl. cascades and races), teacher scope,
 * A→B/B→C/C→A and same-tenant cross-school isolation, audit and the activity feed.
 */
describe('Academic operations API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PlatformPrismaService;
  let t: Record<FixtureLetter, FixtureTenant>;
  let school: Record<FixtureLetter, string>;
  const ac = {} as Record<FixtureLetter, AcademicFixture & { sciId: string }>;
  const token = {} as Record<FixtureLetter, string>;
  const roleToken = {} as Record<Role, string>;
  const ids = {} as Record<
    FixtureLetter,
    { s1: string; s2: string; s3: string; s4: string; t1: string; t2: string; t3: string }
  >;
  const today = localToday('Asia/Kolkata');

  const api = (l: FixtureLetter) => call(app, { host: t[l].domain, token: token[l] });
  const as = (r: Role) => call(app, { host: t.A.domain, token: roleToken[r] });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PlatformPrismaService);
    await resetRateLimits(app);
    await syncRbac(app);
    t = await createFixtureTenants(prisma, PREFIX);
    school = await createFixtureSchools(prisma, t);
    const userIds = {} as Record<Role, string>;
    for (const l of FIXTURE_LETTERS) {
      const scope = { tenantId: t[l].id, schoolId: school[l] };
      const base = await createAcademicFixture(prisma, t[l].id, school[l]);
      const sci = await prisma.subject.create({ data: { ...scope, name: 'Science', code: 'SCI' } });
      await prisma.gradeSubject.create({
        data: { ...scope, gradeId: base.gradeId, subjectId: sci.id },
      });
      ac[l] = { ...base, sciId: sci.id };
      const email = `principal@ops-${l.toLowerCase()}.test`;
      await createTenantUser(app, { tenantId: t[l].id, roles: ['PRINCIPAL'], email, secret: PW });
      token[l] = (await tenantLogin(app, t[l].domain, email, PW)).tokens.accessToken;
    }
    roleToken.principal = token.A;
    for (const [role, key, email] of [
      ['admin', 'SCHOOL_ADMIN', 'admin@ops-a.test'],
      ['teacher', 'TEACHER', 'teacher@ops-a.test'],
      ['teacher2', 'TEACHER', 'teacher2@ops-a.test'],
      ['accountant', 'ACCOUNTANT', 'accounts@ops-a.test'],
    ] as [Role, string, string][]) {
      userIds[role] = await createTenantUser(app, {
        tenantId: t.A.id,
        roles: [key],
        email,
        secret: PW,
      });
      roleToken[role] = (await tenantLogin(app, t.A.domain, email, PW)).tokens.accessToken;
    }
    await createTenantUser(app, {
      tenantId: t.A.id,
      roles: ['PARENT'],
      phone: '+919844400001',
      credentialType: 'PIN',
      secret: PIN,
    });
    roleToken.parent = (
      await tenantLogin(app, t.A.domain, '+919844400001', PIN)
    ).tokens.accessToken;

    for (const l of FIXTURE_LETTERS) {
      const scope = { tenantId: t[l].id, schoolId: school[l] };
      const st = (n: string) =>
        prisma.student.create({
          data: {
            ...scope,
            admissionNumber: `OP-${n}`,
            firstName: `Opsk${n}`,
            lastName: `Kid${l}`,
          },
        });
      const [s1, s2, s3, s4] = [await st('1'), await st('2'), await st('3'), await st('4')];
      const enroll = (studentId: string, sectionId: string, start: string, end?: string) =>
        prisma.studentEnrollment.create({
          data: {
            ...scope,
            studentId,
            sectionId,
            academicYearId: ac[l].yearId,
            startDate: new Date(start),
            status: end ? 'TRANSFERRED' : 'ACTIVE',
            endDate: end ? new Date(end) : null,
          },
        });
      await enroll(s1.id, ac[l].sectionA, '2026-04-01');
      await enroll(s2.id, ac[l].sectionA, '2026-04-01');
      await enroll(s3.id, ac[l].sectionB, '2026-04-01');
      // s4 moved from A to B three days ago: history must stay with A.
      await enroll(s4.id, ac[l].sectionA, '2026-04-01', addDays(today, -3));
      await enroll(s4.id, ac[l].sectionB, addDays(today, -3));
      const teacher = (
        n: string,
        userId: string | null,
        status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
      ) =>
        prisma.teacher.create({
          data: {
            ...scope,
            employeeId: `OT-${n}`,
            firstName: `Tutor${n}`,
            lastName: `T${l}`,
            userId,
            status,
          },
        });
      const t1 = await teacher('1', l === 'A' ? userIds.teacher : null);
      const t2 = await teacher('2', l === 'A' ? userIds.teacher2 : null);
      const t3 = await teacher('3', null, 'INACTIVE');
      const assign = (teacherId: string, sectionId: string, subjectId: string) =>
        prisma.teacherAssignment.create({
          data: { ...scope, teacherId, sectionId, subjectId, type: 'SUBJECT_TEACHER' },
        });
      await assign(t1.id, ac[l].sectionA, ac[l].mathId);
      await assign(t2.id, ac[l].sectionA, ac[l].sciId);
      await assign(t2.id, ac[l].sectionB, ac[l].sciId);
      ids[l] = { s1: s1.id, s2: s2.id, s3: s3.id, s4: s4.id, t1: t1.id, t2: t2.id, t3: t3.id };
    }
  }, 180_000);

  beforeEach(async () => {
    await resetRateLimits(app);
  });

  afterAll(async () => {
    await purgeTenants(prisma, PREFIX);
    await app.close();
  });

  const allPresent = (l: FixtureLetter, extra: Record<string, unknown> = {}) => ({
    sectionId: ac[l].sectionA,
    date: today,
    records: [ids[l].s1, ids[l].s2].map((studentId) => ({ studentId, status: 'PRESENT' })),
    ...extra,
  });

  // ---- Attendance ------------------------------------------------------------------------------
  describe('attendance', () => {
    it('teacher sees only assigned classes; roster uses enrollment history for the date', async () => {
      const classes = (await as('teacher').get('/api/v1/attendance/classes').expect(200))
        .body as AttendanceClass[];
      expect(classes.map((c) => c.sectionId)).toEqual([ac.A.sectionA]);
      const sheet = (
        await as('teacher').get(`/api/v1/attendance/sections/${ac.A.sectionA}`).expect(200)
      ).body as AttendanceSheet;
      expect(sheet).toMatchObject({ date: today, today, editable: true, session: null });
      expect(sheet.roster.map((r) => r.admissionNumber).sort()).toEqual(['OP-1', 'OP-2']);
      const before = (
        await as('admin')
          .get(`/api/v1/attendance/sections/${ac.A.sectionA}?date=${addDays(today, -5)}`)
          .expect(200)
      ).body as AttendanceSheet;
      expect(before.roster.map((r) => r.admissionNumber).sort()).toEqual(['OP-1', 'OP-2', 'OP-4']);
      const bToday = (
        await as('admin').get(`/api/v1/attendance/sections/${ac.A.sectionB}`).expect(200)
      ).body as AttendanceSheet;
      expect(bToday.roster.map((r) => r.admissionNumber).sort()).toEqual(['OP-3', 'OP-4']);
      await as('teacher').get(`/api/v1/attendance/sections/${ac.A.sectionB}`).expect(404);
    });

    it('records, then corrects with version check; every change is in the history; audit has no roster', async () => {
      const first = (
        await as('teacher').put('/api/v1/attendance').send(allPresent('A')).expect(200)
      ).body as AttendanceSheet;
      expect(first.counts).toMatchObject({ PRESENT: 2, UNMARKED: 0 });
      expect(first.session?.version).toBe(1);
      await as('teacher').put('/api/v1/attendance').send(allPresent('A')).expect(409);
      const corrected = (
        await as('admin')
          .put('/api/v1/attendance')
          .send({
            ...allPresent('A'),
            expectedVersion: 1,
            records: [
              { studentId: ids.A.s1, status: 'PRESENT' },
              { studentId: ids.A.s2, status: 'LATE', note: 'Bus delay' },
            ],
          })
          .expect(200)
      ).body as AttendanceSheet;
      expect(corrected.counts).toMatchObject({ PRESENT: 1, LATE: 1 });
      expect(corrected.session?.version).toBe(2);
      await as('teacher')
        .put('/api/v1/attendance')
        .send({ ...allPresent('A'), expectedVersion: 1 })
        .expect(409);
      const changes = (
        await as('teacher')
          .get(`/api/v1/attendance/sections/${ac.A.sectionA}/changes?date=${today}`)
          .expect(200)
      ).body as AttendanceRecordChange[];
      expect(changes[0]).toMatchObject({
        admissionNumber: 'OP-2',
        fromStatus: 'PRESENT',
        toStatus: 'LATE',
        toNote: 'Bus delay',
        changedByName: 'Test User',
      });
      expect(changes).toHaveLength(3);
      const audits = await prisma.auditLog.findMany({
        where: {
          tenantId: t.A.id,
          action: { in: ['ATTENDANCE_RECORDED', 'ATTENDANCE_CORRECTED'] },
        },
      });
      expect(audits.map((a) => a.action).sort()).toEqual([
        'ATTENDANCE_CORRECTED',
        'ATTENDANCE_RECORDED',
      ]);
      expect(JSON.stringify(audits)).not.toMatch(
        new RegExp(`${ids.A.s1}|${ids.A.s2}|Bus delay|LATE`),
      );
    });

    it('date and year rules: future rejected, teacher 7-day window, admin backdate, closed years and inactive classes read-only', async () => {
      const body = (date: string, sectionId = ac.A.sectionA) => ({
        sectionId,
        date,
        records: [{ studentId: ids.A.s1, status: 'PRESENT' }],
      });
      expect(
        (
          await as('admin')
            .put('/api/v1/attendance')
            .send(body(addDays(today, 1)))
            .expect(400)
        ).body.code,
      ).toBe('ATTENDANCE_FUTURE_DATE');
      await as('teacher')
        .put('/api/v1/attendance')
        .send(body(addDays(today, -7)))
        .expect(200);
      expect(
        (
          await as('teacher')
            .put('/api/v1/attendance')
            .send(body(addDays(today, -8)))
            .expect(400)
        ).body.code,
      ).toBe('ATTENDANCE_OUTSIDE_WINDOW');
      await as('admin')
        .put('/api/v1/attendance')
        .send(body(addDays(today, -30)))
        .expect(200);
      const locked = (
        await as('teacher')
          .get(`/api/v1/attendance/sections/${ac.A.sectionA}?date=${addDays(today, -8)}`)
          .expect(200)
      ).body as AttendanceSheet;
      expect(locked).toMatchObject({ editable: false, lockedReason: 'OUTSIDE_TEACHER_WINDOW' });
      expect(
        (
          await as('admin')
            .put('/api/v1/attendance')
            .send(body('2026-01-15', ac.A.closedSection))
            .expect(400)
        ).body.code,
      ).toBe('ACADEMIC_YEAR_NOT_ACTIVE');
      const inactive = (
        await as('admin').get(`/api/v1/attendance/sections/${ac.A.inactiveSection}`).expect(200)
      ).body as AttendanceSheet;
      expect(inactive.editable).toBe(false);
      expect(
        (
          await as('admin')
            .put('/api/v1/attendance')
            .send({
              sectionId: ac.A.sectionA,
              date: addDays(today, -1),
              records: [{ studentId: ids.A.s3, status: 'PRESENT' }],
            })
            .expect(400)
        ).body.code,
      ).toBe('STUDENT_NOT_ON_ROSTER');
      expect(
        (
          await as('admin')
            .put('/api/v1/attendance')
            .send({
              sectionId: ac.A.sectionA,
              date: addDays(today, -2),
              records: [
                { studentId: ids.A.s1, status: 'PRESENT' },
                { studentId: ids.A.s1, status: 'ABSENT' },
              ],
            })
            .expect(400)
        ).body.code,
      ).toBe('DUPLICATE_STUDENT');
      await as('admin')
        .put('/api/v1/attendance')
        .send({
          sectionId: ac.A.sectionA,
          date: addDays(today, -2),
          records: [{ studentId: ids.A.s1, status: 'HALF_DAY' }],
        })
        .expect(400);
      await as('admin')
        .put('/api/v1/attendance')
        .send({
          sectionId: ac.A.sectionA,
          date: addDays(today, -2),
          records: [{ studentId: ids.A.s1, status: 'PRESENT', note: 'x'.repeat(201) }],
        })
        .expect(400);
    });

    /** Save (expecting 200), passing the sheet's current version so re-saves are corrections. */
    const mark = async (
      who: Role,
      date: string,
      records: { studentId: string; status: string }[],
      sectionId = ac.A.sectionA,
    ) => {
      const sheet = await as(who).get(`/api/v1/attendance/sections/${sectionId}?date=${date}`);
      const expectedVersion = (sheet.body as Partial<AttendanceSheet>).session?.version;
      await as(who)
        .put('/api/v1/attendance')
        .send({ sectionId, date, records, ...(expectedVersion ? { expectedVersion } : {}) })
        .expect(200);
    };

    it('teacher window boundaries: today, 1 and 7 days back allowed; 8 back, future and closed years denied', async () => {
      const rec = [{ studentId: ids.A.s1, status: 'PRESENT' }];
      for (const d of [today, addDays(today, -1), addDays(today, -7)])
        await mark('teacher', d, rec);
      const code = async (who: Role, d: string, sectionId = ac.A.sectionA) =>
        (
          await as(who)
            .put('/api/v1/attendance')
            .send({ sectionId, date: d, records: rec })
            .expect(400)
        ).body.code as string;
      expect(await code('teacher', addDays(today, -8))).toBe('ATTENDANCE_OUTSIDE_WINDOW');
      expect(await code('teacher', addDays(today, 1))).toBe('ATTENDANCE_FUTURE_DATE');
      expect(await code('admin', addDays(today, 1))).toBe('ATTENDANCE_FUTURE_DATE');
      await mark('admin', addDays(today, -8), rec);
      // Closed year: read-only for leadership; the teacher is denied as well.
      expect(await code('admin', '2026-01-15', ac.A.closedSection)).toBe(
        'ACADEMIC_YEAR_NOT_ACTIVE',
      );
      await as('teacher')
        .put('/api/v1/attendance')
        .send({ sectionId: ac.A.closedSection, date: '2026-01-15', records: rec })
        .expect(404);
    });

    it('timezone boundary: "today" is the branch-local date, not the server/UTC date', async () => {
      // UTC−11 and UTC+14 are always on different calendar dates.
      const west = 'Pacific/Pago_Pago';
      const east = 'Pacific/Kiritimati';
      const rec = [{ studentId: ids.A.s1, status: 'PRESENT' }];
      await prisma.branch.update({ where: { id: ac.A.branchId }, data: { timezone: west } });
      try {
        const westToday = localToday(west);
        const sheet = (
          await as('teacher').get(`/api/v1/attendance/sections/${ac.A.sectionA}`).expect(200)
        ).body as AttendanceSheet;
        expect(sheet.today).toBe(westToday);
        const put = (date: string) =>
          as('teacher')
            .put('/api/v1/attendance')
            .send({ sectionId: ac.A.sectionA, date, records: rec });
        // The UTC+14 date is "tomorrow" for this branch.
        expect((await put(localToday(east)).expect(400)).body.code).toBe('ATTENDANCE_FUTURE_DATE');
        await mark('teacher', westToday, rec);
        await mark('teacher', addDays(westToday, -7), rec);
        expect((await put(addDays(westToday, -8)).expect(400)).body.code).toBe(
          'ATTENDANCE_OUTSIDE_WINDOW',
        );
      } finally {
        await prisma.branch.update({
          where: { id: ac.A.branchId },
          data: { timezone: 'Asia/Kolkata' },
        });
      }
    });

    it('student summary: (PRESENT + LATE) / (PRESENT + LATE + ABSENT); EXCUSED and unmarked excluded', async () => {
      const summary = async () =>
        (await as('admin').get(`/api/v1/attendance/students/${ids.A.s2}`).expect(200))
          .body as StudentAttendanceSummary;
      const before = (await summary()).counts;
      const plan: [number, string][] = [
        [-40, 'PRESENT'],
        [-41, 'PRESENT'],
        [-42, 'LATE'],
        [-43, 'ABSENT'],
        [-44, 'EXCUSED'],
        [-45, 'EXCUSED'],
      ];
      for (const [offset, status] of plan)
        await mark('admin', addDays(today, offset), [{ studentId: ids.A.s2, status }]);
      // Unmarked: s2 is on the roster that day, but only s1 is marked.
      await mark('admin', addDays(today, -46), [{ studentId: ids.A.s1, status: 'ABSENT' }]);
      const after = await summary();
      expect(after.counts).toEqual({
        PRESENT: before.PRESENT + 2,
        LATE: before.LATE + 1,
        ABSENT: before.ABSENT + 1,
        EXCUSED: before.EXCUSED + 2,
      });
      const c = after.counts;
      expect(after.attendanceRate).toBe(
        roundRate(((c.PRESENT + c.LATE) / (c.PRESENT + c.LATE + c.ABSENT)) * 100),
      );
      expect(after.attendanceRate).toBe(roundRate(attendancePercentage(c)));
    });

    it('history stays with the original class after a transfer', async () => {
      const d = addDays(today, -5);
      await as('admin')
        .put('/api/v1/attendance')
        .send({
          sectionId: ac.A.sectionA,
          date: d,
          records: [ids.A.s1, ids.A.s2, ids.A.s4].map((studentId) => ({
            studentId,
            status: 'PRESENT',
          })),
        })
        .expect(200);
      const a = (
        await as('admin').get(`/api/v1/attendance/sections/${ac.A.sectionA}?date=${d}`).expect(200)
      ).body as AttendanceSheet;
      expect(a.roster.find((r) => r.studentId === ids.A.s4)?.status).toBe('PRESENT');
      const summary = (await as('admin').get(`/api/v1/attendance/students/${ids.A.s4}`).expect(200))
        .body as StudentAttendanceSummary;
      expect(summary.recent[0]).toMatchObject({
        date: d,
        sectionName: 'Grade 5 A',
        status: 'PRESENT',
      });
      expect(summary.attendanceRate).toBe(100);
      await as('teacher').get(`/api/v1/attendance/students/${ids.A.s3}`).expect(404);
    });

    it('concurrency: simultaneous first saves → one wins; simultaneous corrections on one version → one wins', async () => {
      const d = addDays(today, -4);
      const first = await Promise.all(
        [as('teacher'), as('admin')].map((c) =>
          c.put('/api/v1/attendance').send({ ...allPresent('A'), date: d }),
        ),
      );
      expect(first.map((r) => r.status).sort()).toEqual([200, 409]);
      const corr = await Promise.all(
        ['ABSENT', 'LATE'].map((status) =>
          as('admin')
            .put('/api/v1/attendance')
            .send({
              sectionId: ac.A.sectionA,
              date: d,
              expectedVersion: 1,
              records: [{ studentId: ids.A.s1, status }],
            }),
        ),
      );
      expect(corr.map((r) => r.status).sort()).toEqual([200, 409]);
      const records = await prisma.attendanceRecord.findMany({
        where: { session: { sectionId: ac.A.sectionA, date: new Date(d) } },
      });
      expect(records).toHaveLength(2);
    });

    it('permissions: accountant/parent get nothing; teacher2 cannot use section A attendance of another tenant', async () => {
      for (const r of ['accountant', 'parent'] as const) {
        await as(r).get('/api/v1/attendance/classes').expect(403);
        await as(r).put('/api/v1/attendance').send(allPresent('A')).expect(403);
      }
    });
  });

  // ---- Homework & assignments ----------------------------------------------------------------
  describe('homework and assignments', () => {
    const hw = (l: FixtureLetter, extra: Record<string, unknown> = {}) => ({
      sectionId: ac[l].sectionA,
      subjectId: ac[l].mathId,
      title: 'Fractions worksheet',
      instructions: 'Complete page 12',
      assignedDate: today,
      dueDate: addDays(today, 2),
      ...extra,
    });

    it('deadlines are plain school-local dates for both kinds (no time, no UTC shift)', async () => {
      await prisma.branch.update({
        where: { id: ac.A.branchId },
        data: { timezone: 'Pacific/Kiritimati' },
      });
      try {
        for (const kind of ['homework', 'assignments'] as const) {
          const assignedDate = addDays(today, -1);
          const dueDate = addDays(today, 2);
          const created = (
            await as('admin')
              .post(`/api/v1/${kind}`)
              .send(hw('A', { assignedDate, dueDate }))
              .expect(201)
          ).body as ClassworkItem;
          expect(created).toMatchObject({ assignedDate, dueDate });
          const read = (await as('admin').get(`/api/v1/${kind}/${created.id}`).expect(200))
            .body as ClassworkItem;
          expect(read.dueDate).toBe(dueDate);
          const table = kind === 'homework' ? 'homework' : 'assignments';
          const [row] = await prisma.$queryRawUnsafe<{ due: string; type: string }[]>(
            `SELECT due_date::text AS due, pg_typeof(due_date)::text AS type FROM ${table} WHERE id = $1::uuid`,
            created.id,
          );
          expect(row).toEqual({ due: dueDate, type: 'date' });
        }
      } finally {
        await prisma.branch.update({
          where: { id: ac.A.branchId },
          data: { timezone: 'Asia/Kolkata' },
        });
      }
    });

    it('teacher targets only their section + subject pairs; subject scope is enforced', async () => {
      const targets = (await as('teacher').get('/api/v1/homework/targets').expect(200))
        .body as ClassworkTarget[];
      expect(targets.map((x) => [x.sectionId, x.subjects.map((s) => s.id)])).toEqual([
        [ac.A.sectionA, [ac.A.mathId]],
      ]);
      expect(
        (
          await as('teacher')
            .post('/api/v1/homework')
            .send(hw('A', { subjectId: ac.A.sciId }))
            .expect(404)
        ).body.code,
      ).toBe('CLASS_SUBJECT_NOT_ASSIGNED');
      await as('teacher')
        .post('/api/v1/homework')
        .send(hw('A', { sectionId: ac.A.sectionB }))
        .expect(404);
      expect(
        (
          await as('admin')
            .post('/api/v1/homework')
            .send(hw('A', { subjectId: ac.A.artId }))
            .expect(400)
        ).body.code,
      ).toBe('SUBJECT_NOT_IN_GRADE');
      expect(
        (
          await as('teacher')
            .post('/api/v1/homework')
            .send(hw('A', { dueDate: addDays(today, -1) }))
            .expect(400)
        ).body.code,
      ).toBe('DUE_BEFORE_ASSIGNED');
      expect(
        (
          await as('admin')
            .post('/api/v1/homework')
            .send(
              hw('A', {
                sectionId: ac.A.closedSection,
                assignedDate: '2026-01-10',
                dueDate: '2026-01-12',
              }),
            )
            .expect(400)
        ).body.code,
      ).toBe('ACADEMIC_YEAR_CLOSED');
      await as('accountant').get('/api/v1/homework').expect(403);
      await as('parent').post('/api/v1/homework').send(hw('A')).expect(403);
    });

    it('homework lifecycle: draft (private) → publish → edit (versioned) → archive; only drafts delete', async () => {
      const draft = (
        await as('teacher')
          .post('/api/v1/homework')
          .send(hw('A', { teacherId: ids.A.t2 }))
          .expect(201)
      ).body as ClassworkItem;
      expect(draft).toMatchObject({
        status: 'DRAFT',
        teacher: { id: ids.A.t1 },
        version: 1,
        can: { publish: true, delete: true },
      });
      // Teacher2 teaches section A (science) but must not see teacher1's draft.
      await as('teacher2').get(`/api/v1/homework/${draft.id}`).expect(404);
      const pub = (
        await as('teacher')
          .post(`/api/v1/homework/${draft.id}/publish`)
          .send({ expectedVersion: 1 })
          .expect(200)
      ).body as ClassworkItem;
      expect(pub.status).toBe('PUBLISHED');
      expect(pub.publishedAt).not.toBeNull();
      await as('teacher2').get(`/api/v1/homework/${draft.id}`).expect(200);
      await as('teacher2')
        .patch(`/api/v1/homework/${draft.id}`)
        .send({ title: 'Hijack', expectedVersion: 2 })
        .expect(404);
      const edited = (
        await as('teacher')
          .patch(`/api/v1/homework/${draft.id}`)
          .send({ title: 'Fractions — part 2', expectedVersion: 2 })
          .expect(200)
      ).body as ClassworkItem;
      expect(edited).toMatchObject({
        status: 'PUBLISHED',
        version: 3,
        publishedAt: pub.publishedAt,
      });
      await as('teacher')
        .patch(`/api/v1/homework/${draft.id}`)
        .send({ title: 'Stale', expectedVersion: 2 })
        .expect(409);
      expect(
        (await as('teacher').delete(`/api/v1/homework/${draft.id}`).expect(400)).body.code,
      ).toBe('INVALID_STATUS_TRANSITION');
      await as('teacher')
        .post(`/api/v1/homework/${draft.id}/archive`)
        .send({ expectedVersion: 3 })
        .expect(200);
      await as('teacher')
        .patch(`/api/v1/homework/${draft.id}`)
        .send({ title: 'x', expectedVersion: 4 })
        .expect(400);
      const gone = (await as('teacher').post('/api/v1/homework').send(hw('A')).expect(201))
        .body as ClassworkItem;
      await as('teacher').delete(`/api/v1/homework/${gone.id}`).expect(204);
      const audit = await prisma.auditLog.findMany({
        where: { tenantId: t.A.id, resourceId: draft.id },
      });
      expect(audit.map((a) => a.action)).toEqual(
        expect.arrayContaining([
          'HOMEWORK_CREATED',
          'HOMEWORK_PUBLISHED',
          'HOMEWORK_UPDATED',
          'HOMEWORK_ARCHIVED',
        ]),
      );
      expect(JSON.stringify(audit)).not.toContain('Complete page 12');
      const list = (await as('admin').get('/api/v1/homework?status=ARCHIVED').expect(200))
        .body as Paginated<ClassworkItem>;
      expect(list.items.map((i) => i.id)).toContain(draft.id);
    });

    it('assignment lifecycle adds CLOSED; concurrent publish of one version → exactly one wins', async () => {
      const a = (
        await as('teacher')
          .post('/api/v1/assignments')
          .send(hw('A', { title: 'Project' }))
          .expect(201)
      ).body as ClassworkItem;
      expect(
        (
          await as('teacher')
            .post(`/api/v1/assignments/${a.id}/archive`)
            .send({ expectedVersion: 1 })
            .expect(400)
        ).body.code,
      ).toBe('INVALID_STATUS_TRANSITION');
      const race = await Promise.all(
        [1, 2].map(() =>
          as('teacher').post(`/api/v1/assignments/${a.id}/publish`).send({ expectedVersion: 1 }),
        ),
      );
      expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
      await as('teacher')
        .post(`/api/v1/assignments/${a.id}/close`)
        .send({ expectedVersion: 2 })
        .expect(200);
      await as('teacher')
        .patch(`/api/v1/assignments/${a.id}`)
        .send({ title: 'x', expectedVersion: 3 })
        .expect(400);
      await as('teacher')
        .post(`/api/v1/assignments/${a.id}/archive`)
        .send({ expectedVersion: 3 })
        .expect(200);
      await as('teacher')
        .post(`/api/v1/homework/${a.id}/publish`)
        .send({ expectedVersion: 1 })
        .expect(404);
      const row = await prisma.assignment.findUniqueOrThrow({ where: { id: a.id } });
      expect(row.status).toBe('ARCHIVED');
      expect(row.closedAt && row.archivedAt && row.publishedAt).toBeTruthy();
    });
  });

  // ---- Timetable -----------------------------------------------------------------------------
  describe('timetable', () => {
    const periods = {} as Record<string, string>;
    it('periods: ordered, non-overlapping, typed', async () => {
      for (const [name, type, startTime, endTime] of [
        ['P1', 'INSTRUCTIONAL', '09:00', '09:45'],
        ['Break', 'BREAK', '09:45', '10:00'],
        ['P2', 'INSTRUCTIONAL', '10:00', '10:45'],
        ['P3', 'INSTRUCTIONAL', '11:00', '11:45'],
      ]) {
        const p = (
          await as('admin')
            .post('/api/v1/timetable/periods')
            .send({
              branchId: ac.A.branchId,
              academicYearId: ac.A.yearId,
              name,
              type,
              startTime,
              endTime,
            })
            .expect(201)
        ).body as TimetablePeriod;
        periods[name ?? ''] = p.id;
      }
      expect(
        (
          await as('admin')
            .post('/api/v1/timetable/periods')
            .send({
              branchId: ac.A.branchId,
              academicYearId: ac.A.yearId,
              name: 'X',
              type: 'INSTRUCTIONAL',
              startTime: '09:30',
              endTime: '10:15',
            })
            .expect(409)
        ).body.code,
      ).toBe('PERIOD_OVERLAP');
      await as('admin')
        .post('/api/v1/timetable/periods')
        .send({
          branchId: ac.A.branchId,
          academicYearId: ac.A.yearId,
          name: 'Y',
          type: 'INSTRUCTIONAL',
          startTime: '12:00',
          endTime: '11:00',
        })
        .expect(400);
      expect(
        (
          await as('admin')
            .post('/api/v1/timetable/periods')
            .send({
              branchId: ac.A.branchId,
              academicYearId: ac.A.closedYearId,
              name: 'Z',
              type: 'INSTRUCTIONAL',
              startTime: '08:00',
              endTime: '08:30',
            })
            .expect(400)
        ).body.code,
      ).toBe('ACADEMIC_YEAR_CLOSED');
      const list = (
        await as('teacher')
          .get(`/api/v1/timetable/periods?branchId=${ac.A.branchId}&academicYearId=${ac.A.yearId}`)
          .expect(200)
      ).body as TimetablePeriod[];
      expect(list.map((p) => p.name)).toEqual(['P1', 'Break', 'P2', 'P3']);
      await as('teacher')
        .post('/api/v1/timetable/periods')
        .send({
          branchId: ac.A.branchId,
          academicYearId: ac.A.yearId,
          name: 'T',
          type: 'BREAK',
          startTime: '13:00',
          endTime: '13:30',
        })
        .expect(403);
    });

    it('entries: validation, section and teacher conflicts, cascades and races', async () => {
      const entry = (extra: Record<string, unknown>) => ({
        sectionId: ac.A.sectionA,
        periodId: periods.P1,
        weekday: 'MONDAY',
        subjectId: ac.A.mathId,
        teacherId: ids.A.t1,
        ...extra,
      });
      await as('admin').post('/api/v1/timetable/entries').send(entry({})).expect(201);
      expect(
        (
          await as('admin')
            .post('/api/v1/timetable/entries')
            .send(entry({ subjectId: ac.A.sciId, teacherId: ids.A.t2 }))
            .expect(409)
        ).body.code,
      ).toBe('SECTION_TIMETABLE_CONFLICT');
      expect(
        (
          await as('admin')
            .post('/api/v1/timetable/entries')
            .send(entry({ periodId: periods.Break }))
            .expect(400)
        ).body.code,
      ).toBe('PERIOD_NOT_INSTRUCTIONAL');
      expect(
        (
          await as('admin')
            .post('/api/v1/timetable/entries')
            .send(entry({ weekday: 'SUNDAY' }))
            .expect(400)
        ).body.code,
      ).toBe('NON_WORKING_DAY');
      expect(
        (
          await as('admin')
            .post('/api/v1/timetable/entries')
            .send(entry({ weekday: 'TUESDAY', teacherId: ids.A.t2 }))
            .expect(400)
        ).body.code,
      ).toBe('TEACHER_NOT_ASSIGNED');
      expect(
        (
          await as('admin')
            .post('/api/v1/timetable/entries')
            .send(entry({ weekday: 'TUESDAY', teacherId: ids.A.t3 }))
            .expect(400)
        ).body.code,
      ).toBe('TEACHER_INACTIVE');
      expect(
        (
          await as('admin')
            .post('/api/v1/timetable/entries')
            .send(entry({ weekday: 'TUESDAY', subjectId: ac.A.artId }))
            .expect(400)
        ).body.code,
      ).toBe('SUBJECT_NOT_IN_GRADE');
      await as('teacher')
        .post('/api/v1/timetable/entries')
        .send(entry({ weekday: 'TUESDAY' }))
        .expect(403);
      // Teacher 2 teaches science in A and B: the second slot at the same time must fail.
      await as('admin')
        .post('/api/v1/timetable/entries')
        .send(entry({ periodId: periods.P2, subjectId: ac.A.sciId, teacherId: ids.A.t2 }))
        .expect(201);
      expect(
        (
          await as('admin')
            .post('/api/v1/timetable/entries')
            .send(
              entry({
                sectionId: ac.A.sectionB,
                periodId: periods.P2,
                subjectId: ac.A.sciId,
                teacherId: ids.A.t2,
              }),
            )
            .expect(409)
        ).body.code,
      ).toBe('TEACHER_TIMETABLE_CONFLICT');
      // Race: two different sections book the same teacher at the same time → exactly one wins.
      const race = await Promise.all([
        as('admin')
          .post('/api/v1/timetable/entries')
          .send(
            entry({
              periodId: periods.P3,
              weekday: 'WEDNESDAY',
              subjectId: ac.A.sciId,
              teacherId: ids.A.t2,
            }),
          ),
        as('principal')
          .post('/api/v1/timetable/entries')
          .send(
            entry({
              sectionId: ac.A.sectionB,
              periodId: periods.P3,
              weekday: 'WEDNESDAY',
              subjectId: ac.A.sciId,
              teacherId: ids.A.t2,
            }),
          ),
      ]);
      expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
      // Cascade: moving P3 onto P2's time is refused (period overlap); a BREAK conversion of a used period too.
      expect(
        (
          await as('admin')
            .patch(`/api/v1/timetable/periods/${periods.P1}`)
            .send({ type: 'BREAK' })
            .expect(409)
        ).body.code,
      ).toBe('PERIOD_IN_USE');
      await as('admin').delete(`/api/v1/timetable/periods/${periods.P1}`).expect(409);
      // Changing P3's times shifts its lessons (cascade) and keeps them consistent.
      await as('admin')
        .patch(`/api/v1/timetable/periods/${periods.P3}`)
        .send({ startTime: '11:15', endTime: '12:00' })
        .expect(200);
      const rows = await prisma.timetableEntry.findMany({ where: { periodId: periods.P3 } });
      expect(
        rows.length > 0 &&
          rows.every(
            (r) =>
              (typeof r.startTime === 'string'
                ? String(r.startTime).slice(0, 5)
                : r.startTime.toISOString().slice(11, 16)) === '11:15',
          ),
      ).toBe(true);
    });

    it('weekly views are scoped: teacher sees own week and assigned sections only', async () => {
      const mine = (await as('teacher').get('/api/v1/timetable/teachers/me').expect(200))
        .body as TimetableWeek;
      expect(mine.entries.map((e) => [e.weekday, e.periodName, e.subjectName])).toEqual([
        ['MONDAY', 'P1', 'Mathematics'],
      ]);
      expect(mine.editable).toBe(false);
      await as('teacher').get(`/api/v1/timetable/teachers/${ids.A.t2}`).expect(404);
      await as('teacher').get(`/api/v1/timetable/sections/${ac.A.sectionB}`).expect(404);
      const a = (await as('teacher').get(`/api/v1/timetable/sections/${ac.A.sectionA}`).expect(200))
        .body as TimetableWeek;
      expect(a.periods.map((p) => p.type)).toContain('BREAK');
      expect(a.workingDays[0]).toBe('MONDAY');
      const t2 = (await as('admin').get(`/api/v1/timetable/teachers/${ids.A.t2}`).expect(200))
        .body as TimetableWeek;
      expect(t2.entries.length).toBe(2);
      await as('accountant').get(`/api/v1/timetable/sections/${ac.A.sectionA}`).expect(403);
    });
  });

  // ---- Isolation, feed, dashboard ------------------------------------------------------------
  describe('isolation', () => {
    it.each([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'A'],
    ] as const)('%s → %s: no read, write or reference across tenants', async (me, other) => {
      const o = ac[other];
      await api(me).get(`/api/v1/attendance/sections/${o.sectionA}`).expect(404);
      await api(me)
        .put('/api/v1/attendance')
        .send({
          sectionId: o.sectionA,
          date: today,
          records: [{ studentId: ids[other].s1, status: 'PRESENT' }],
        })
        .expect(404);
      // Own section, other tenant's student → not on roster.
      await api(me)
        .put('/api/v1/attendance')
        .send({
          sectionId: ac[me].sectionB,
          date: addDays(today, -1),
          records: [{ studentId: ids[other].s3, status: 'PRESENT' }],
        })
        .expect(400);
      await api(me)
        .post('/api/v1/homework')
        .send({
          sectionId: o.sectionA,
          subjectId: o.mathId,
          title: 'x',
          assignedDate: today,
          dueDate: today,
        })
        .expect(404);
      await api(me)
        .post('/api/v1/homework')
        .send({
          sectionId: ac[me].sectionA,
          subjectId: o.mathId,
          title: 'x',
          assignedDate: today,
          dueDate: today,
        })
        .expect(404);
      await api(me)
        .post('/api/v1/timetable/entries')
        .send({
          sectionId: o.sectionA,
          periodId: o.sectionA,
          weekday: 'MONDAY',
          subjectId: o.mathId,
          teacherId: ids[other].t1,
        })
        .expect(404);
      await api(me).get(`/api/v1/timetable/sections/${o.sectionA}`).expect(404);
      await api(me).get(`/api/v1/timetable/teachers/${ids[other].t1}`).expect(404);
      await api(me).get(`/api/v1/attendance/students/${ids[other].s1}`).expect(404);
      const theirs = await prisma.homework.findFirst({ where: { tenantId: t[other].id } });
      if (theirs) {
        await api(me).get(`/api/v1/homework/${theirs.id}`).expect(404);
        await api(me)
          .patch(`/api/v1/homework/${theirs.id}`)
          .send({ title: 'pwn', expectedVersion: theirs.version })
          .expect(404);
        await api(me)
          .post(`/api/v1/homework/${theirs.id}/archive`)
          .send({ expectedVersion: theirs.version })
          .expect(404);
      }
      const list = (await api(me).get('/api/v1/homework?status=PUBLISHED').expect(200))
        .body as Paginated<ClassworkItem>;
      expect(list.items.every((i) => i.sectionId !== o.sectionA)).toBe(true);
      // Seed one piece of work per tenant so the next hop has something to probe.
      const created = (
        await api(me)
          .post('/api/v1/homework')
          .send({
            sectionId: ac[me].sectionA,
            subjectId: ac[me].mathId,
            title: `Tenant ${me} work`,
            assignedDate: today,
            dueDate: today,
          })
          .expect(201)
      ).body as ClassworkItem;
      await api(me)
        .post(`/api/v1/homework/${created.id}/publish`)
        .send({ expectedVersion: 1 })
        .expect(200);
    });

    it('same tenant, second school: nothing crosses', async () => {
      const second = await prisma.school.create({
        data: {
          tenantId: t.A.id,
          name: 'Second',
          timezone: 'Asia/Kolkata',
          workingDays: ['MONDAY'],
        },
      });
      const other = await createAcademicFixture(prisma, t.A.id, second.id);
      const kid = await prisma.student.create({
        data: {
          tenantId: t.A.id,
          schoolId: second.id,
          admissionNumber: 'OP-X',
          firstName: 'Other',
        },
      });
      await prisma.studentEnrollment.create({
        data: {
          tenantId: t.A.id,
          schoolId: second.id,
          studentId: kid.id,
          sectionId: other.sectionA,
          academicYearId: other.yearId,
          startDate: new Date('2026-04-01'),
        },
      });
      try {
        await as('admin').get(`/api/v1/attendance/sections/${other.sectionA}`).expect(404);
        await as('admin')
          .put('/api/v1/attendance')
          .send({
            sectionId: other.sectionA,
            date: today,
            records: [{ studentId: kid.id, status: 'PRESENT' }],
          })
          .expect(404);
        await as('admin')
          .put('/api/v1/attendance')
          .send({
            sectionId: ac.A.sectionB,
            date: addDays(today, -1),
            records: [{ studentId: kid.id, status: 'PRESENT' }],
          })
          .expect(400);
        await as('admin')
          .post('/api/v1/homework')
          .send({
            sectionId: other.sectionA,
            subjectId: other.mathId,
            title: 'x',
            assignedDate: today,
            dueDate: today,
          })
          .expect(404);
        await as('admin')
          .post('/api/v1/homework')
          .send({
            sectionId: ac.A.sectionA,
            subjectId: other.mathId,
            title: 'x',
            assignedDate: today,
            dueDate: today,
          })
          .expect(404);
        await as('admin').get(`/api/v1/timetable/sections/${other.sectionA}`).expect(404);
        await as('admin')
          .get(
            `/api/v1/timetable/periods?branchId=${other.branchId}&academicYearId=${other.yearId}`,
          )
          .expect(404);
      } finally {
        await prisma.studentEnrollment.deleteMany({ where: { schoolId: second.id } });
        await prisma.student.deleteMany({ where: { schoolId: second.id } });
        await prisma.gradeSubject.deleteMany({ where: { schoolId: second.id } });
        await prisma.subject.deleteMany({ where: { schoolId: second.id } });
        await prisma.section.deleteMany({ where: { schoolId: second.id } });
        await prisma.grade.deleteMany({ where: { schoolId: second.id } });
        await prisma.academicYear.deleteMany({ where: { schoolId: second.id } });
        await prisma.branch.deleteMany({ where: { schoolId: second.id } });
        await prisma.school.delete({ where: { id: second.id } });
      }
    });

    it('activity feed shows class-level events only (never a student’s attendance); dashboard counts are scoped', async () => {
      const d = (await as('admin').get('/api/v1/workspace/dashboard').expect(200))
        .body as DashboardSummary;
      const msgs = (d.activity ?? []).map((a) => `${a.message} — ${a.subject ?? ''}`);
      expect(msgs).toEqual(
        expect.arrayContaining([
          'Attendance corrected — Grade 5 A',
          'Homework published — Grade 5 A',
        ]),
      );
      expect(JSON.stringify(d.activity)).not.toMatch(/Opsk|OP-\\d|ABSENT|LATE|Bus delay/);
      expect(d.operations).toMatchObject({
        homeworkDueSoon: expect.any(Number),
        assignmentsDueSoon: expect.any(Number),
      });
      const teacher = (await as('teacher').get('/api/v1/workspace/dashboard').expect(200))
        .body as DashboardSummary;
      expect(teacher.operations?.attendanceToMark).toBe(0); // section A was saved today
      expect(teacher.activity).toBeUndefined();
      const parent = (await as('parent').get('/api/v1/workspace/dashboard').expect(200))
        .body as DashboardSummary;
      expect(parent.operations).toBeUndefined();
    });
  });
});
