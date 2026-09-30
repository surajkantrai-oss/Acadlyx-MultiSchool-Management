import type { Paginated } from '@acadlyx/tenant-config';
import type {
  AssignmentSubmissionList,
  MobileAttendanceDay,
  MobileChild,
  MobileMe,
  MobileStudentHome,
  MobileWorkItem,
  StudentAttendanceSummary,
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

const PREFIX = 'MOB';
const PW = 'Mobile-pass-2026';
const PIN = '739214';
type Who =
  'principal' | 'parent' | 'student' | 'student2' | 'mover' | 'teacher' | 'teacher2' | 'multi';

/**
 * Phase 8 mobile self-service API (e2e): server-derived mobile roles, Parent → StudentGuardian
 * scope, Student self scope, Teacher Section+Subject scope for submissions, recipient/eligibility
 * rules (decision G), assignment submissions (validation, lifecycle, lateness, resubmission +
 * history, races), and A→B/B→C/C→A + same-tenant cross-school isolation.
 */
describe('Mobile role experiences API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PlatformPrismaService;
  let t: Record<FixtureLetter, FixtureTenant>;
  let school: Record<FixtureLetter, string>;
  const ac = {} as Record<FixtureLetter, AcademicFixture>;
  const tok = {} as Record<FixtureLetter, Partial<Record<Who, string>>>;
  const ids = {} as Record<
    FixtureLetter,
    {
      s1: string;
      s2: string;
      s3: string;
      s4: string;
      teacher: string;
      open: string;
      overdue: string;
      closed: string;
      draft: string;
      archived: string;
      newer: string;
      hwPublished: string;
      hwDraft: string;
      hwArchived: string;
    }
  >;
  const today = localToday('Asia/Kolkata');

  const as = (who: Who, l: FixtureLetter = 'A') =>
    call(app, { host: t[l].domain, token: tok[l][who] ?? '' });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PlatformPrismaService);
    await resetRateLimits(app);
    await syncRbac(app);
    t = await createFixtureTenants(prisma, PREFIX);
    school = await createFixtureSchools(prisma, t);

    for (const l of FIXTURE_LETTERS) {
      tok[l] = {};
      const scope = { tenantId: t[l].id, schoolId: school[l] };
      ac[l] = await createAcademicFixture(prisma, t[l].id, school[l]);
      const lc = l.toLowerCase();
      const user = async (
        who: Who,
        roles: string[],
        login: { email?: string; phone?: string; loginId?: string },
        pin = false,
      ) => {
        const id = await createTenantUser(app, {
          tenantId: t[l].id,
          roles,
          ...login,
          ...(login.loginId ? { loginIdKind: 'STUDENT_ID' as const } : {}),
          credentialType: pin ? 'PIN' : 'PASSWORD',
          secret: pin ? PIN : PW,
        });
        tok[l][who] = (
          await tenantLogin(
            app,
            t[l].domain,
            login.email ?? login.phone ?? login.loginId ?? '',
            pin ? PIN : PW,
          )
        ).tokens.accessToken;
        return id;
      };
      await user('principal', ['PRINCIPAL'], { email: `principal@mob-${lc}.test` });
      const parentUser = await user(
        'parent',
        ['PARENT'],
        { phone: `+9198555000${String(FIXTURE_LETTERS.indexOf(l))}1` },
        true,
      );
      const studentUser = await user('student', ['STUDENT'], { loginId: `MB-${l}-1` }, true);
      const student2User = await user('student2', ['STUDENT'], { loginId: `MB-${l}-2` }, true);
      const moverUser = await user('mover', ['STUDENT'], { loginId: `MB-${l}-4` }, true);
      const teacherUser = await user('teacher', ['TEACHER'], { email: `teacher@mob-${lc}.test` });
      const teacher2User = await user('teacher2', ['TEACHER'], {
        email: `teacher2@mob-${lc}.test`,
      });
      const multiUser = await user('multi', ['TEACHER', 'PARENT'], {
        email: `multi@mob-${lc}.test`,
      });

      const st = (n: string, userId: string | null) =>
        prisma.student.create({
          data: {
            ...scope,
            admissionNumber: `MB-${n}`,
            firstName: `Mobk${n}`,
            lastName: `Kid${l}`,
            userId,
          },
        });
      const [s1, s2, s3, s4] = [
        await st('1', studentUser),
        await st('2', student2User),
        await st('3', null),
        await st('4', moverUser),
      ];
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
      // The mover left 5 A three days ago for 5 B (decision G).
      await enroll(s4.id, ac[l].sectionA, '2026-04-01', addDays(today, -3));
      await enroll(s4.id, ac[l].sectionB, addDays(today, -3));

      // Parent of s1 AND s3 (two classes); the multi-role user is s2's parent and a teacher.
      const parent = await prisma.parent.create({
        data: { ...scope, firstName: 'Mobparent', lastName: l, userId: parentUser },
      });
      const multiParent = await prisma.parent.create({
        data: { ...scope, firstName: 'Multiparent', lastName: l, userId: multiUser },
      });
      for (const [studentId, parentId] of [
        [s1.id, parent.id],
        [s3.id, parent.id],
        [s2.id, multiParent.id],
      ] as const)
        await prisma.studentGuardian.create({
          data: { ...scope, studentId, parentId, relationship: 'MOTHER' },
        });
      const teacher = async (n: string, userId: string) =>
        prisma.teacher.create({
          data: { ...scope, employeeId: `MT-${n}`, firstName: `Mobteach${n}`, lastName: l, userId },
        });
      const t1 = await teacher('1', teacherUser);
      const t2 = await teacher('2', teacher2User);
      const t3 = await teacher('3', multiUser);
      await prisma.teacherAssignment.create({
        data: {
          ...scope,
          teacherId: t1.id,
          sectionId: ac[l].sectionA,
          subjectId: ac[l].mathId,
          type: 'SUBJECT_TEACHER',
        },
      });
      await prisma.teacherAssignment.create({
        data: {
          ...scope,
          teacherId: t2.id,
          sectionId: ac[l].sectionB,
          subjectId: ac[l].mathId,
          type: 'SUBJECT_TEACHER',
        },
      });
      await prisma.teacherAssignment.create({
        data: {
          ...scope,
          teacherId: t3.id,
          sectionId: ac[l].sectionB,
          subjectId: ac[l].artId,
          type: 'SUBJECT_TEACHER',
        },
      });

      const now = new Date();
      const work = (
        model: 'assignment' | 'homework',
        title: string,
        status: 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'ARCHIVED',
        assigned: string,
        due: string,
        sectionId = ac[l].sectionA,
      ) =>
        (prisma[model] as typeof prisma.assignment).create({
          data: {
            ...scope,
            sectionId,
            subjectId: ac[l].mathId,
            teacherId: t1.id,
            title,
            assignedDate: new Date(assigned),
            dueDate: new Date(due),
            status,
            createdByUserId: teacherUser,
            publishedAt: status === 'DRAFT' ? null : now,
            ...(model === 'assignment' ? { closedAt: status === 'CLOSED' ? now : null } : {}),
            archivedAt: status === 'ARCHIVED' ? now : null,
          },
        });
      ids[l] = {
        s1: s1.id,
        s2: s2.id,
        s3: s3.id,
        s4: s4.id,
        teacher: t1.id,
        open: (
          await work('assignment', 'Open essay', 'PUBLISHED', addDays(today, -5), addDays(today, 3))
        ).id,
        overdue: (
          await work(
            'assignment',
            'Overdue map',
            'PUBLISHED',
            addDays(today, -6),
            addDays(today, -2),
          )
        ).id,
        closed: (
          await work('assignment', 'Closed quiz', 'CLOSED', addDays(today, -9), addDays(today, -4))
        ).id,
        draft: (await work('assignment', 'Draft plan', 'DRAFT', today, addDays(today, 5))).id,
        archived: (
          await work(
            'assignment',
            'Old archive',
            'ARCHIVED',
            addDays(today, -20),
            addDays(today, -15),
          )
        ).id,
        newer: (
          await work(
            'assignment',
            'After the move',
            'PUBLISHED',
            addDays(today, -1),
            addDays(today, 4),
          )
        ).id,
        hwPublished: (
          await work(
            'homework',
            'Read chapter 2',
            'PUBLISHED',
            addDays(today, -1),
            addDays(today, 1),
          )
        ).id,
        hwDraft: (await work('homework', 'Secret draft', 'DRAFT', today, addDays(today, 2))).id,
        hwArchived: (
          await work('homework', 'Last term', 'ARCHIVED', addDays(today, -30), addDays(today, -29))
        ).id,
      };
    }
  }, 240_000);

  afterAll(async () => {
    await purgeTenants(prisma, PREFIX);
    await app.close();
  });

  beforeEach(async () => {
    await resetRateLimits(app);
  });

  const submit = (who: Who, id: string, body: Record<string, unknown>, l: FixtureLetter = 'A') =>
    as(who, l).put(`/api/v1/mobile/student/assignments/${id}/submission`).send(body);

  describe('roles and profiles', () => {
    it('mobile roles are derived on the server from role + active profile', async () => {
      const me = async (who: Who) =>
        (await as(who).get('/api/v1/mobile/me').expect(200)).body as MobileMe;
      expect((await me('parent')).roles).toEqual(['PARENT']);
      expect((await me('student')).roles).toEqual(['STUDENT']);
      expect((await me('teacher')).roles).toEqual(['TEACHER']);
      const multi = await me('multi');
      expect(multi.roles).toEqual(['TEACHER', 'PARENT']);
      expect(multi.teacher?.employeeId).toBe('MT-3');
      const principal = await me('principal');
      expect(principal).toMatchObject({ roles: [], otherRoles: ['PRINCIPAL'] });
      await call(app, { host: t.A.domain }).get('/api/v1/mobile/me').expect(401);
      // The mobile path (tenant key header instead of host) resolves the same way.
      const viaKey = await call(app, { token: tok.A.student ?? '' })
        .get('/api/v1/mobile/me')
        .set('X-Acadlyx-Tenant-Key', t.A.key)
        .expect(200);
      expect((viaKey.body as MobileMe).roles).toEqual(['STUDENT']);
    });

    it('role routes need the matching profile, whatever the client claims', async () => {
      const code = async (who: Who, path: string) =>
        (await as(who).get(path).expect(403)).body.code as string;
      expect(await code('student', '/api/v1/mobile/parent/children')).toBe('MOBILE_ROLE_REQUIRED');
      expect(await code('teacher', '/api/v1/mobile/parent/children')).toBe('MOBILE_ROLE_REQUIRED');
      expect(await code('parent', '/api/v1/mobile/student/home')).toBe('MOBILE_ROLE_REQUIRED');
      expect(await code('principal', '/api/v1/mobile/student/home')).toBe('MOBILE_ROLE_REQUIRED');
      // No role header/body is ever read: a student cannot become a teacher.
      await as('student')
        .get(`/api/v1/mobile/teacher/assignments/${ids.A.open}/submissions`)
        .set('X-Acadlyx-Active-Role', 'TEACHER')
        .expect(403);
      // Parents and students hold no school-level read permissions.
      await as('parent').get('/api/v1/attendance/classes').expect(403);
      await as('student').get('/api/v1/homework').expect(403);
      await as('parent').get(`/api/v1/attendance/students/${ids.A.s1}`).expect(403);
    });
  });

  describe('parent', () => {
    it('sees only linked children, with classes; each child view is relationship-scoped', async () => {
      const kids = (await as('parent').get('/api/v1/mobile/parent/children').expect(200))
        .body as MobileChild[];
      expect(kids.map((k) => k.studentId).sort()).toEqual([ids.A.s1, ids.A.s3].sort());
      expect(kids.find((k) => k.studentId === ids.A.s3)?.class?.sectionId).toBe(ac.A.sectionB);
      const home = (
        await as('parent').get(`/api/v1/mobile/parent/children/${ids.A.s1}/home`).expect(200)
      ).body as MobileStudentHome;
      expect(home.class?.sectionId).toBe(ac.A.sectionA);
      expect(home.homework.map((h) => h.title)).toEqual(['Read chapter 2']);
      // Another family's child, another tenant's student, a random id: all 404.
      for (const other of [ids.A.s2, ids.B.s1, '01900000-0000-7000-8000-000000000000'])
        await as('parent').get(`/api/v1/mobile/parent/children/${other}/home`).expect(404);
      await as('parent').get(`/api/v1/mobile/parent/children/${ids.A.s2}/assignments`).expect(404);
      await as('parent').get(`/api/v1/mobile/parent/children/${ids.A.s2}/timetable`).expect(404);
    });

    it('removing the guardian link removes access on the next request', async () => {
      const link = await prisma.studentGuardian.findFirstOrThrow({
        where: { studentId: ids.A.s3, parent: { firstName: 'Mobparent' } },
      });
      await prisma.studentGuardian.delete({ where: { id: link.id } });
      try {
        const kids = (await as('parent').get('/api/v1/mobile/parent/children').expect(200))
          .body as MobileChild[];
        expect(kids.map((k) => k.studentId)).toEqual([ids.A.s1]);
        await as('parent').get(`/api/v1/mobile/parent/children/${ids.A.s3}/home`).expect(404);
      } finally {
        await prisma.studentGuardian.create({
          data: {
            tenantId: link.tenantId,
            schoolId: link.schoolId,
            studentId: link.studentId,
            parentId: link.parentId,
            relationship: link.relationship,
          },
        });
      }
    });

    it('attendance uses the Phase 7 formula; history is paginated; parents never edit', async () => {
      for (const [offset, status] of [
        [-1, 'PRESENT'],
        [-2, 'LATE'],
        [-3, 'ABSENT'],
        [-4, 'EXCUSED'],
      ] as const)
        await as('principal')
          .put('/api/v1/attendance')
          .send({
            sectionId: ac.A.sectionA,
            date: addDays(today, offset),
            records: [{ studentId: ids.A.s1, status }],
          })
          .expect(200);
      const summary = (
        await as('parent').get(`/api/v1/mobile/parent/children/${ids.A.s1}/attendance`).expect(200)
      ).body as StudentAttendanceSummary;
      expect(summary.counts).toEqual({ PRESENT: 1, LATE: 1, ABSENT: 1, EXCUSED: 1 });
      expect(summary.attendanceRate).toBe(roundRate(attendancePercentage(summary.counts)));
      const page = (
        await as('parent')
          .get(`/api/v1/mobile/parent/children/${ids.A.s1}/attendance/days?pageSize=2`)
          .expect(200)
      ).body as Paginated<MobileAttendanceDay>;
      expect(page).toMatchObject({ total: 4, pageSize: 2, totalPages: 2 });
      expect(page.items[0]?.date).toBe(addDays(today, -1));
      await as('parent')
        .put('/api/v1/attendance')
        .send({
          sectionId: ac.A.sectionA,
          date: today,
          records: [{ studentId: ids.A.s1, status: 'ABSENT' }],
        })
        .expect(403);
      // The student sees the identical canonical summary.
      const own = (await as('student').get('/api/v1/mobile/student/attendance').expect(200))
        .body as StudentAttendanceSummary;
      expect(own.attendanceRate).toBe(summary.attendanceRate);
    });
  });

  describe('student visibility', () => {
    it('only published work of classes they received; drafts are 404 even by id; archived only in past', async () => {
      const list = async (path: string) =>
        ((await as('student').get(path).expect(200)).body as Paginated<MobileWorkItem>).items.map(
          (i) => i.title,
        );
      expect(await list('/api/v1/mobile/student/homework')).toEqual(['Read chapter 2']);
      expect(await list('/api/v1/mobile/student/homework?scope=past')).toEqual(['Last term']);
      expect((await list('/api/v1/mobile/student/assignments')).sort()).toEqual(
        ['After the move', 'Closed quiz', 'Open essay', 'Overdue map'].sort(),
      );
      expect(await list('/api/v1/mobile/student/assignments?scope=past')).toEqual(['Old archive']);
      await as('student').get(`/api/v1/mobile/student/assignments/${ids.A.draft}`).expect(404);
      await as('student').get(`/api/v1/mobile/student/homework/${ids.A.hwDraft}`).expect(404);
      await as('parent')
        .get(`/api/v1/mobile/parent/children/${ids.A.s1}/assignments/${ids.A.draft}`)
        .expect(404);
      // Another class's student (s3 in 5 B) is not a recipient of 5 A work.
      await as('parent')
        .get(`/api/v1/mobile/parent/children/${ids.A.s3}/assignments/${ids.A.open}`)
        .expect(404);
    });

    it('timetable: own current class only, read-only; no current class → 404', async () => {
      await as('principal')
        .post('/api/v1/timetable/periods')
        .send({
          branchId: ac.A.branchId,
          academicYearId: ac.A.yearId,
          name: 'P1',
          type: 'INSTRUCTIONAL',
          startTime: '09:00',
          endTime: '09:45',
        })
        .expect(201);
      const week = (await as('student').get('/api/v1/mobile/student/timetable').expect(200))
        .body as TimetableWeek;
      expect(week).toMatchObject({ view: 'section', editable: false });
      expect(week.title).toContain(' A ');
      const kid = (
        await as('parent').get(`/api/v1/mobile/parent/children/${ids.A.s3}/timetable`).expect(200)
      ).body as TimetableWeek;
      expect(kid.title).toContain(' B ');
      await prisma.studentEnrollment.updateMany({
        where: { studentId: ids.A.s2 },
        data: { endDate: new Date(addDays(today, -1)), status: 'WITHDRAWN' },
      });
      try {
        const res = await as('student2').get('/api/v1/mobile/student/timetable').expect(404);
        expect(res.body.code).toBe('NO_CURRENT_CLASS');
        const home = (await as('student2').get('/api/v1/mobile/student/home').expect(200))
          .body as MobileStudentHome;
        expect(home.class).toBeNull();
      } finally {
        await prisma.studentEnrollment.updateMany({
          where: { studentId: ids.A.s2 },
          data: { endDate: null, status: 'ACTIVE' },
        });
      }
    });
  });

  describe('assignment submissions', () => {
    it('validates content: text and/or https link only, bounded, never both empty', async () => {
      const bad = async (body: Record<string, unknown>) =>
        (await submit('student2', ids.A.open, { expectedVersion: 0, ...body }).expect(400)).body
          .code as string;
      expect(await bad({})).toBe('SUBMISSION_INVALID');
      expect(await bad({ text: '   ' })).toBe('SUBMISSION_INVALID');
      for (const url of [
        'http://example.com/x',
        'javascript:alert(1)',
        'data:text/html,hi',
        'file:///etc/passwd',
        'ftp://example.com/a',
        'https://',
        'https://exa mple.com',
      ])
        expect(await bad({ url })).toBe('SUBMISSION_INVALID');
      await submit('student2', ids.A.open, { expectedVersion: 0, text: 'x'.repeat(5001) }).expect(
        400,
      );
      await submit('student2', ids.A.open, {
        expectedVersion: 0,
        url: `https://e.com/${'a'.repeat(2040)}`,
      }).expect(400);
      expect(await prisma.assignmentSubmission.count({ where: { assignmentId: ids.A.open } })).toBe(
        0,
      );
    });

    it('submit → resubmit keeps one row, appends history, lateness fixed by the first submission', async () => {
      const first = (
        await submit('student', ids.A.open, {
          expectedVersion: 0,
          text: 'My essay',
          url: 'https://docs.example.com/essay',
        }).expect(200)
      ).body as MobileWorkItem;
      expect(first.submission).toMatchObject({ version: 1, late: false, textContent: 'My essay' });
      // Stale versions (double tap / other device) are refused, never merged.
      expect(
        (await submit('student', ids.A.open, { expectedVersion: 0, text: 'again' }).expect(409))
          .body.code,
      ).toBe('SUBMISSION_STALE');
      const second = (
        await submit('student', ids.A.open, { expectedVersion: 1, text: 'Improved essay' }).expect(
          200,
        )
      ).body as MobileWorkItem;
      expect(second.submission).toMatchObject({
        version: 2,
        late: false,
        textContent: 'Improved essay',
        externalUrl: null,
      });
      expect(second.submission?.firstSubmittedAt).toBe(first.submission?.firstSubmittedAt);
      const history = await prisma.assignmentSubmissionHistory.findMany({
        where: { submissionId: first.submission?.id ?? '' },
        orderBy: { version: 'asc' },
      });
      expect(history.map((h) => [h.version, h.textContent])).toEqual([
        [1, 'My essay'],
        [2, 'Improved essay'],
      ]);
      expect(await prisma.assignmentSubmission.count({ where: { assignmentId: ids.A.open } })).toBe(
        1,
      );
      // Audit: the event only — never the submitted content.
      const audits = await prisma.auditLog.findMany({
        where: {
          tenantId: t.A.id,
          action: { in: ['ASSIGNMENT_SUBMITTED', 'ASSIGNMENT_RESUBMITTED'] },
        },
      });
      expect(audits.map((a) => a.action).sort()).toEqual([
        'ASSIGNMENT_RESUBMITTED',
        'ASSIGNMENT_SUBMITTED',
      ]);
      expect(JSON.stringify(audits)).not.toContain('essay');
      expect(JSON.stringify(audits)).not.toContain('docs.example.com');
    });

    it('text only, link only and both are accepted; a later resubmission never makes on-time late', async () => {
      // student2 first submitted "Overdue map" BEFORE its due date (backdated fixture row).
      const onTime = new Date(`${addDays(today, -4)}T06:00:00.000Z`);
      const row = await prisma.assignmentSubmission.create({
        data: {
          tenantId: t.A.id,
          schoolId: (await prisma.assignment.findUniqueOrThrow({ where: { id: ids.A.overdue } }))
            .schoolId,
          assignmentId: ids.A.overdue,
          studentId: ids.A.s2,
          textContent: 'Early draft',
          firstSubmittedAt: onTime,
          lastSubmittedAt: onTime,
        },
      });
      await prisma.assignmentSubmissionHistory.create({
        data: {
          tenantId: row.tenantId,
          schoolId: row.schoolId,
          submissionId: row.id,
          version: 1,
          textContent: 'Early draft',
          submittedAt: onTime,
          submittedByUserId: '01900000-0000-7000-8000-000000000001',
        },
      });
      const linkOnly = (
        await submit('student2', ids.A.overdue, {
          expectedVersion: 1,
          url: 'https://maps.example.org/route',
        }).expect(200)
      ).body as MobileWorkItem;
      expect(linkOnly.submission).toMatchObject({
        version: 2,
        textContent: null,
        externalUrl: 'https://maps.example.org/route',
        late: false,
      });
      const both = (
        await submit('student2', ids.A.overdue, {
          expectedVersion: 2,
          text: 'Final map',
          url: 'https://maps.example.org/final',
        }).expect(200)
      ).body as MobileWorkItem;
      // Resubmitted after the due date, but the FIRST submission was on time.
      expect(both.submission).toMatchObject({ version: 3, late: false, textContent: 'Final map' });
      expect(
        await prisma.assignmentSubmissionHistory.count({ where: { submissionId: row.id } }),
      ).toBe(3);
    });

    it('a closed assignment refuses resubmission too; late joiners are not recipients', async () => {
      const closed = await prisma.assignment.findUniqueOrThrow({ where: { id: ids.A.closed } });
      const now = new Date();
      await prisma.assignmentSubmission.create({
        data: {
          tenantId: closed.tenantId,
          schoolId: closed.schoolId,
          assignmentId: closed.id,
          studentId: ids.A.s1,
          textContent: 'Before it closed',
          firstSubmittedAt: now,
          lastSubmittedAt: now,
        },
      });
      expect(
        (await submit('student', ids.A.closed, { expectedVersion: 1, text: 'edit' }).expect(409))
          .body.code,
      ).toBe('ASSIGNMENT_CLOSED');
      // Joined 5 A after "Open essay" was assigned (today − 5): not a recipient of it.
      const userId = await createTenantUser(app, {
        tenantId: t.A.id,
        roles: ['STUDENT'],
        loginId: 'MB-A-9',
        loginIdKind: 'STUDENT_ID',
        credentialType: 'PIN',
        secret: PIN,
      });
      const joiner = await prisma.student.create({
        data: {
          tenantId: t.A.id,
          schoolId: closed.schoolId,
          admissionNumber: 'MB-9',
          firstName: 'Late',
          userId,
        },
      });
      await prisma.studentEnrollment.create({
        data: {
          tenantId: t.A.id,
          schoolId: closed.schoolId,
          studentId: joiner.id,
          sectionId: ac.A.sectionA,
          academicYearId: ac.A.yearId,
          startDate: new Date(addDays(today, -2)),
        },
      });
      const token = (await tenantLogin(app, t.A.domain, 'MB-A-9', PIN)).tokens.accessToken;
      const joinerApi = call(app, { host: t.A.domain, token });
      await joinerApi.get(`/api/v1/mobile/student/assignments/${ids.A.open}`).expect(404);
      await joinerApi
        .put(`/api/v1/mobile/student/assignments/${ids.A.open}/submission`)
        .send({ expectedVersion: 0, text: 'x' })
        .expect(404);
      // …but work assigned after they joined is theirs.
      await joinerApi.get(`/api/v1/mobile/student/assignments/${ids.A.newer}`).expect(200);
    });

    it('after the due date: accepted while PUBLISHED and derived as late', async () => {
      const res = (
        await submit('student', ids.A.overdue, { expectedVersion: 0, text: 'Sorry, late' }).expect(
          200,
        )
      ).body as MobileWorkItem;
      expect(res).toMatchObject({ overdue: true, submission: { late: true, version: 1 } });
    });

    it('CLOSED and ARCHIVED are read-only; a draft is invisible', async () => {
      expect(
        (await submit('student', ids.A.closed, { expectedVersion: 0, text: 'x' }).expect(409)).body
          .code,
      ).toBe('ASSIGNMENT_CLOSED');
      expect(
        (await submit('student', ids.A.archived, { expectedVersion: 0, text: 'x' }).expect(409))
          .body.code,
      ).toBe('ASSIGNMENT_ARCHIVED');
      await submit('student', ids.A.draft, { expectedVersion: 0, text: 'x' }).expect(404);
      const closed = (
        await as('student').get(`/api/v1/mobile/student/assignments/${ids.A.closed}`).expect(200)
      ).body as MobileWorkItem;
      expect(closed).toMatchObject({ canSubmit: false, blockedReason: 'ASSIGNMENT_CLOSED' });
    });

    it('decision G: a transferred student keeps history but cannot submit; later work is not theirs', async () => {
      const old = (
        await as('mover').get(`/api/v1/mobile/student/assignments/${ids.A.open}`).expect(200)
      ).body as MobileWorkItem;
      expect(old).toMatchObject({ canSubmit: false, blockedReason: 'NOT_IN_CLASS' });
      expect(
        (await submit('mover', ids.A.open, { expectedVersion: 0, text: 'x' }).expect(403)).body
          .code,
      ).toBe('SUBMISSION_NOT_ALLOWED');
      await as('mover').get(`/api/v1/mobile/student/assignments/${ids.A.newer}`).expect(404);
      await submit('mover', ids.A.newer, { expectedVersion: 0, text: 'x' }).expect(404);
    });

    it('identity comes from the session: other students, parents and teachers cannot submit', async () => {
      await submit('parent', ids.A.open, { expectedVersion: 0, text: 'on behalf' }).expect(403);
      await submit('teacher', ids.A.open, { expectedVersion: 0, text: 'x' }).expect(403);
      // A body student id is ignored (not even accepted by validation).
      await submit('student2', ids.A.open, {
        expectedVersion: 0,
        text: 'mine',
        studentId: ids.A.s1,
      }).expect(400);
      const parentView = (
        await as('parent')
          .get(`/api/v1/mobile/parent/children/${ids.A.s1}/assignments/${ids.A.open}`)
          .expect(200)
      ).body as MobileWorkItem;
      expect(parentView).toMatchObject({
        canSubmit: false,
        blockedReason: 'READ_ONLY',
        submission: { textContent: 'Improved essay' },
      });
      // Another family cannot see it.
      await as('multi')
        .get(`/api/v1/mobile/parent/children/${ids.A.s1}/assignments/${ids.A.open}`)
        .expect(404);
    });

    it('races: simultaneous first submits → exactly one; close vs submit is strictly ordered', async () => {
      const [a, b] = await Promise.all([
        submit('student2', ids.A.newer, { expectedVersion: 0, text: 'tap one' }),
        submit('student2', ids.A.newer, { expectedVersion: 0, text: 'tap two' }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(
        await prisma.assignmentSubmission.count({ where: { assignmentId: ids.A.newer } }),
      ).toBe(1);
      expect(
        await prisma.assignmentSubmissionHistory.count({
          where: { submission: { assignmentId: ids.A.newer } },
        }),
      ).toBe(1);

      const version = (await prisma.assignment.findUniqueOrThrow({ where: { id: ids.A.open } }))
        .version;
      const [close, late] = await Promise.all([
        as('teacher')
          .post(`/api/v1/assignments/${ids.A.open}/close`)
          .send({ expectedVersion: version }),
        submit('student2', ids.A.open, { expectedVersion: 0, text: 'just in time?' }),
      ]);
      expect(close.status).toBe(200);
      const closedAt = (await prisma.assignment.findUniqueOrThrow({ where: { id: ids.A.open } }))
        .closedAt;
      if (late.status === 200) {
        const row = await prisma.assignmentSubmission.findFirstOrThrow({
          where: { assignmentId: ids.A.open, studentId: ids.A.s2 },
        });
        expect(row.firstSubmittedAt.getTime()).toBeLessThanOrEqual(closedAt?.getTime() ?? 0);
      } else {
        expect(late.body.code).toBe('ASSIGNMENT_CLOSED');
      }
      // Stale mobile screen showing PUBLISHED: the server says closed.
      expect(
        (await submit('student', ids.A.open, { expectedVersion: 2, text: 'edit' }).expect(409)).body
          .code,
      ).toBe('ASSIGNMENT_CLOSED');
    });
  });

  describe('teacher submission review', () => {
    it('only the Section+Subject teacher (or leadership) reads submissions; read-only', async () => {
      const list = (
        await as('teacher')
          .get(`/api/v1/mobile/teacher/assignments/${ids.A.overdue}/submissions`)
          .expect(200)
      ).body as AssignmentSubmissionList;
      expect(list.submittedCount).toBe(2);
      expect(list.rows.find((r) => r.studentId === ids.A.s2)?.submission).toMatchObject({
        late: false,
        version: 3,
      });
      // Recipients = enrolled on the assigned date (s1, s2 and the mover); s3 (5 B) is not.
      expect(list.rows.map((r) => r.studentId).sort()).toEqual(
        [ids.A.s1, ids.A.s2, ids.A.s4].sort(),
      );
      expect(list.rows.find((r) => r.studentId === ids.A.s1)?.submission).toMatchObject({
        late: true,
        textContent: 'Sorry, late',
      });
      await as('principal')
        .get(`/api/v1/mobile/teacher/assignments/${ids.A.overdue}/submissions`)
        .expect(200);
      await as('teacher2')
        .get(`/api/v1/mobile/teacher/assignments/${ids.A.overdue}/submissions`)
        .expect(404);
      await as('multi')
        .get(`/api/v1/mobile/teacher/assignments/${ids.A.overdue}/submissions`)
        .expect(404);
      await as('teacher')
        .get(`/api/v1/mobile/teacher/assignments/${ids.A.draft}/submissions`)
        .expect(404);
      await as('parent')
        .get(`/api/v1/mobile/teacher/assignments/${ids.A.overdue}/submissions`)
        .expect(403);
      await as('student')
        .get(`/api/v1/mobile/teacher/assignments/${ids.A.overdue}/submissions`)
        .expect(403);
      // There is no route to change a student's submission as a teacher.
      await as('teacher')
        .put(`/api/v1/mobile/student/assignments/${ids.A.overdue}/submission`)
        .send({ expectedVersion: 1, text: 'edited' })
        .expect(403);
    });

    it('multi-role user: parent views and teacher scope are independent and server-decided', async () => {
      const kids = (await as('multi').get('/api/v1/mobile/parent/children').expect(200))
        .body as MobileChild[];
      expect(kids.map((k) => k.studentId)).toEqual([ids.A.s2]);
      // Teaching 5 B art gives no parent access to 5 B children, and parenthood gives no 5 A class access.
      await as('multi').get(`/api/v1/mobile/parent/children/${ids.A.s3}/home`).expect(404);
      await as('multi').get(`/api/v1/attendance/sections/${ac.A.sectionA}`).expect(404);
      await as('multi').get(`/api/v1/attendance/sections/${ac.A.sectionB}`).expect(200);
    });
  });

  describe('isolation', () => {
    it.each([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'A'],
    ] as const)('%s → %s: nothing crosses tenants', async (me, other) => {
      const o = ids[other];
      // Own token on the other tenant's host: rejected before any data access.
      await call(app, { host: t[other].domain, token: tok[me].parent ?? '' })
        .get('/api/v1/mobile/parent/children')
        .expect(403);
      await call(app, { host: t[other].domain, token: tok[me].student ?? '' })
        .get('/api/v1/mobile/student/home')
        .expect(403);
      // Own tenant, other tenant's ids: 404.
      await as('parent', me).get(`/api/v1/mobile/parent/children/${o.s1}/home`).expect(404);
      await as('student', me).get(`/api/v1/mobile/student/assignments/${o.overdue}`).expect(404);
      await submit('student', o.newer, { expectedVersion: 0, text: 'x' }, me).expect(404);
      await as('teacher', me)
        .get(`/api/v1/mobile/teacher/assignments/${o.overdue}/submissions`)
        .expect(404);
    });

    it('a development build pointed at another tenant key gains nothing', async () => {
      await call(app, { token: tok.A.student ?? '' })
        .get('/api/v1/mobile/student/home')
        .set('X-Acadlyx-Tenant-Key', t.B.key)
        .expect(403);
    });

    it('same tenant, second school: no mobile data crosses', async () => {
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
          admissionNumber: 'MB-X',
          firstName: 'Other',
        },
      });
      const foreign = await prisma.assignment.create({
        data: {
          tenantId: t.A.id,
          schoolId: second.id,
          sectionId: other.sectionA,
          subjectId: other.mathId,
          title: 'Elsewhere',
          assignedDate: new Date(addDays(today, -1)),
          dueDate: new Date(addDays(today, 2)),
          status: 'PUBLISHED',
          publishedAt: new Date(),
          createdByUserId: '01900000-0000-7000-8000-000000000001',
        },
      });
      try {
        await as('parent').get(`/api/v1/mobile/parent/children/${kid.id}/home`).expect(404);
        await as('student').get(`/api/v1/mobile/student/assignments/${foreign.id}`).expect(404);
        await submit('student', foreign.id, { expectedVersion: 0, text: 'x' }).expect(404);
        await as('principal')
          .get(`/api/v1/mobile/teacher/assignments/${foreign.id}/submissions`)
          .expect(404);
      } finally {
        await prisma.assignment.delete({ where: { id: foreign.id } });
        await prisma.student.delete({ where: { id: kid.id } });
      }
    });
  });
});
