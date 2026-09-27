/**
 * Phase 4 School Setup through the real School Admin (BFF + server-rendered pages): a School
 * Admin signs in (forced TOTP enrolment), configures profile, branch, academic year, grade,
 * section, subject and grade–subject mapping via the CSRF-protected BFF proxy, and every change
 * is visible on a fresh server render (= persisted). Also role gating and cross-school isolation.
 */
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createSchool,
  createUser,
  db,
  Jar,
  purge,
  request,
  resetRateLimits,
  totp,
} from './helpers';

const PREFIX = 'SASET';
const A = 'saset-a.localhost';
const B = 'saset-b.localhost';
const PW = 'Setup-admin-pass-1';
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
  const status = (JSON.parse(login.body) as { status: string }).status;
  if (status === 'MFA_ENROLLMENT_REQUIRED') {
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

describe('School Admin — School Setup (Phase 4)', () => {
  let client: pg.Client;
  let admin: Jar;
  let teacher: Jar;
  let otherTeacher: Jar;

  const api = async (jar: Jar, method: string, path: string, body?: unknown, host = A) => {
    const res = await request(method, `/bff/api/${path}`, {
      host,
      headers: { origin: origin(host), 'x-acadlyx-csrf': '1', cookie: jar.header() },
      ...(body === undefined ? {} : { body }),
    });
    return {
      status: res.status,
      json: res.body ? (JSON.parse(res.body) as Record<string, unknown>) : {},
    };
  };
  const page = (jar: Jar, path: string, host = A) =>
    request('GET', path, { host, headers: { cookie: jar.header() } });

  beforeAll(async () => {
    client = db();
    await client.connect();
    await purge(client, PREFIX);
    const a = await createSchool(client, {
      key: `${PREFIX}_A`,
      status: 'ACTIVE',
      domain: A,
      name: 'Setup School A',
    });
    const b = await createSchool(client, {
      key: `${PREFIX}_B`,
      status: 'ACTIVE',
      domain: B,
      name: 'Setup School B',
    });
    await createUser(client, {
      tenantId: a,
      name: 'Sam Admin',
      email: 'admin@saset-a.test',
      password: PW,
      role: 'SCHOOL_ADMIN',
    });
    await createUser(client, {
      tenantId: a,
      name: 'Tara Teacher',
      email: 'teacher@saset-a.test',
      password: PW,
      role: 'TEACHER',
    });
    await createUser(client, {
      tenantId: b,
      name: 'Omar Teacher',
      email: 'teacher@saset-b.test',
      password: PW,
      role: 'TEACHER',
    });
    await resetRateLimits();
    admin = await signIn(A, 'admin@saset-a.test');
    teacher = await signIn(A, 'teacher@saset-a.test');
    otherTeacher = await signIn(B, 'teacher@saset-b.test');
  }, 60_000);

  beforeEach(resetRateLimits);

  afterAll(async () => {
    await purge(client, PREFIX);
    await client.end();
  });

  it('requires a session: signed-out users are sent to the branded sign-in', async () => {
    const res = await request('GET', '/settings/branches', { host: A });
    expect([303, 307, 308]).toContain(res.status);
    expect(res.headers.location).toMatch(/\/$/);
    // Tenant semantics still apply first: unknown school → 404.
    expect(
      (await request('GET', '/settings/branches', { host: 'saset-nope.localhost' })).status,
    ).toBe(404);
  });

  it('configures the whole school structure and every change persists (fresh server render)', async () => {
    // School profile
    let r = await api(admin, 'PATCH', 'school', {
      name: "St. Anne's Setup School",
      code: 'set-a',
      board: 'CBSE',
      email: 'office@saset-a.test',
    });
    expect(r.status).toBe(200);
    let html = (await page(admin, '/settings/school')).body;
    expect(html).toContain('St. Anne&#x27;s Setup School');
    expect(html).toContain('SET-A');
    // CSRF: a mutation without the header is refused.
    const noCsrf = await request('PATCH', '/bff/api/school', {
      host: A,
      headers: { origin: origin(A), cookie: admin.header() },
      body: { shortName: 'x' },
    });
    expect(noCsrf.status).toBe(403);

    // Branch (first → primary)
    r = await api(admin, 'POST', 'branches', {
      name: 'Main Campus',
      code: 'main',
      city: 'Lakeview',
      timezone: 'Asia/Kolkata',
    });
    expect(r.status).toBe(201);
    const branchId = String(r.json.id);
    html = (await page(admin, '/settings/branches')).body;
    expect(html).toContain('Main Campus');
    expect(html).toContain('Primary');

    // Academic year: create → activate → current
    r = await api(admin, 'POST', 'academic-years', {
      name: '2026–27',
      startDate: '2026-04-01',
      endDate: '2027-03-31',
    });
    expect(r.status).toBe(201);
    const yearId = String(r.json.id);
    expect((await api(admin, 'POST', `academic-years/${yearId}/activate`)).status).toBe(200);
    expect((await api(admin, 'POST', `academic-years/${yearId}/set-current`)).status).toBe(200);
    html = (await page(admin, '/settings/academic-years')).body;
    expect(html).toContain('2026–27');
    expect(html).toContain('Current');

    // Grade + section
    r = await api(admin, 'POST', 'grades', { name: 'Grade 1', code: 'G1' });
    const gradeId = String(r.json.id);
    r = await api(admin, 'POST', 'sections', {
      branchId,
      academicYearId: yearId,
      gradeId,
      name: 'Rose',
      code: 'ROSE',
      capacity: 35,
    });
    expect(r.status).toBe(201);
    html = (await page(admin, `/settings/grades?branch=${branchId}&year=${yearId}`)).body;
    expect(html).toContain('Grade 1');
    expect(html).toContain('Rose');
    expect(html).toContain('capacity 35');

    // Subject + grade mapping (search through the proxy keeps the query string)
    r = await api(admin, 'POST', 'subjects', { name: 'English', code: 'ENG' });
    const subjectId = String(r.json.id);
    expect(
      (await api(admin, 'PUT', `grades/${gradeId}/subjects/${subjectId}`, { isRequired: true }))
        .status,
    ).toBe(200);
    const search = await api(admin, 'GET', 'subjects?q=engl');
    expect(
      Array.isArray(search.json) &&
        (search.json as unknown as { code: string }[]).map((s) => s.code),
    ).toEqual(['ENG']);
    html = (await page(admin, `/settings/subjects?grade=${gradeId}`)).body;
    expect(html).toContain('data-testid="grade-subjects"');
    expect(html).toContain('English');

    // Academic settings
    expect(
      (
        await api(admin, 'PATCH', 'school/academic-settings', {
          workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
        })
      ).status,
    ).toBe(200);
    html = (await page(admin, '/settings/academic')).body;
    expect(html).toContain('Working days');

    // Dashboard summary reflects real counts.
    html = (await page(admin, '/')).body;
    expect(html).toContain('data-testid="setup-summary"');
    expect(html).toContain('2026–27');

    // Friendly, safe errors (duplicate code) — no database text.
    r = await api(admin, 'POST', 'branches', { name: 'Again', code: 'MAIN' });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'DUPLICATE_BRANCH_CODE' });
    expect(JSON.stringify(r.json)).not.toMatch(/constraint|prisma|sql/i);
  });

  it('teachers read the structure but cannot manage it; the UI shows no edit controls', async () => {
    const html = (await page(teacher, '/settings/school')).body;
    expect(html).toContain('Profile (read-only)');
    expect(html).not.toContain('Save profile');
    expect((await page(teacher, '/settings/academic')).body).toContain('data-testid="no-access"');
    expect((await page(teacher, '/settings/branches')).body).not.toContain('Add a branch');
    expect((await api(teacher, 'POST', 'grades', { name: 'X', code: 'X' })).status).toBe(403);
    expect((await api(teacher, 'PATCH', 'school', { shortName: 'x' })).status).toBe(403);
  });

  it('another school sees none of this school’s data, and the proxy allow-list still holds', async () => {
    const html = (await page(otherTeacher, '/settings/branches', B)).body;
    expect(html).toContain('No branches yet');
    expect(html).not.toContain('Main Campus');
    const cross = await page(admin, '/settings/branches', B); // A's cookies on B's host
    expect(cross.body).not.toContain('Main Campus');
    expect((await api(admin, 'GET', 'platform/tenants')).status).toBe(404);
  });
});
