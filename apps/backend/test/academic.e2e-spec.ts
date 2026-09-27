import type {
  AcademicSettings,
  AcademicYear,
  Branch,
  Grade,
  GradeSubject,
  School,
  SchoolSetupStatus,
  Section,
  Subject,
} from '@acadlyx/types';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PlatformPrismaService } from '../src/database/platform-prisma.service.js';
import { createTestApp } from './helpers/app.js';
import {
  call,
  createPlatformUser,
  createTenantUser,
  platformLogin,
  purgePlatformUsers,
  resetRateLimits,
  syncRbac,
  tenantLogin,
} from './helpers/auth.js';
import {
  createFixtureSchools,
  createFixtureTenants,
  FIXTURE_LETTERS,
  type FixtureLetter,
  type FixtureTenant,
  purgeTenants,
} from './helpers/tenant-fixtures.js';

const PREFIX = 'ACAD';
const PW = 'Acad-pass-2026';
const PIN = '258147';

type Role = 'principal' | 'admin' | 'teacher' | 'accountant' | 'transport' | 'parent' | 'student';

/**
 * Phase 4 school & academic configuration API (e2e): RBAC per role, business rules of every
 * resource, cross-tenant/IDOR attacks (A→B, B→C, C→A), concurrency invariants and audit.
 */
describe('School & academic configuration API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PlatformPrismaService;
  let t: Record<FixtureLetter, FixtureTenant>;
  let schoolId: Record<FixtureLetter, string>;
  const token = {} as Record<FixtureLetter, string>; // principal per tenant
  const roleToken = {} as Record<Role, string>; // tenant A
  const userId = {} as Record<Role, string>;

  const api = (letter: FixtureLetter, bearer = token[letter]) =>
    call(app, { host: t[letter].domain, token: bearer });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PlatformPrismaService);
    await resetRateLimits(app);
    await syncRbac(app);
    t = await createFixtureTenants(prisma, PREFIX);
    schoolId = await createFixtureSchools(prisma, t);
    for (const l of FIXTURE_LETTERS) {
      const email = `principal@acad-${l.toLowerCase()}.test`;
      const id = await createTenantUser(app, {
        tenantId: t[l].id,
        roles: ['PRINCIPAL'],
        email,
        secret: PW,
      });
      token[l] = (await tenantLogin(app, t[l].domain, email, PW)).tokens.accessToken;
      if (l === 'A') userId.principal = id;
    }
    roleToken.principal = token.A;
    const staff: [Role, string, string][] = [
      ['admin', 'SCHOOL_ADMIN', 'admin@acad-a.test'],
      ['teacher', 'TEACHER', 'teacher@acad-a.test'],
      ['accountant', 'ACCOUNTANT', 'accounts@acad-a.test'],
      ['transport', 'TRANSPORT_MANAGER', 'transport@acad-a.test'],
    ];
    for (const [role, key, email] of staff) {
      userId[role] = await createTenantUser(app, {
        tenantId: t.A.id,
        roles: [key],
        email,
        secret: PW,
      });
      roleToken[role] = (await tenantLogin(app, t.A.domain, email, PW)).tokens.accessToken;
    }
    userId.parent = await createTenantUser(app, {
      tenantId: t.A.id,
      roles: ['PARENT'],
      phone: '+919811100001',
      credentialType: 'PIN',
      secret: PIN,
    });
    roleToken.parent = (
      await tenantLogin(app, t.A.domain, '+919811100001', PIN)
    ).tokens.accessToken;
    userId.student = await createTenantUser(app, {
      tenantId: t.A.id,
      roles: ['STUDENT'],
      loginId: 'ACAD-STU-1',
      loginIdKind: 'STUDENT_ID',
      credentialType: 'PIN',
      secret: PIN,
    });
    roleToken.student = (await tenantLogin(app, t.A.domain, 'ACAD-STU-1', PIN)).tokens.accessToken;
  }, 120_000);

  beforeEach(async () => {
    await resetRateLimits(app);
  });

  afterAll(async () => {
    await purgeTenants(prisma, PREFIX);
    await purgePlatformUsers(app, 'acad-');
    await app.close();
  });

  // ---- Helpers ------------------------------------------------------------------------------
  const branch = async (l: FixtureLetter, code: string, extra: Record<string, unknown> = {}) =>
    (
      await api(l)
        .post('/api/v1/branches')
        .send({ name: `Branch ${code}`, code, ...extra })
        .expect(201)
    ).body as Branch;
  const year = async (l: FixtureLetter, name: string, startDate: string, endDate: string) =>
    (await api(l).post('/api/v1/academic-years').send({ name, startDate, endDate }).expect(201))
      .body as AcademicYear;
  const grade = async (l: FixtureLetter, code: string, name = `Grade ${code}`) =>
    (await api(l).post('/api/v1/grades').send({ name, code }).expect(201)).body as Grade;
  const subject = async (l: FixtureLetter, code: string, name = `Subject ${code}`) =>
    (await api(l).post('/api/v1/subjects').send({ name, code }).expect(201)).body as Subject;
  const section = async (
    l: FixtureLetter,
    scope: { branchId: string; academicYearId: string; gradeId: string },
    code: string,
    extra: Record<string, unknown> = {},
  ) =>
    (
      await api(l)
        .post('/api/v1/sections')
        .send({ ...scope, name: code, code, ...extra })
        .expect(201)
    ).body as Section;

  // ---- RBAC ---------------------------------------------------------------------------------
  describe('RBAC', () => {
    it('Principal and School Admin manage; Teacher/Accountant/Transport read only what they need; Parent/Student denied', async () => {
      const as = (role: Role) => call(app, { host: t.A.domain, token: roleToken[role] });
      for (const role of ['principal', 'admin'] as const) {
        await as(role).get('/api/v1/school').expect(200);
        await as(role)
          .patch('/api/v1/school')
          .send({ shortName: `By ${role}` })
          .expect(200);
        await as(role).get('/api/v1/school/academic-settings').expect(200);
        await as(role)
          .post('/api/v1/grades')
          .send({ name: `R ${role}`, code: `R-${role.toUpperCase()}` })
          .expect(201);
      }
      for (const path of [
        '/api/v1/school',
        '/api/v1/branches',
        '/api/v1/academic-years',
        '/api/v1/grades',
        '/api/v1/sections',
        '/api/v1/subjects',
      ]) {
        await as('teacher').get(path).expect(200);
      }
      await as('teacher').patch('/api/v1/school').send({ shortName: 'x' }).expect(403);
      await as('teacher').post('/api/v1/grades').send({ name: 'x', code: 'X' }).expect(403);
      await as('teacher').post('/api/v1/subjects').send({ name: 'x', code: 'X' }).expect(403);
      await as('teacher').get('/api/v1/school/academic-settings').expect(403);

      await as('accountant').get('/api/v1/grades').expect(200);
      await as('accountant').get('/api/v1/sections').expect(200);
      await as('accountant').get('/api/v1/subjects').expect(403);
      await as('accountant').post('/api/v1/branches').send({ name: 'x', code: 'X' }).expect(403);
      await as('accountant').patch('/api/v1/school').send({ shortName: 'x' }).expect(403);

      await as('transport').get('/api/v1/branches').expect(200);
      await as('transport').get('/api/v1/grades').expect(403);

      for (const role of ['parent', 'student'] as const) {
        for (const path of [
          '/api/v1/school',
          '/api/v1/branches',
          '/api/v1/grades',
          '/api/v1/subjects',
          '/api/v1/school/setup-status',
        ]) {
          const res = await as(role).get(path).expect(403);
          expect(res.body).toMatchObject({ code: 'PERMISSION_DENIED' });
        }
        await as(role).post('/api/v1/grades').send({ name: 'x', code: 'X' }).expect(403);
      }
      // No token → 401; garbage token → 401.
      await call(app, { host: t.A.domain }).get('/api/v1/school').expect(401);
      await call(app, { host: t.A.domain, token: 'not-a-jwt' }).get('/api/v1/school').expect(401);
    });

    it('keeps platform and tenant scopes separate', async () => {
      await purgePlatformUsers(app, 'acad-');
      await createPlatformUser(app, {
        email: 'acad-admin@acadlyx.test',
        password: 'Acad-admin-pass-26',
      });
      const platform = (await platformLogin(app, 'acad-admin@acadlyx.test', 'Acad-admin-pass-26'))
        .tokens.accessToken;
      // Platform token → tenant academic API: rejected (no impersonation/support access).
      const res = await call(app, { host: t.A.domain, token: platform }).get('/api/v1/school');
      expect([401, 403]).toContain(res.status);
      // Tenant token → platform API: rejected.
      const res2 = await call(app, { token: token.A }).get('/api/v1/platform/tenants');
      expect([401, 403]).toContain(res2.status);
      // New tenants get their School provisioned atomically (+ audited).
      const created = await call(app, { token: platform })
        .post('/api/v1/platform/tenants')
        .send({
          key: `${PREFIX}_NEW`,
          slug: 'acad-new',
          displayName: 'Acad New School',
          legalName: "St. Mary's Acad Trust",
        })
        .expect(201);
      const tenantId = (created.body as { id: string }).id;
      const schools = await prisma.school.findMany({ where: { tenantId } });
      expect(schools).toHaveLength(1);
      expect(schools[0]).toMatchObject({
        name: "St. Mary's Acad Trust",
        timezone: 'Asia/Kolkata',
        academicYearStartMonth: 4,
      });
      expect(
        await prisma.platformAuditLog.count({ where: { tenantId, action: 'SCHOOL_PROVISIONED' } }),
      ).toBe(1);
    });
  });

  // ---- School profile & academic settings ------------------------------------------------------
  describe('school profile and academic settings', () => {
    it('updates the profile, preserving names and normalising codes; codes are unique per tenant only', async () => {
      const updated = (
        await api('A')
          .patch('/api/v1/school')
          .send({
            name: "St. Joseph's Test School",
            code: ' sjt-1 ',
            board: 'OTHER',
            boardName: 'Montessori',
            website: 'https://sjt.example.com',
            country: 'in',
            postalCode: '462 001',
          })
          .expect(200)
      ).body as School;
      expect(updated).toMatchObject({
        id: schoolId.A,
        name: "St. Joseph's Test School",
        code: 'SJT-1',
        board: 'OTHER',
        boardName: 'Montessori',
        country: 'IN',
      });
      // Same code in another tenant is fine.
      await api('B').patch('/api/v1/school').send({ code: 'SJT-1' }).expect(200);
      // Changing the board away from OTHER clears the custom name; a custom name needs OTHER.
      const cbse = (await api('A').patch('/api/v1/school').send({ board: 'CBSE' }).expect(200))
        .body as School;
      expect(cbse.boardName).toBeNull();
      const bad = await api('A').patch('/api/v1/school').send({ boardName: 'X' }).expect(400);
      expect(bad.body).toMatchObject({ code: 'BOARD_NAME_ONLY_FOR_OTHER' });
      await api('A').patch('/api/v1/school').send({ code: 'bad code!' }).expect(400);
      await api('A').patch('/api/v1/school').send({ name: '<script>' }).expect(400);
      await api('A').patch('/api/v1/school').send({ tenantId: t.B.id }).expect(400); // unknown field
      await api('A').patch('/api/v1/school').send({ website: 'javascript:alert(1)' }).expect(400);
    });

    it('updates academic settings with real IANA zones and any working days', async () => {
      const s = (
        await api('A')
          .patch('/api/v1/school/academic-settings')
          .send({
            timezone: 'Asia/Dubai',
            weekStartDay: 'SUNDAY',
            workingDays: ['THURSDAY', 'SUNDAY', 'MONDAY'],
            academicYearStartMonth: 9,
          })
          .expect(200)
      ).body as AcademicSettings;
      expect(s).toEqual({
        timezone: 'Asia/Dubai',
        weekStartDay: 'SUNDAY',
        workingDays: ['MONDAY', 'THURSDAY', 'SUNDAY'],
        academicYearStartMonth: 9,
      });
      for (const body of [
        { timezone: 'IST' },
        { timezone: '+05:30' },
        { workingDays: [] },
        { workingDays: ['MONDAY', 'MONDAY'] },
        { academicYearStartMonth: 13 },
        { weekStartDay: 'FUNDAY' },
      ]) {
        await api('A').patch('/api/v1/school/academic-settings').send(body).expect(400);
      }
      await api('A')
        .patch('/api/v1/school/academic-settings')
        .send({ timezone: 'Asia/Kolkata', weekStartDay: 'MONDAY' })
        .expect(200);
    });
  });

  // ---- Branches -----------------------------------------------------------------------------
  describe('branches', () => {
    it('first branch is primary; primary switch is atomic; primary cannot be deactivated', async () => {
      const main = await branch('A', 'main', { city: 'Lakeview', timezone: 'Asia/Kolkata' });
      expect(main).toMatchObject({
        code: 'MAIN',
        isPrimary: true,
        isActive: true,
        timezone: 'Asia/Kolkata',
      });
      const east = await branch('A', 'EAST');
      expect(east.isPrimary).toBe(false);
      expect(east.timezone).toBe('Asia/Kolkata'); // inherited from academic settings
      const dup = await api('A')
        .post('/api/v1/branches')
        .send({ name: 'Again', code: 'main' })
        .expect(409);
      expect(dup.body).toMatchObject({ code: 'DUPLICATE_BRANCH_CODE' });
      await api('A')
        .post('/api/v1/branches')
        .send({ name: 'Bad tz', code: 'TZ', timezone: 'IST' })
        .expect(400);
      const denied = await api('A').post(`/api/v1/branches/${main.id}/deactivate`).expect(409);
      expect(denied.body).toMatchObject({ code: 'PRIMARY_BRANCH_REQUIRED' });

      await api('A').post(`/api/v1/branches/${east.id}/set-primary`).expect(200);
      const list = (await api('A').get('/api/v1/branches').expect(200)).body as Branch[];
      expect(list.filter((b) => b.isPrimary).map((b) => b.id)).toEqual([east.id]);
      expect(list[0]?.id).toBe(east.id); // primary first
      await api('A').post(`/api/v1/branches/${main.id}/deactivate`).expect(200);
      const inactive = await api('A').post(`/api/v1/branches/${main.id}/set-primary`).expect(409);
      expect(inactive.body).toMatchObject({ code: 'BRANCH_INACTIVE' });
      await api('A').post(`/api/v1/branches/${main.id}/activate`).expect(200);
      const search = (await api('A').get('/api/v1/branches?q=lakeview').expect(200))
        .body as Branch[];
      expect(search.map((b) => b.code)).toEqual(['MAIN']);
      const renamed = (
        await api('A')
          .patch(`/api/v1/branches/${main.id}`)
          .send({ name: 'Main Campus', phone: '' })
          .expect(200)
      ).body as Branch;
      expect(renamed).toMatchObject({ name: 'Main Campus', phone: null, code: 'MAIN' });
      // No delete endpoint exists.
      expect((await api('A').delete(`/api/v1/branches/${main.id}`)).status).toBe(404);
    });
  });

  // ---- Academic years -------------------------------------------------------------------------
  describe('academic years', () => {
    it('enforces PLANNED → ACTIVE → CLOSED, one current year, date locking and no overlap', async () => {
      const y1 = await year('A', '2026–27', '2026-04-01', '2027-03-31');
      expect(y1).toMatchObject({
        status: 'PLANNED',
        isCurrent: false,
        startDate: '2026-04-01',
        endDate: '2027-03-31',
      });
      const overlap = await api('A')
        .post('/api/v1/academic-years')
        .send({ name: 'Overlap', startDate: '2027-03-31', endDate: '2028-03-30' })
        .expect(409);
      expect(overlap.body).toMatchObject({ code: 'ACADEMIC_YEAR_OVERLAP' });
      await api('A')
        .post('/api/v1/academic-years')
        .send({ name: 'Backwards', startDate: '2029-04-01', endDate: '2029-03-01' })
        .expect(400);
      await api('A')
        .post('/api/v1/academic-years')
        .send({ name: 'Bad', startDate: '2026-02-30', endDate: '2026-12-01' })
        .expect(400);
      const dupName = await api('A')
        .post('/api/v1/academic-years')
        .send({ name: '2026–27', startDate: '2030-04-01', endDate: '2031-03-31' })
        .expect(409);
      expect(dupName.body).toMatchObject({ code: 'DUPLICATE_ACADEMIC_YEAR_NAME' });

      const notActive = await api('A')
        .post(`/api/v1/academic-years/${y1.id}/set-current`)
        .expect(409);
      expect(notActive.body).toMatchObject({ code: 'ACADEMIC_YEAR_NOT_ACTIVE' });
      // Dates editable while PLANNED.
      const moved = (
        await api('A')
          .patch(`/api/v1/academic-years/${y1.id}`)
          .send({ startDate: '2026-04-02' })
          .expect(200)
      ).body as AcademicYear;
      expect(moved.startDate).toBe('2026-04-02');
      await api('A').post(`/api/v1/academic-years/${y1.id}/activate`).expect(200);
      await api('A').post(`/api/v1/academic-years/${y1.id}/set-current`).expect(200);
      const locked = await api('A')
        .patch(`/api/v1/academic-years/${y1.id}`)
        .send({ endDate: '2027-03-30' })
        .expect(409);
      expect(locked.body).toMatchObject({ code: 'ACADEMIC_YEAR_DATES_LOCKED' });
      await api('A')
        .patch(`/api/v1/academic-years/${y1.id}`)
        .send({ name: '2026-27 (main)' })
        .expect(200);

      const y2 = await year('A', '2027–28', '2027-04-01', '2028-03-31');
      await api('A').post(`/api/v1/academic-years/${y2.id}/activate`).expect(200);
      await api('A').post(`/api/v1/academic-years/${y2.id}/set-current`).expect(200);
      const years = (await api('A').get('/api/v1/academic-years').expect(200))
        .body as AcademicYear[];
      expect(years.map((y) => y.name)).toEqual(['2027–28', '2026-27 (main)']); // start date DESC
      expect(years.filter((y) => y.isCurrent).map((y) => y.id)).toEqual([y2.id]);

      const closeCurrent = await api('A').post(`/api/v1/academic-years/${y2.id}/close`).expect(409);
      expect(closeCurrent.body).toMatchObject({ code: 'CURRENT_ACADEMIC_YEAR_CANNOT_CLOSE' });
      await api('A').post(`/api/v1/academic-years/${y1.id}/close`).expect(200);
      const reopen = await api('A').post(`/api/v1/academic-years/${y1.id}/activate`).expect(409);
      expect(reopen.body).toMatchObject({ code: 'ACADEMIC_YEAR_TRANSITION_INVALID' });
      const y3 = await year('A', '2028–29', '2028-04-01', '2029-03-31');
      const skip = await api('A').post(`/api/v1/academic-years/${y3.id}/close`).expect(409);
      expect(skip.body).toMatchObject({ code: 'ACADEMIC_YEAR_TRANSITION_INVALID' });
    });
  });

  // ---- Grades, sections, subjects --------------------------------------------------------------
  describe('grades, sections, subjects', () => {
    it('orders grades explicitly and reorders atomically', async () => {
      const g10 = await grade('B', 'G10', 'Grade 10');
      const g2 = await grade('B', 'g2', 'Grade 2');
      const nur = await grade('B', 'NUR', 'Nursery');
      expect([g10.displayOrder, g2.displayOrder, nur.displayOrder]).toEqual([0, 1, 2]);
      expect(g2.code).toBe('G2');
      const reordered = (
        await api('B')
          .put('/api/v1/grades/order')
          .send({ ids: [nur.id, g2.id, g10.id] })
          .expect(200)
      ).body as Grade[];
      expect(reordered.map((g) => [g.code, g.displayOrder])).toEqual([
        ['NUR', 0],
        ['G2', 1],
        ['G10', 2],
      ]);
      const partial = await api('B')
        .put('/api/v1/grades/order')
        .send({ ids: [nur.id, g2.id] })
        .expect(400);
      expect(partial.body).toMatchObject({ code: 'REORDER_MISMATCH' });
      await api('B')
        .put('/api/v1/grades/order')
        .send({ ids: [nur.id, nur.id, g10.id] })
        .expect(400);
      const dup = await api('B')
        .post('/api/v1/grades')
        .send({ name: 'Again', code: 'g10' })
        .expect(409);
      expect(dup.body).toMatchObject({ code: 'DUPLICATE_GRADE_CODE' });
      await api('B').post(`/api/v1/grades/${g10.id}/deactivate`).expect(200);
      const list = (await api('B').get('/api/v1/grades').expect(200)).body as Grade[];
      expect(list.map((g) => g.code)).toEqual(['NUR', 'G2', 'G10']);
      expect(list.find((g) => g.code === 'G10')?.isActive).toBe(false);
    });

    it('scopes sections to branch + academic year + grade', async () => {
      const b1 = await branch('C', 'C1');
      const b2 = await branch('C', 'C2');
      const y = await year('C', '2026–27', '2026-06-01', '2027-04-30');
      const g = await grade('C', 'G5', 'Grade 5');
      const scope = { branchId: b1.id, academicYearId: y.id, gradeId: g.id };
      const a = await section('C', scope, 'a', { capacity: 40 });
      const b = await section('C', scope, 'B');
      expect([a.code, a.displayOrder, a.capacity, b.displayOrder, b.capacity]).toEqual([
        'A',
        0,
        40,
        1,
        null,
      ]);
      // Same code at another branch is a different section.
      await section('C', { ...scope, branchId: b2.id }, 'A');
      const dup = await api('C')
        .post('/api/v1/sections')
        .send({ ...scope, name: 'A again', code: 'A' })
        .expect(409);
      expect(dup.body).toMatchObject({ code: 'DUPLICATE_SECTION_CODE' });
      await api('C')
        .post('/api/v1/sections')
        .send({ ...scope, name: 'Z', code: 'Z', capacity: 0 })
        .expect(400);
      const filtered = (
        await api('C').get(`/api/v1/sections?branchId=${b1.id}&gradeId=${g.id}`).expect(200)
      ).body as Section[];
      expect(filtered.map((s) => s.code)).toEqual(['A', 'B']);
      const order = (
        await api('C')
          .put('/api/v1/sections/order')
          .send({ ...scope, ids: [b.id, a.id] })
          .expect(200)
      ).body as Section[];
      expect(order.map((s) => s.code)).toEqual(['B', 'A']);
      const renamed = (
        await api('C')
          .patch(`/api/v1/sections/${a.id}`)
          .send({ name: 'A (Science)', capacity: null })
          .expect(200)
      ).body as Section;
      expect(renamed).toMatchObject({ name: 'A (Science)', capacity: null, branchId: b1.id });
      // Scope is immutable: unknown fields are rejected.
      await api('C').patch(`/api/v1/sections/${a.id}`).send({ branchId: b2.id }).expect(400);
      // Inactive parents / closed years refuse new sections.
      await api('C').post(`/api/v1/grades/${g.id}/deactivate`).expect(200);
      const inactive = await api('C')
        .post('/api/v1/sections')
        .send({ ...scope, name: 'C', code: 'C' })
        .expect(409);
      expect(inactive.body).toMatchObject({ code: 'GRADE_INACTIVE' });
      await api('C').post(`/api/v1/grades/${g.id}/activate`).expect(200);
      await api('C').post(`/api/v1/academic-years/${y.id}/activate`).expect(200);
      await api('C').post(`/api/v1/academic-years/${y.id}/close`).expect(200);
      const closed = await api('C')
        .post('/api/v1/sections')
        .send({ ...scope, name: 'C', code: 'C' })
        .expect(409);
      expect(closed.body).toMatchObject({ code: 'ACADEMIC_YEAR_CLOSED' });
      await api('C').post(`/api/v1/sections/${b.id}/deactivate`).expect(200);
    });

    it('manages subjects and grade–subject mappings', async () => {
      const g = await grade('A', 'GS1', 'Grade S1');
      const eng = await subject('A', 'eng', 'English');
      const hin = await subject('A', 'HIN', 'Hindi (Second Language)');
      expect(eng.code).toBe('ENG');
      const dup = await api('A')
        .post('/api/v1/subjects')
        .send({ name: 'English 2', code: 'ENG' })
        .expect(409);
      expect(dup.body).toMatchObject({ code: 'DUPLICATE_SUBJECT_CODE' });
      let map = (
        await api('A').put(`/api/v1/grades/${g.id}/subjects/${eng.id}`).send({}).expect(200)
      ).body as GradeSubject[];
      map = (
        await api('A')
          .put(`/api/v1/grades/${g.id}/subjects/${hin.id}`)
          .send({ isRequired: false })
          .expect(200)
      ).body as GradeSubject[];
      expect(map.map((m) => [m.subjectCode, m.isRequired, m.displayOrder])).toEqual([
        ['ENG', true, 0],
        ['HIN', false, 1],
      ]);
      map = (
        await api('A')
          .put(`/api/v1/grades/${g.id}/subjects/${hin.id}`)
          .send({ isRequired: true })
          .expect(200)
      ).body as GradeSubject[];
      expect(map.find((m) => m.subjectCode === 'HIN')?.isRequired).toBe(true);
      map = (await api('A').delete(`/api/v1/grades/${g.id}/subjects/${hin.id}`).expect(200))
        .body as GradeSubject[];
      expect(map.map((m) => m.subjectCode)).toEqual(['ENG']);
      await api('A').delete(`/api/v1/grades/${g.id}/subjects/${hin.id}`).expect(404);
      await api('A').post(`/api/v1/subjects/${hin.id}/deactivate`).expect(200);
      const inactive = await api('A')
        .put(`/api/v1/grades/${g.id}/subjects/${hin.id}`)
        .send({})
        .expect(409);
      expect(inactive.body).toMatchObject({ code: 'SUBJECT_INACTIVE' });
      const found = (await api('A').get('/api/v1/subjects?q=hindi').expect(200)).body as Subject[];
      expect(found.map((s) => s.code)).toEqual(['HIN']);
      const teacherView = await call(app, { host: t.A.domain, token: roleToken.teacher })
        .get(`/api/v1/grades/${g.id}/subjects`)
        .expect(200);
      expect((teacherView.body as GradeSubject[]).map((m) => m.subjectCode)).toEqual(['ENG']);
      await call(app, { host: t.A.domain, token: roleToken.teacher })
        .put(`/api/v1/grades/${g.id}/subjects/${hin.id}`)
        .send({})
        .expect(403);
    });

    it('reports real setup status', async () => {
      const status = (await api('C').get('/api/v1/school/setup-status').expect(200))
        .body as SchoolSetupStatus;
      expect(status.counts).toMatchObject({
        branches: 2,
        academicYears: 1,
        grades: 1,
        subjects: 0,
      });
      expect(status.checklist).toMatchObject({
        primaryBranch: true,
        currentAcademicYear: false,
        subjects: false,
      });
    });
  });

  // ---- Cross-tenant / IDOR ---------------------------------------------------------------------
  describe('cross-tenant attacks (A→B, B→C, C→A)', () => {
    it('never reads, links, updates or deactivates another tenant’s academic data', async () => {
      const ids = {} as Record<
        FixtureLetter,
        {
          branch: string;
          year: string;
          grade: string;
          section: string;
          subject: string;
          name: string;
        }
      >;
      for (const l of FIXTURE_LETTERS) {
        const b = await branch(l, `X${l}`, { name: `Secret Branch ${l}` });
        const y = await year(l, `X-${l}`, '2035-04-01', '2036-03-31');
        const g = await grade(l, `XG${l}`, `Secret Grade ${l}`);
        const s = await section(
          l,
          { branchId: b.id, academicYearId: y.id, gradeId: g.id },
          `X${l}`,
        );
        const sub = await subject(l, `XS${l}`, `Secret Subject ${l}`);
        ids[l] = {
          branch: b.id,
          year: y.id,
          grade: g.id,
          section: s.id,
          subject: sub.id,
          name: `Secret Branch ${l}`,
        };
      }
      const pairs: [FixtureLetter, FixtureLetter][] = [
        ['A', 'B'],
        ['B', 'C'],
        ['C', 'A'],
      ];
      for (const [me, victim] of pairs) {
        const v = ids[victim];
        const probes: [string, string, Record<string, unknown>?][] = [
          ['get', `/api/v1/branches/${v.branch}`],
          ['patch', `/api/v1/branches/${v.branch}`, { name: 'pwned' }],
          ['post', `/api/v1/branches/${v.branch}/deactivate`],
          ['post', `/api/v1/branches/${v.branch}/set-primary`],
          ['get', `/api/v1/academic-years/${v.year}`],
          ['patch', `/api/v1/academic-years/${v.year}`, { name: 'pwned' }],
          ['post', `/api/v1/academic-years/${v.year}/activate`],
          ['post', `/api/v1/academic-years/${v.year}/set-current`],
          ['get', `/api/v1/grades/${v.grade}`],
          ['patch', `/api/v1/grades/${v.grade}`, { name: 'pwned' }],
          ['post', `/api/v1/grades/${v.grade}/deactivate`],
          ['get', `/api/v1/grades/${v.grade}/subjects`],
          ['put', `/api/v1/grades/${v.grade}/subjects/${v.subject}`, {}],
          ['get', `/api/v1/sections/${v.section}`],
          ['patch', `/api/v1/sections/${v.section}`, { name: 'pwned' }],
          ['post', `/api/v1/sections/${v.section}/deactivate`],
          ['get', `/api/v1/subjects/${v.subject}`],
          ['patch', `/api/v1/subjects/${v.subject}`, { name: 'pwned' }],
          ['post', `/api/v1/subjects/${v.subject}/deactivate`],
          // Linking my structure to the victim's ids.
          [
            'post',
            '/api/v1/sections',
            {
              branchId: v.branch,
              academicYearId: ids[me].year,
              gradeId: ids[me].grade,
              name: 'L',
              code: 'L',
            },
          ],
          [
            'post',
            '/api/v1/sections',
            {
              branchId: ids[me].branch,
              academicYearId: v.year,
              gradeId: ids[me].grade,
              name: 'L',
              code: 'L',
            },
          ],
          [
            'post',
            '/api/v1/sections',
            {
              branchId: ids[me].branch,
              academicYearId: ids[me].year,
              gradeId: v.grade,
              name: 'L',
              code: 'L',
            },
          ],
          ['put', `/api/v1/grades/${ids[me].grade}/subjects/${v.subject}`, {}],
          [
            'put',
            '/api/v1/sections/order',
            { branchId: v.branch, academicYearId: v.year, gradeId: v.grade, ids: [v.section] },
          ],
          ['put', '/api/v1/grades/order', { ids: [v.grade] }],
        ];
        for (const [method, path, body] of probes) {
          const req = api(me)[method as 'get' | 'post' | 'put' | 'patch'](path);
          const res = body ? await req.send(body) : await req;
          expect([400, 404], `${me}→${victim} ${method} ${path}`).toContain(res.status);
          expect(JSON.stringify(res.body)).not.toContain(`Secret`);
          expect(JSON.stringify(res.body)).not.toContain(t[victim].key);
        }
        // A's token presented at B's host is rejected before any handler.
        const mismatch = await call(app, { host: t[victim].domain, token: token[me] }).get(
          '/api/v1/branches',
        );
        expect(mismatch.status).toBe(403);
        // Lists never include the victim's rows.
        for (const path of [
          '/api/v1/branches',
          '/api/v1/academic-years',
          '/api/v1/grades',
          '/api/v1/sections',
          '/api/v1/subjects',
        ]) {
          expect(JSON.stringify((await api(me).get(path).expect(200)).body)).not.toContain(
            `Secret`.concat(` Branch ${victim}`),
          );
        }
      }
      // Nothing of the victims changed.
      for (const l of FIXTURE_LETTERS) {
        const b = await prisma.branch.findUniqueOrThrow({ where: { id: ids[l].branch } });
        expect(b.name).toBe(`Secret Branch ${l}`);
        expect(b.isActive).toBe(true);
        const y = await prisma.academicYear.findUniqueOrThrow({ where: { id: ids[l].year } });
        expect(y.status).toBe('PLANNED');
        expect(await prisma.gradeSubject.count({ where: { subjectId: ids[l].subject } })).toBe(0);
      }
    });
  });

  // ---- Concurrency --------------------------------------------------------------------------
  describe('concurrency', () => {
    it('keeps exactly one primary branch and one current year under concurrent switches', async () => {
      const branches = await prisma.branch.findMany({
        where: { schoolId: schoolId.A, isActive: true },
        select: { id: true },
      });
      expect(branches.length).toBeGreaterThanOrEqual(2);
      await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          api('A')
            .post(`/api/v1/branches/${branches[i % 2]?.id ?? ''}/set-primary`)
            .expect(200),
        ),
      );
      expect(await prisma.branch.count({ where: { schoolId: schoolId.A, isPrimary: true } })).toBe(
        1,
      );

      const ya = await year('B', 'CC-1', '2040-04-01', '2041-03-31');
      const yb = await year('B', 'CC-2', '2041-04-01', '2042-03-31');
      for (const y of [ya, yb])
        await api('B').post(`/api/v1/academic-years/${y.id}/activate`).expect(200);
      await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          api('B')
            .post(`/api/v1/academic-years/${(i % 2 ? ya : yb).id}/set-current`)
            .expect(200),
        ),
      );
      expect(
        await prisma.academicYear.count({ where: { schoolId: schoolId.B, isCurrent: true } }),
      ).toBe(1);
    });

    it('serialises concurrent creates (distinct display orders, one winner per code)', async () => {
      const created = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          api('C')
            .post('/api/v1/grades')
            .send({ name: `Par ${String(i)}`, code: `PAR${String(i)}` }),
        ),
      );
      expect(created.every((r) => r.status === 201)).toBe(true);
      const orders = (await prisma.grade.findMany({ where: { schoolId: schoolId.C } })).map(
        (g) => g.displayOrder,
      );
      expect(new Set(orders).size).toBe(orders.length);
      const same = await Promise.all(
        Array.from({ length: 6 }, () =>
          api('C').post('/api/v1/subjects').send({ name: 'Race', code: 'RACE' }),
        ),
      );
      expect(same.filter((r) => r.status === 201)).toHaveLength(1);
      expect(same.filter((r) => r.status === 409)).toHaveLength(5);
    });

    it('keeps tenants isolated under mixed concurrent traffic', async () => {
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) => {
          const l = FIXTURE_LETTERS[i % 3] as FixtureLetter;
          return i % 2
            ? api(l)
                .get('/api/v1/school')
                .then((r) => ({ l, id: (r.body as School).id }))
            : api(l)
                .post('/api/v1/subjects')
                .send({ name: `Mix ${String(i)}`, code: `MIX${String(i)}` })
                .then((r) => ({ l, id: (r.body as Subject).schoolId }));
        }),
      );
      for (const r of results) expect(r.id).toBe(schoolId[r.l]);
    });
  });

  // ---- Audit --------------------------------------------------------------------------------
  describe('audit', () => {
    it('records Phase 4 mutations with the real actor, tenant, request id and changed fields', async () => {
      const rows = await prisma.auditLog.findMany({
        where: {
          tenantId: t.A.id,
          resourceType: {
            in: [
              'school',
              'branch',
              'academic_year',
              'grade',
              'section',
              'subject',
              'grade_subject',
            ],
          },
        },
      });
      const actions = new Set(rows.map((r) => r.action));
      for (const action of [
        'SCHOOL_UPDATED',
        'ACADEMIC_CONFIGURATION_UPDATED',
        'BRANCH_CREATED',
        'BRANCH_UPDATED',
        'BRANCH_DEACTIVATED',
        'BRANCH_ACTIVATED',
        'PRIMARY_BRANCH_CHANGED',
        'ACADEMIC_YEAR_CREATED',
        'ACADEMIC_YEAR_UPDATED',
        'ACADEMIC_YEAR_ACTIVATED',
        'ACADEMIC_YEAR_SET_CURRENT',
        'ACADEMIC_YEAR_CLOSED',
        'GRADE_CREATED',
        'SUBJECT_CREATED',
        'SUBJECT_DEACTIVATED',
        'GRADE_SUBJECT_ASSIGNED',
        'GRADE_SUBJECT_UPDATED',
        'GRADE_SUBJECT_REMOVED',
      ]) {
        expect(actions.has(action), action).toBe(true);
      }
      const update = rows.find(
        (r) => r.action === 'SCHOOL_UPDATED' && r.actorUserId === userId.principal,
      );
      expect(update).toBeDefined();
      expect(update?.actorLabel).toBe(`user:${userId.principal}`);
      expect(update?.requestId).toBeTruthy();
      expect(update?.changedFields.length).toBeGreaterThan(0);
      expect(rows.some((r) => r.actorUserId === userId.admin)).toBe(true);
      expect(
        rows.every(
          (r) => r.actorLabel !== 'unauthenticated-platform-dev' && r.actorUserId !== null,
        ),
      ).toBe(true);
      // Tenants B/C see their own events (reorder, sections) — never A's.
      const b = await prisma.auditLog.findMany({
        where: { tenantId: t.B.id, action: { in: ['GRADE_REORDERED', 'GRADE_DEACTIVATED'] } },
      });
      expect(b.map((r) => r.action).sort()).toEqual(['GRADE_DEACTIVATED', 'GRADE_REORDERED']);
      const c = await prisma.auditLog.findMany({
        where: { tenantId: t.C.id, action: { startsWith: 'SECTION_' } },
      });
      expect(new Set(c.map((r) => r.action))).toEqual(
        new Set(['SECTION_CREATED', 'SECTION_UPDATED', 'SECTION_REORDERED', 'SECTION_DEACTIVATED']),
      );
      // Rejected mutations leave no audit row (audit written after commit only).
      expect(
        rows.filter(
          (r) => r.action === 'BRANCH_CREATED' && JSON.stringify(r.metadata).includes('"TZ"'),
        ),
      ).toHaveLength(0);
    });
  });
});
