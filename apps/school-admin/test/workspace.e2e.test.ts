/**
 * Phase 6 School Admin workspace through the real app (server-rendered pages + BFF):
 * permission-driven navigation, dashboard with real counts and academic context (URL + cookie),
 * classes/rosters, global search, login-access list, record-vs-school 404 copy, teacher scope
 * (assigned sections only), parent/student denial and cross-school isolation.
 */
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAcademic,
  createSchool,
  createUser,
  db,
  Jar,
  purge,
  request,
  resetRateLimits,
  totp,
} from './helpers';

const PREFIX = 'SAWSP';
const A = 'sawsp-a.localhost';
const B = 'sawsp-b.localhost';
const PW = 'Workspace-admin-pass-1';
const origin = (host: string) => `http://${host}:4002`;

async function signIn(host: string, email: string): Promise<Jar> {
  const jar = new Jar();
  const csrf = { origin: origin(host), 'x-acadlyx-csrf': '1' };
  const login = await request('POST', '/bff/auth/login', {
    host,
    headers: csrf,
    body: { identifier: email, secret: PW },
  });
  expect(login.status, login.body).toBe(200);
  jar.apply(login.setCookies);
  if ((JSON.parse(login.body) as { status: string }).status === 'MFA_ENROLLMENT_REQUIRED') {
    const start = await request('POST', '/bff/auth/enroll/start', {
      host,
      headers: { ...csrf, cookie: jar.header() },
    });
    const { secret } = JSON.parse(start.body) as { secret: string };
    const confirm = await request('POST', '/bff/auth/enroll/confirm', {
      host,
      headers: { ...csrf, cookie: jar.header() },
      body: { code: totp(secret) },
    });
    expect(confirm.status, confirm.body).toBe(200);
    jar.apply(confirm.setCookies);
  }
  return jar;
}

describe('School Admin — workspace (Phase 6)', () => {
  let client: pg.Client;
  let admin: Jar;
  let teacher: Jar;
  let parent: Jar;
  let otherAdmin: Jar;
  let ac: Awaited<ReturnType<typeof createAcademic>>;
  let acB: Awaited<ReturnType<typeof createAcademic>>;
  let tenantA = '';
  const ids = { s1: '', s2: '', s3: '' };

  const page = (jar: Jar, path: string, host = A, extraCookie = '') =>
    request('GET', path, {
      host,
      headers: { cookie: [jar.header(), extraCookie].filter(Boolean).join('; ') },
    });
  const api = async (jar: Jar, path: string, host = A) => {
    const r = await request('GET', `/bff/api/${path}`, { host, headers: { cookie: jar.header() } });
    return {
      status: r.status,
      json: (r.body ? JSON.parse(r.body) : {}) as Record<string, unknown>,
    };
  };

  beforeAll(async () => {
    client = db();
    await client.connect();
    await purge(client, PREFIX);
    tenantA = await createSchool(client, {
      key: `${PREFIX}_A`,
      status: 'ACTIVE',
      domain: A,
      name: 'Workspace School A',
    });
    const b = await createSchool(client, {
      key: `${PREFIX}_B`,
      status: 'ACTIVE',
      domain: B,
      name: 'Workspace School B',
    });
    ac = await createAcademic(client, tenantA);
    acB = await createAcademic(client, b);
    await createUser(client, {
      tenantId: tenantA,
      name: 'Wanda Admin',
      email: 'admin@sawsp-a.test',
      password: PW,
      role: 'SCHOOL_ADMIN',
    });
    const teacherUser = await createUser(client, {
      tenantId: tenantA,
      name: 'Tariq Teacher',
      email: 'teacher@sawsp-a.test',
      password: PW,
      role: 'TEACHER',
    });
    await createUser(client, {
      tenantId: tenantA,
      name: 'Pari Parent',
      email: 'parent@sawsp-a.test',
      password: PW,
      role: 'PARENT',
    });
    await createUser(client, {
      tenantId: b,
      name: 'Bo Admin',
      email: 'admin@sawsp-b.test',
      password: PW,
      role: 'SCHOOL_ADMIN',
    });

    const q = async (sql: string, params: unknown[]) =>
      (await client.query<{ id: string }>(sql, params)).rows[0]?.id ?? '';
    const student = (tenant: string, school: string, adm: string, first: string) =>
      q(
        "INSERT INTO students (id, tenant_id, school_id, admission_number, first_name, last_name, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'Rollcall', now()) RETURNING id",
        [tenant, school, adm, first],
      );
    const enroll = (
      tenant: string,
      school: string,
      studentId: string,
      sectionId: string,
      yearId: string,
    ) =>
      client.query(
        "INSERT INTO student_enrollments (id, tenant_id, school_id, student_id, section_id, academic_year_id, start_date, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, '2026-04-01', now())",
        [tenant, school, studentId, sectionId, yearId],
      );
    ids.s1 = await student(tenantA, ac.schoolId, 'WSA-1', 'Anika');
    ids.s2 = await student(tenantA, ac.schoolId, 'WSA-2', 'Bilal');
    ids.s3 = await student(tenantA, ac.schoolId, 'WSA-3', 'Chitra');
    await enroll(tenantA, ac.schoolId, ids.s1, ac.sectionA, ac.yearId);
    await enroll(tenantA, ac.schoolId, ids.s2, ac.sectionB, ac.yearId);
    const parentId = await q(
      "INSERT INTO parents (id, tenant_id, school_id, parent_code, first_name, last_name, phone, updated_at) VALUES (gen_random_uuid(), $1, $2, 'WSA-P1', 'Gita', 'Rollcall', '+919877700001', now()) RETURNING id",
      [tenantA, ac.schoolId],
    );
    await client.query(
      "INSERT INTO student_guardians (id, tenant_id, school_id, student_id, parent_id, relationship, is_primary, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'MOTHER', true, now())",
      [tenantA, ac.schoolId, ids.s1, parentId],
    );
    const teacherId = await q(
      "INSERT INTO teachers (id, tenant_id, school_id, user_id, employee_id, first_name, last_name, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 'WSA-T1', 'Tariq', 'Teacher', now()) RETURNING id",
      [tenantA, ac.schoolId, teacherUser],
    );
    await client.query(
      "INSERT INTO teacher_assignments (id, tenant_id, school_id, teacher_id, section_id, type, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'CLASS_TEACHER', now())",
      [tenantA, ac.schoolId, teacherId, ac.sectionA],
    );
    const sb = await student(b, acB.schoolId, 'WSB-1', 'Zubin');
    await enroll(b, acB.schoolId, sb, acB.sectionA, acB.yearId);

    await resetRateLimits();
    admin = await signIn(A, 'admin@sawsp-a.test');
    teacher = await signIn(A, 'teacher@sawsp-a.test');
    parent = await signIn(A, 'parent@sawsp-a.test');
    otherAdmin = await signIn(B, 'admin@sawsp-b.test');
  }, 60_000);

  beforeEach(resetRateLimits);

  afterAll(async () => {
    await purge(client, PREFIX);
    await client.end();
  });

  it('navigation follows permissions (admin, teacher, parent)', async () => {
    const nav = (html: string) =>
      html.slice(html.indexOf('data-testid="side-nav"'), html.indexOf('id="workspace-main"'));
    const a = nav((await page(admin, '/')).body);
    for (const label of [
      'Dashboard',
      'Students',
      'Parents / guardians',
      'Teachers',
      'Login access',
      'Bulk import',
      'Classes',
      'School profile',
      'Security &amp; sessions',
    ])
      expect(a, label).toContain(label);
    const t = nav((await page(teacher, '/')).body);
    expect(t).toContain('Classes');
    expect(t).toContain('Students');
    expect(t).not.toContain('Login access');
    expect(t).not.toContain('Bulk import');
    const p = nav((await page(parent, '/')).body);
    expect(p).not.toMatch(/Students|Classes|Teachers|Bulk import|School profile/);
    expect(p).toContain('Security');
  });

  it('dashboard shows real counts; context comes from URL, then the session cookie; foreign ids are ignored', async () => {
    const html = (await page(admin, '/')).body;
    expect(html).toContain('data-testid="dashboard"');
    expect(html).toContain('data-testid="context-bar"');
    expect(html).toMatch(/Showing <strong>2026–27 · All branches<\/strong>/);
    for (const id of [
      'people-summary',
      'dashboard-accounts',
      'dashboard-quality',
      'dashboard-imports',
    ])
      expect(html, id).toContain(`data-testid="${id}"`);
    // No cards for modules that do not exist yet (Phase 7 made homework/attendance real;
    // Phase 9 made exams/results real — they appear in the Academics menu, not as cards).
    expect(html).not.toMatch(/Fees|Report card/);
    const dash = await api(admin, 'workspace/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.json).toMatchObject({
      students: { byStatus: { ACTIVE: 3 }, enrolled: 2 },
      dataQuality: { activeStudentsWithoutEnrollment: 1, activeStudentsWithoutGuardian: 2 },
    });
    // Branch via URL → shown; another school's ids in URL or cookie never apply.
    expect((await page(admin, `/?branch=${ac.branchId}`)).body).toMatch(
      /Showing <strong>2026–27 · Main Campus<\/strong>/,
    );
    expect((await page(admin, `/?year=${acB.yearId}&branch=${acB.branchId}`)).body).toMatch(
      /Showing <strong>2026–27 · All branches<\/strong>/,
    );
    expect((await page(admin, '/', A, `acx_ctx=.${ac.branchId}`)).body).toMatch(
      /· Main Campus<\/strong>/,
    );
    expect((await page(admin, '/', A, `acx_ctx=${acB.yearId}.${acB.branchId}`)).body).toMatch(
      /· All branches<\/strong>/,
    );
    expect((await page(admin, '/', A, 'acx_ctx=%3Cscript%3E')).status).toBe(200);
    // Teachers get no school-wide people blocks.
    const t = (await page(teacher, '/')).body;
    expect(t).not.toContain('data-testid="people-summary"');
    expect(t).not.toContain('data-testid="dashboard-accounts"');
  });

  it('recent activity: humanised feed for leadership only; never another school', async () => {
    // A harmless supported mutation through the BFF → appears in the feed.
    const csrf = { origin: origin(A), 'x-acadlyx-csrf': '1', cookie: admin.header() };
    const made = await request('POST', '/bff/api/teachers', {
      host: A,
      headers: csrf,
      body: { employeeId: 'WSA-T9', firstName: 'Feedy', lastName: 'Teacher' },
    });
    expect(made.status, made.body).toBe(201);
    const html = (await page(admin, '/')).body;
    expect(html).toContain('data-testid="dashboard-activity"');
    expect(html).toContain('Teacher profile created');
    expect(html).toContain('Feedy Teacher');
    expect(html).not.toMatch(/ipAddress|userAgent|importJobId/);
    expect((await page(teacher, '/')).body).not.toContain('data-testid="dashboard-activity"');
    expect((await api(teacher, 'workspace/dashboard')).json).not.toHaveProperty('activity');
    const b = (await page(otherAdmin, '/', B)).body;
    expect(b).toContain('data-testid="dashboard-activity"');
    expect(b).not.toContain('Feedy');
  });

  it('classes list and roster: section-based, real counts, teacher/subject blocks', async () => {
    const list = (await page(admin, '/classes')).body;
    expect(list).toContain('data-testid="classes-table"');
    expect(list).toContain('Grade 5 A');
    expect(list).toContain('Grade 5 B');
    const roster = (await page(admin, `/classes/${ac.sectionA}`)).body;
    expect(roster).toContain('data-testid="roster-table"');
    expect(roster).toContain('WSA-1');
    expect(roster).toContain('Gita Rollcall (Mother)');
    expect(roster).not.toContain('WSA-2');
    expect(roster).toContain('Class teacher');
    expect(roster).toContain('data-testid="class-subjects"');
    expect(roster).not.toContain('+919877700001');
    expect(roster).toMatch(/Academics.*Classes.*Grade 5 A/s);
  });

  it('teacher sees only the class they teach — at page and API level', async () => {
    const list = (await page(teacher, '/classes')).body;
    expect(list).toContain('Grade 5 A');
    expect(list).not.toContain('Grade 5 B');
    expect((await page(teacher, `/classes/${ac.sectionA}`)).status).toBe(200);
    const other = await page(teacher, `/classes/${ac.sectionB}`);
    expect(other.status).toBe(404);
    expect(other.body).toContain('Record not found');
    const students = (await page(teacher, '/people/students')).body;
    expect(students).toContain('WSA-1');
    expect(students).not.toContain('WSA-2');
    expect((await page(teacher, `/people/students/${ids.s2}`)).status).toBe(404);
    expect((await api(teacher, `students/${ids.s2}`)).status).toBe(404);
    const search = await api(teacher, 'workspace/search?q=rollcall');
    expect((search.json.students as { id: string }[]).map((s) => s.id)).toEqual([ids.s1]);
  });

  it('global search: grouped, minimal fields, bounded, tenant-safe', async () => {
    const r = await api(admin, 'workspace/search?q=rollcall');
    expect(r.status).toBe(200);
    expect((r.json.students as unknown[]).length).toBe(3);
    expect((r.json.parents as { parentCode: string }[])[0]?.parentCode).toBe('WSA-P1');
    expect(JSON.stringify(r.json)).not.toMatch(/\+91|email|phone|dateOfBirth/);
    expect((await api(admin, 'workspace/search?q=r')).status).toBe(400);
    expect((await api(admin, `workspace/search?q=${'y'.repeat(65)}`)).status).toBe(400);
    const b = await api(otherAdmin, 'workspace/search?q=rollcall', B);
    expect(JSON.stringify(b.json)).not.toMatch(/Anika|Bilal|Chitra|WSA-/);
    expect((await api(parent, 'workspace/search?q=rollcall')).json).toEqual({ query: 'rollcall' });
    expect((await api(admin, 'workspace/unknown')).status).toBe(404);
  });

  it('login access list and people filters render for leadership; denied to others', async () => {
    const html = (await page(admin, '/people/access?kind=students&state=NONE')).body;
    expect(html).toContain('data-testid="access-table"');
    expect(html).toContain('WSA-3');
    expect((await page(teacher, '/people/access')).body).toContain('data-testid="no-access"');
    expect((await api(teacher, 'workspace/access?kind=students')).status).toBe(403);
    const review = (await page(admin, '/people/students?quality=NO_GUARDIAN')).body;
    expect(review).toContain('WSA-2');
    expect(review).not.toContain('WSA-1');
  });

  it('404 copy: missing record vs unknown school; parent denied management screens', async () => {
    const missing = await page(admin, '/people/students/00000000-0000-4000-8000-000000000000');
    expect(missing.status).toBe(404);
    // A notFound() raised mid-stream is delivered in Next's flight payload (rendered client-side);
    // the People segment boundary ("Record not found") is what it carries for a known school.
    expect(missing.body).toContain('data-testid\\":\\"record-not-found\\"');
    expect(missing.body).toContain('Record not found');
    const unknownHost = await request('GET', '/', { host: 'no-such-school.localhost' });
    expect(unknownHost.status).toBe(404);
    expect(unknownHost.body).toContain('School not found');
    expect(unknownHost.body).toContain('tenant-problem');
    expect(unknownHost.body).not.toContain('Record not found');
    for (const path of ['/classes', '/people/students', '/people/access'])
      expect((await page(parent, path)).body, path).toContain('data-testid="no-access"');
  });

  it('school B never shows school A data (dashboard, lists, classes, search)', async () => {
    for (const path of [
      '/',
      '/people/students',
      '/people/parents',
      '/people/teachers',
      '/classes',
      '/people/imports',
    ]) {
      const html = (await page(otherAdmin, path, B)).body;
      expect(html, path).not.toMatch(/Anika|Bilal|Chitra|WSA-|Gita/);
    }
    expect((await page(otherAdmin, `/classes/${ac.sectionA}`, B)).status).toBe(404);
    expect((await page(admin, `/classes/${ac.sectionA}`, B)).body).not.toContain('WSA-1');
  });
});
