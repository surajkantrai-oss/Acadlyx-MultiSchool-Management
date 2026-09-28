import type { Paginated } from '@acadlyx/tenant-config';
import type {
  AccessRow,
  ClassDetail,
  ClassSummary,
  ActivityItem,
  DashboardSummary,
  ParentDetail,
  SearchResults,
  StudentDetail,
  StudentSummary,
} from '@acadlyx/types';
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

const PREFIX = 'WSP';
const PW = 'Workspace-pass-2026';
const PIN = '369258';
type Role =
  | 'principal'
  | 'admin'
  | 'teacher'
  | 'accountant'
  | 'admission'
  | 'transport'
  | 'parent'
  | 'student';

/**
 * Phase 6 School Admin workspace (e2e): dashboard (real counts, context, permission blocks),
 * section-based class rosters, global search, pending-access list, list filters, the approved
 * teacher data scope (assigned sections only), A→B/B→C/C→A isolation and same-tenant
 * cross-school isolation.
 */
describe('School Admin workspace API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PlatformPrismaService;
  let t: Record<FixtureLetter, FixtureTenant>;
  let school: Record<FixtureLetter, string>;
  const ac = {} as Record<FixtureLetter, AcademicFixture>;
  const token = {} as Record<FixtureLetter, string>;
  const roleToken = {} as Record<Role, string>;
  const ids = {} as Record<
    FixtureLetter,
    {
      s1: string;
      s2: string;
      s3: string;
      s4: string;
      p1: string;
      p2: string;
      teacher: string;
      assignment: string;
    }
  >;

  const api = (l: FixtureLetter) => call(app, { host: t[l].domain, token: token[l] });
  const as = (r: Role) => call(app, { host: t.A.domain, token: roleToken[r] });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PlatformPrismaService);
    await resetRateLimits(app);
    await syncRbac(app);
    t = await createFixtureTenants(prisma, PREFIX);
    school = await createFixtureSchools(prisma, t);
    for (const l of FIXTURE_LETTERS) {
      ac[l] = await createAcademicFixture(prisma, t[l].id, school[l]);
      const email = `principal@wsp-${l.toLowerCase()}.test`;
      await createTenantUser(app, { tenantId: t[l].id, roles: ['PRINCIPAL'], email, secret: PW });
      token[l] = (await tenantLogin(app, t[l].domain, email, PW)).tokens.accessToken;
    }
    roleToken.principal = token.A;
    const staff: [Role, string, string][] = [
      ['admin', 'SCHOOL_ADMIN', 'admin@wsp-a.test'],
      ['teacher', 'TEACHER', 'teacher@wsp-a.test'],
      ['accountant', 'ACCOUNTANT', 'accounts@wsp-a.test'],
      ['admission', 'ADMISSION_OFFICER', 'admissions@wsp-a.test'],
      ['transport', 'TRANSPORT_MANAGER', 'transport@wsp-a.test'],
    ];
    const userIds = {} as Record<Role, string>;
    for (const [role, key, email] of staff) {
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
      phone: '+919833300001',
      credentialType: 'PIN',
      secret: PIN,
    });
    roleToken.parent = (
      await tenantLogin(app, t.A.domain, '+919833300001', PIN)
    ).tokens.accessToken;
    await createTenantUser(app, {
      tenantId: t.A.id,
      roles: ['STUDENT'],
      loginId: 'WSP-STU',
      loginIdKind: 'STUDENT_ID',
      credentialType: 'PIN',
      secret: PIN,
    });
    roleToken.student = (await tenantLogin(app, t.A.domain, 'WSP-STU', PIN)).tokens.accessToken;

    // Identical fixture in every tenant (same names/codes on purpose → leaks would be visible).
    for (const l of FIXTURE_LETTERS) {
      const scope = { tenantId: t[l].id, schoolId: school[l] };
      const student = (n: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') =>
        prisma.student.create({
          data: {
            ...scope,
            admissionNumber: `WS-${n}`,
            firstName: `Wsp${n}`,
            lastName: `Pupil${l}`,
            status,
          },
        });
      const [s1, s2, s3, s4] = [
        await student('1'),
        await student('2'),
        await student('3'),
        await student('4', 'INACTIVE'),
      ];
      const enroll = (studentId: string, sectionId: string) =>
        prisma.studentEnrollment.create({
          data: {
            ...scope,
            studentId,
            sectionId,
            academicYearId: ac[l].yearId,
            startDate: new Date('2026-04-01'),
          },
        });
      await enroll(s1.id, ac[l].sectionA);
      await enroll(s2.id, ac[l].sectionB);
      const p1 = await prisma.parent.create({
        data: {
          ...scope,
          parentCode: 'WP-1',
          firstName: 'Guardian',
          lastName: `One${l}`,
          phone: '+919811111111',
          email: 'g1@wsp.test',
        },
      });
      const p2 = await prisma.parent.create({
        data: { ...scope, parentCode: 'WP-2', firstName: 'Guardian', lastName: `Two${l}` },
      });
      await prisma.studentGuardian.create({
        data: {
          ...scope,
          studentId: s1.id,
          parentId: p1.id,
          relationship: 'MOTHER',
          isPrimary: true,
        },
      });
      await prisma.studentGuardian.create({
        data: {
          ...scope,
          studentId: s2.id,
          parentId: p2.id,
          relationship: 'FATHER',
          isPrimary: true,
        },
      });
      // p1 is also a guardian of s2: a teacher of section A must not learn about s2 through p1.
      await prisma.studentGuardian.create({
        data: { ...scope, studentId: s2.id, parentId: p1.id, relationship: 'GUARDIAN' },
      });
      const teacher = await prisma.teacher.create({
        data: {
          ...scope,
          employeeId: 'WE-1',
          firstName: 'Tutor',
          lastName: `One${l}`,
          userId: l === 'A' ? userIds.teacher : null,
        },
      });
      await prisma.teacher.create({
        data: { ...scope, employeeId: 'WE-2', firstName: 'Tutor', lastName: `Two${l}` },
      });
      const assignment = await prisma.teacherAssignment.create({
        data: { ...scope, teacherId: teacher.id, sectionId: ac[l].sectionA, type: 'CLASS_TEACHER' },
      });
      ids[l] = {
        s1: s1.id,
        s2: s2.id,
        s3: s3.id,
        s4: s4.id,
        p1: p1.id,
        p2: p2.id,
        teacher: teacher.id,
        assignment: assignment.id,
      };
    }
  }, 180_000);

  beforeEach(async () => {
    await resetRateLimits(app);
  });

  afterAll(async () => {
    await purgeTenants(prisma, PREFIX);
    await app.close();
  });

  // ---- Dashboard ------------------------------------------------------------------------------
  describe('dashboard', () => {
    it('returns real, context-aware counts to leadership', async () => {
      const d = (await as('principal').get('/api/v1/workspace/dashboard').expect(200))
        .body as DashboardSummary;
      expect(d.context.academicYear).toMatchObject({ id: ac.A.yearId, isCurrent: true });
      expect(d.context.branch).toBeNull();
      expect(d.students).toEqual({
        byStatus: { ACTIVE: 3, INACTIVE: 1, WITHDRAWN: 0, GRADUATED: 0 },
        enrolled: 2,
      });
      expect(d.teachers).toEqual({ byStatus: { ACTIVE: 2, INACTIVE: 0 } });
      expect(d.parents).toEqual({ total: 2, guardianLinks: 3 });
      expect(d.classes).toEqual({ sections: 3, activeSections: 2 });
      expect(d.dataQuality).toEqual({
        activeStudentsWithoutEnrollment: 1,
        activeStudentsWithoutGuardian: 1,
        activeTeachersWithoutAssignment: 1,
      });
      expect(d.accounts?.teachers).toMatchObject({ NONE: 1, ACTIVE: 1 });
      expect(d.accounts?.students.NONE).toBe(4);
      expect(d.imports).toEqual({ recent: [], pending: 0 });
    });

    it('context: another year/branch changes counts; foreign or unknown ids are 404', async () => {
      const closed = (
        await as('principal')
          .get(`/api/v1/workspace/dashboard?academicYearId=${ac.A.closedYearId}`)
          .expect(200)
      ).body as DashboardSummary;
      expect(closed.context.academicYear).toMatchObject({
        id: ac.A.closedYearId,
        isCurrent: false,
      });
      expect(closed.students?.enrolled).toBe(0);
      expect(closed.classes).toEqual({ sections: 1, activeSections: 1 });
      const branch = (
        await as('principal')
          .get(`/api/v1/workspace/dashboard?branchId=${ac.A.branchId}`)
          .expect(200)
      ).body as DashboardSummary;
      expect(branch.context.branch?.id).toBe(ac.A.branchId);
      expect(branch.students?.enrolled).toBe(2);
      for (const q of [`academicYearId=${ac.B.yearId}`, `branchId=${ac.C.branchId}`])
        await as('principal').get(`/api/v1/workspace/dashboard?${q}`).expect(404);
      await as('principal').get('/api/v1/workspace/dashboard?branchId=not-a-uuid').expect(400);
    });

    it('omits blocks the caller may not read (no zeroed fake metrics)', async () => {
      const teacher = (await as('teacher').get('/api/v1/workspace/dashboard').expect(200))
        .body as DashboardSummary;
      // Phase 7 adds the teacher's scoped day-to-day counts (no school-wide people data).
      expect(Object.keys(teacher).sort()).toEqual(['classes', 'context', 'operations', 'teachers']);
      const accountant = (await as('accountant').get('/api/v1/workspace/dashboard').expect(200))
        .body as DashboardSummary;
      expect(accountant.students?.byStatus.ACTIVE).toBe(3);
      expect(accountant.parents).toBeUndefined();
      expect(accountant.accounts).toBeUndefined();
      for (const r of ['parent', 'student', 'transport'] as const) {
        const d = (await as(r).get('/api/v1/workspace/dashboard').expect(200))
          .body as DashboardSummary;
        expect(Object.keys(d), r).toEqual(['context']);
      }
    });
  });

  // ---- Classes --------------------------------------------------------------------------------
  describe('classes', () => {
    it('lists sections of the context year with real student/teacher counts', async () => {
      const rows = (await as('principal').get('/api/v1/classes').expect(200))
        .body as ClassSummary[];
      expect(rows.map((r) => [r.sectionCode, r.studentCount, r.teacherAssignmentCount])).toEqual([
        ['A', 1, 1],
        ['B', 1, 0],
        ['C', 0, 0],
      ]);
      const closed = (
        await as('principal').get(`/api/v1/classes?academicYearId=${ac.A.closedYearId}`).expect(200)
      ).body as ClassSummary[];
      expect(closed.map((r) => r.sectionId)).toEqual([ac.A.closedSection]);
    });

    it('roster shows students, guardian summary, teachers and grade subjects', async () => {
      const d = (await as('principal').get(`/api/v1/classes/${ac.A.sectionA}`).expect(200))
        .body as ClassDetail;
      expect(d.roster).toHaveLength(1);
      expect(d.roster[0]).toMatchObject({
        id: ids.A.s1,
        admissionNumber: 'WS-1',
        guardianCount: 1,
        primaryGuardian: { firstName: 'Guardian', relationship: 'MOTHER' },
        account: null,
      });
      expect(d.teachers?.map((x) => [x.type, x.employeeId])).toEqual([['CLASS_TEACHER', 'WE-1']]);
      expect(d.subjects?.map((x) => x.code)).toEqual(['MATH']);
      expect(JSON.stringify(d)).not.toMatch(/\+91|@wsp\.test/);
    });

    it('permissions: accountant reads roster without guardian names/assignments; transport/parent denied', async () => {
      const d = (await as('accountant').get(`/api/v1/classes/${ac.A.sectionA}`).expect(200))
        .body as ClassDetail;
      expect(d.roster[0]?.primaryGuardian).toBeNull();
      expect(d.teachers).toBeUndefined();
      expect(d.subjects).toBeUndefined();
      for (const r of ['transport', 'parent', 'student'] as const) {
        await as(r).get('/api/v1/classes').expect(403);
        await as(r).get(`/api/v1/classes/${ac.A.sectionA}`).expect(403);
      }
    });
  });

  // ---- Teacher data scope (approved decision A) ------------------------------------------------
  describe('teacher scope: assigned sections only', () => {
    it('limits lists, details, rosters and search to sections the teacher actively teaches', async () => {
      const classes = (await as('teacher').get('/api/v1/classes').expect(200))
        .body as ClassSummary[];
      expect(classes.map((c) => c.sectionId)).toEqual([ac.A.sectionA]);
      await as('teacher').get(`/api/v1/classes/${ac.A.sectionA}`).expect(200);
      await as('teacher').get(`/api/v1/classes/${ac.A.sectionB}`).expect(404);

      const students = (await as('teacher').get('/api/v1/students').expect(200))
        .body as Paginated<StudentSummary>;
      expect(students.items.map((s) => s.id)).toEqual([ids.A.s1]);
      await as('teacher').get(`/api/v1/students/${ids.A.s1}`).expect(200);
      for (const id of [ids.A.s2, ids.A.s3, ids.A.s4]) {
        await as('teacher').get(`/api/v1/students/${id}`).expect(404);
        await as('teacher').get(`/api/v1/students/${id}/enrollments`).expect(404);
      }
      const parents = (await as('teacher').get('/api/v1/parents').expect(200)).body as Paginated<{
        id: string;
        childrenCount: number;
      }>;
      expect(parents.items.map((p) => [p.id, p.childrenCount])).toEqual([[ids.A.p1, 1]]);
      const p1 = (await as('teacher').get(`/api/v1/parents/${ids.A.p1}`).expect(200))
        .body as ParentDetail;
      expect(p1.children.map((c) => c.studentId)).toEqual([ids.A.s1]);
      await as('teacher').get(`/api/v1/parents/${ids.A.p2}`).expect(404);

      const search = (await as('teacher').get('/api/v1/workspace/search?q=wsp').expect(200))
        .body as SearchResults;
      expect(search.students?.map((s) => s.id)).toEqual([ids.A.s1]);
      // Leadership still sees everything.
      const all = (await as('admin').get('/api/v1/students').expect(200))
        .body as Paginated<StudentSummary>;
      expect(all.total).toBe(4);
    });

    it('ending the assignment removes access immediately; history remains', async () => {
      await prisma.teacherAssignment.update({
        where: { id: ids.A.assignment },
        data: { endedAt: new Date() },
      });
      try {
        await as('teacher').get(`/api/v1/students/${ids.A.s1}`).expect(404);
        await as('teacher').get(`/api/v1/classes/${ac.A.sectionA}`).expect(404);
        expect(
          ((await as('teacher').get('/api/v1/students').expect(200)).body as Paginated<unknown>)
            .total,
        ).toBe(0);
      } finally {
        await prisma.teacherAssignment.update({
          where: { id: ids.A.assignment },
          data: { endedAt: null },
        });
      }
      await as('teacher').get(`/api/v1/students/${ids.A.s1}`).expect(200);
    });

    it('school-wide people summary requires people.read_all', async () => {
      await as('teacher').get('/api/v1/people/summary').expect(403);
      await as('accountant').get('/api/v1/people/summary').expect(200);
    });
  });

  // ---- Search ---------------------------------------------------------------------------------
  describe('global search', () => {
    it('groups by entity, respects permissions and exposes no contact data', async () => {
      const r = (await as('principal').get('/api/v1/workspace/search?q=guardian').expect(200))
        .body as SearchResults;
      expect(r.parents?.map((p) => p.parentCode).sort()).toEqual(['WP-1', 'WP-2']);
      expect(r.students).toEqual([]);
      expect(JSON.stringify(r)).not.toMatch(/\+91|@wsp\.test|dateOfBirth|phone|email/);
      const byCode = (await as('principal').get('/api/v1/workspace/search?q=ws-2').expect(200))
        .body as SearchResults;
      expect(byCode.students?.map((s) => s.admissionNumber)).toEqual(['WS-2']);
      const accountant = (
        await as('accountant').get('/api/v1/workspace/search?q=tutor').expect(200)
      ).body as SearchResults;
      expect(accountant.teachers).toBeUndefined();
      expect(accountant.parents).toBeUndefined();
      const parent = (await as('parent').get('/api/v1/workspace/search?q=wsp').expect(200))
        .body as SearchResults;
      expect(Object.keys(parent)).toEqual(['query']);
      // Contact values are not searchable (cannot be probed).
      const phone = (await as('principal').get('/api/v1/workspace/search?q=9811111111').expect(200))
        .body as SearchResults;
      expect(phone.parents).toEqual([]);
    });

    it('bounds: too short 400, too long 400, capped results per type', async () => {
      await as('principal').get('/api/v1/workspace/search?q=a').expect(400);
      await as('principal')
        .get(`/api/v1/workspace/search?q=${'x'.repeat(65)}`)
        .expect(400);
      await as('principal').get('/api/v1/workspace/search').expect(400);
      const scope = { tenantId: t.A.id, schoolId: school.A };
      await prisma.student.createMany({
        data: Array.from({ length: 9 }, (_, i) => ({
          ...scope,
          admissionNumber: `CAP-${String(i)}`,
          firstName: 'Capped',
        })),
      });
      try {
        const r = (await as('principal').get('/api/v1/workspace/search?q=capped').expect(200))
          .body as SearchResults;
        expect(r.students).toHaveLength(6);
      } finally {
        await prisma.student.deleteMany({
          where: { schoolId: school.A, admissionNumber: { startsWith: 'CAP-' } },
        });
      }
    });
  });

  // ---- Access list & filters ------------------------------------------------------------------
  describe('pending access and list filters', () => {
    it('lists profiles without an active login; leadership only', async () => {
      const rows = (await as('admin').get('/api/v1/workspace/access?kind=teachers').expect(200))
        .body as Paginated<AccessRow>;
      expect(rows.items.map((r) => r.code)).toEqual(['WE-2']);
      const none = (
        await as('admin').get('/api/v1/workspace/access?kind=students&state=NONE').expect(200)
      ).body as Paginated<AccessRow>;
      expect(none.total).toBe(4);
      expect(JSON.stringify(none)).not.toMatch(/\+91|@wsp/);
      await as('admin').get('/api/v1/workspace/access?kind=robots').expect(400);
      await as('admin').get('/api/v1/workspace/access?kind=students&state=ACTIVE').expect(400);
      for (const r of ['teacher', 'admission', 'accountant', 'parent'] as const)
        await as(r).get('/api/v1/workspace/access?kind=students').expect(403);
    });

    it('filters students/teachers/parents by account state and data quality', async () => {
      const list = async (path: string) =>
        ((await as('principal').get(path).expect(200)).body as Paginated<{ id: string }>).items.map(
          (i) => i.id,
        );
      expect(await list('/api/v1/students?quality=NO_GUARDIAN')).toEqual([ids.A.s3]);
      expect(await list('/api/v1/students?quality=NO_ENROLLMENT')).toEqual([ids.A.s3]);
      expect(
        await list(`/api/v1/students?quality=NO_ENROLLMENT&academicYearId=${ac.A.closedYearId}`),
      ).toHaveLength(3);
      expect(await list('/api/v1/students?account=ACTIVE')).toEqual([]);
      expect(await list('/api/v1/teachers?account=ACTIVE')).toEqual([ids.A.teacher]);
      expect(await list('/api/v1/teachers?quality=NO_ASSIGNMENT')).toHaveLength(1);
      expect(await list('/api/v1/parents?account=NONE')).toHaveLength(2);
      await as('principal').get('/api/v1/students?quality=BROKEN').expect(400);
      await as('principal').get('/api/v1/students?account=ROOT').expect(400);
    });

    it('status history names the staff member who made the change', async () => {
      await as('admin')
        .post(`/api/v1/students/${ids.A.s4}/status`)
        .send({ status: 'ACTIVE', reason: 'Returned' })
        .expect(200);
      const d = (await as('admin').get(`/api/v1/students/${ids.A.s4}`).expect(200))
        .body as StudentDetail;
      expect(d.statusHistory[0]).toMatchObject({
        fromStatus: 'INACTIVE',
        toStatus: 'ACTIVE',
        reason: 'Returned',
      });
      expect(typeof d.statusHistory[0]?.actorName).toBe('string');
      await as('admin')
        .post(`/api/v1/students/${ids.A.s4}/status`)
        .send({ status: 'INACTIVE' })
        .expect(200);
      const audit = await prisma.auditLog.findFirst({
        where: { tenantId: t.A.id, action: 'STUDENT_STATUS_CHANGED', resourceId: ids.A.s4 },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit?.actorUserId).toBeTruthy();
    });
  });

  // ---- Activity feed (existing AuditLog) -------------------------------------------------------
  describe('recent activity', () => {
    const feed = async (l: FixtureLetter) =>
      ((await api(l).get('/api/v1/workspace/dashboard').expect(200)).body as DashboardSummary)
        .activity ?? [];

    it('humanises real mutations, newest first, with names and no raw audit data', async () => {
      const created = (
        await as('admin')
          .post('/api/v1/students')
          .send({ admissionNumber: 'ACT-1', firstName: 'Feed', lastName: 'Kid' })
          .expect(201)
      ).body as StudentDetail;
      await as('admin')
        .post(`/api/v1/students/${created.id}/status`)
        .send({ status: 'INACTIVE', reason: 'Secret reason' })
        .expect(200);
      await as('admin')
        .post(`/api/v1/students/${created.id}/guardians`)
        .send({ parentId: ids.A.p2, relationship: 'OTHER' })
        .expect(201);
      const items = await feed('A');
      expect(items.slice(0, 3).map((i) => [i.message, i.subject])).toEqual([
        ['Guardian linked to student', 'Feed Kid'],
        ['Student marked inactive', 'Feed Kid'],
        ['Student profile created', 'Feed Kid'],
      ]);
      expect(items[0]).toMatchObject({
        actorName: 'Test User',
        href: `/people/students/${created.id}`,
      });
      const json = JSON.stringify(items);
      expect(json).not.toMatch(
        /ipAddress|userAgent|metadata|changedFields|Secret reason|importJobId|127\.0\.0\.1|actorUserId|resourceId/,
      );
      for (const i of items)
        expect(Object.keys(i).sort()).toEqual([
          'actorName',
          'at',
          'href',
          'key',
          'message',
          'subject',
        ]);
    });

    it('is limited server-side to 10 and excludes per-row import audit entries', async () => {
      for (let n = 0; n < 12; n += 1)
        await api('B')
          .post('/api/v1/parents')
          .send({ firstName: `Bulkfeed${String(n)}` })
          .expect(201);
      const job = await prisma.bulkImportJob.create({
        data: {
          tenantId: t.B.id,
          schoolId: school.B,
          type: 'PARENTS',
          templateVersion: 1,
          originalFilename: 'x.csv',
          fileHash: 'b'.repeat(64),
          createdByUserId: (await prisma.user.findFirstOrThrow({ where: { tenantId: t.B.id } })).id,
          status: 'COMPLETED',
          totalRows: 1,
          validRows: 1,
          processedRows: 1,
          succeededRows: 1,
        },
      });
      await prisma.auditLog.createMany({
        data: [
          {
            tenantId: t.B.id,
            actorLabel: 'system',
            action: 'PARENT_CREATED',
            resourceType: 'parent',
            resourceId: ids.B.p1,
            metadata: { importJobId: job.id },
          },
          {
            tenantId: t.B.id,
            actorLabel: 'system',
            action: 'IMPORT_COMPLETED',
            resourceType: 'bulk_import',
            resourceId: job.id,
            metadata: { type: 'PARENTS', importJobId: job.id },
          },
        ],
      });
      const items = await feed('B');
      expect(items).toHaveLength(10);
      expect(items[0]?.message).toBe('Guardian import completed');
      expect(
        items.filter(
          (i) => i.message === 'Guardian profile created' && i.subject?.startsWith('Guardian Two'),
        ),
      ).toEqual([]);
    });

    it('permission: only Principal / School Admin receive activity (API-enforced)', async () => {
      expect(
        (await as('admin').get('/api/v1/workspace/dashboard').expect(200)).body,
      ).toHaveProperty('activity');
      for (const r of [
        'teacher',
        'accountant',
        'admission',
        'transport',
        'parent',
        'student',
      ] as const) {
        const d = (await as(r).get('/api/v1/workspace/dashboard').expect(200))
          .body as DashboardSummary;
        expect(d.activity, r).toBeUndefined();
      }
    });

    it('A↔B↔C isolation and same-tenant second-school isolation', async () => {
      await api('C')
        .post('/api/v1/teachers')
        .send({ employeeId: 'ACT-C', firstName: 'Onlyinc' })
        .expect(201);
      const texts = async (l: FixtureLetter) => JSON.stringify(await feed(l));
      expect(await texts('A')).not.toMatch(/Bulkfeed|Onlyinc/);
      expect(await texts('B')).not.toMatch(/Feed Kid|Onlyinc/);
      expect(await texts('C')).toContain('Onlyinc');
      expect(await texts('C')).not.toMatch(/Feed Kid|Bulkfeed/);
      // Second school inside tenant A: its (real) audit rows must never reach school A's feed.
      const second = await prisma.school.create({
        data: { tenantId: t.A.id, name: 'Second', timezone: 'UTC', workingDays: ['MONDAY'] },
      });
      const kid = await prisma.student.create({
        data: {
          tenantId: t.A.id,
          schoolId: second.id,
          admissionNumber: 'ACT-X',
          firstName: 'Otherschoolfeed',
        },
      });
      await prisma.auditLog.create({
        data: {
          tenantId: t.A.id,
          actorLabel: 'x',
          action: 'STUDENT_CREATED',
          resourceType: 'student',
          resourceId: kid.id,
        },
      });
      try {
        const a = await feed('A');
        expect(JSON.stringify(a)).not.toContain('Otherschoolfeed');
        expect(a.length).toBeGreaterThan(0);
      } finally {
        await prisma.student.delete({ where: { id: kid.id } });
        await prisma.school.delete({ where: { id: second.id } });
      }
    });

    it('never selects security or platform events', async () => {
      await prisma.auditLog.createMany({
        data: [
          'LOGIN_FAILED',
          'MFA_ENROLLED',
          'SESSION_REVOKED',
          'TENANT_CREATED',
          'ROLE_ASSIGNED',
        ].map((action) => ({
          tenantId: t.A.id,
          actorLabel: 'x',
          action,
          resourceType: 'user',
          resourceId: ids.A.teacher,
          ipAddress: '10.9.8.7',
        })),
      });
      const items: ActivityItem[] = await feed('A');
      expect(JSON.stringify(items)).not.toMatch(/10\.9\.8\.7|login|MFA|session|role/i);
    });
  });

  // ---- Isolation ------------------------------------------------------------------------------
  describe('isolation', () => {
    it.each([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'A'],
    ] as const)(
      '%s → %s: dashboard, search, classes, rosters and ids never cross tenants',
      async (me, other) => {
        const d = (await api(me).get('/api/v1/workspace/dashboard').expect(200))
          .body as DashboardSummary;
        expect(d.students?.byStatus.ACTIVE).toBe(3);
        const s = (await api(me).get('/api/v1/workspace/search?q=pupil').expect(200))
          .body as SearchResults;
        expect(s.students?.every((x) => x.label.endsWith(`Pupil${me}`))).toBe(true);
        expect(JSON.stringify(s)).not.toContain(`Pupil${other}`);
        const classes = (await api(me).get('/api/v1/classes').expect(200)).body as ClassSummary[];
        expect(classes.map((c) => c.sectionId)).not.toContain(ac[other].sectionA);
        await api(me).get(`/api/v1/classes/${ac[other].sectionA}`).expect(404);
        await api(me).get(`/api/v1/students/${ids[other].s1}`).expect(404);
        await api(me).get(`/api/v1/parents/${ids[other].p1}`).expect(404);
        await api(me).get(`/api/v1/classes?gradeId=${ac[other].gradeId}`).expect(404);
        // Another tenant's token on this host is rejected outright.
        await call(app, { host: t[other].domain, token: token[me] })
          .get('/api/v1/workspace/dashboard')
          .expect(403);
      },
    );

    it('same tenant, second school: nothing from school A2 leaks into the school A workspace', async () => {
      const second = await prisma.school.create({
        data: { tenantId: t.A.id, name: 'Second', timezone: 'UTC', workingDays: ['MONDAY'] },
      });
      const other = await createAcademicFixture(prisma, t.A.id, second.id);
      const kid = await prisma.student.create({
        data: {
          tenantId: t.A.id,
          schoolId: second.id,
          admissionNumber: 'WS-X',
          firstName: 'Otherschool',
          lastName: 'Kid',
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
        const s = (await as('principal').get('/api/v1/workspace/search?q=otherschool').expect(200))
          .body as SearchResults;
        expect(s.students).toEqual([]);
        await as('principal').get(`/api/v1/classes/${other.sectionA}`).expect(404);
        await as('principal').get(`/api/v1/students/${kid.id}`).expect(404);
        await as('principal')
          .get(`/api/v1/workspace/dashboard?academicYearId=${other.yearId}`)
          .expect(404);
        const d = (await as('principal').get('/api/v1/workspace/dashboard').expect(200))
          .body as DashboardSummary;
        expect(d.students?.byStatus.ACTIVE).toBe(3);
        const classes = (await as('principal').get('/api/v1/classes').expect(200))
          .body as ClassSummary[];
        expect(classes.map((c) => c.sectionId)).not.toContain(other.sectionA);
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
  });
});
