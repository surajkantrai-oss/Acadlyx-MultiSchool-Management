/**
 * Phase 5 People through the real School Admin (BFF + server-rendered pages): a School Admin
 * creates a student with placement, a parent, links the guardian, creates a teacher and assigns
 * them, searches, and runs a bulk import (multipart upload → preview → confirm → completion).
 * Also role gating (Teacher read-only, Parent none) and cross-school isolation.
 */
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAcademic,
  createSchool,
  createUser,
  db,
  Jar,
  multipart,
  purge,
  request,
  resetRateLimits,
  totp,
} from './helpers';

const PREFIX = 'SAPPL';
const A = 'sappl-a.localhost';
const B = 'sappl-b.localhost';
const PW = 'People-admin-pass-1';
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

describe('School Admin — People (Phase 5)', () => {
  let client: pg.Client;
  let admin: Jar;
  let teacher: Jar;
  let parent: Jar;
  let other: Jar;
  let ac: { sectionA: string; sectionB: string; mathId: string };

  const api = async (jar: Jar, method: string, path: string, body?: unknown, host = A) => {
    const res = await request(method, `/bff/api/${path}`, {
      host,
      headers: { origin: origin(host), 'x-acadlyx-csrf': '1', cookie: jar.header() },
      ...(body === undefined ? {} : { body }),
    });
    return {
      status: res.status,
      json: (res.body ? JSON.parse(res.body) : {}) as Record<string, unknown>,
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
      name: 'People School A',
    });
    const b = await createSchool(client, {
      key: `${PREFIX}_B`,
      status: 'ACTIVE',
      domain: B,
      name: 'People School B',
    });
    ac = await createAcademic(client, a);
    await createAcademic(client, b);
    await createUser(client, {
      tenantId: a,
      name: 'Pia Admin',
      email: 'admin@sappl-a.test',
      password: PW,
      role: 'SCHOOL_ADMIN',
    });
    await createUser(client, {
      tenantId: a,
      name: 'Tom Teacher',
      email: 'teacher@sappl-a.test',
      password: PW,
      role: 'TEACHER',
    });
    await createUser(client, {
      tenantId: a,
      name: 'Pat Parent',
      email: 'parent@sappl-a.test',
      password: PW,
      role: 'PARENT',
    });
    await createUser(client, {
      tenantId: b,
      name: 'Bea Admin',
      email: 'admin@sappl-b.test',
      password: PW,
      role: 'TEACHER',
    });
    await resetRateLimits();
    admin = await signIn(A, 'admin@sappl-a.test');
    teacher = await signIn(A, 'teacher@sappl-a.test');
    parent = await signIn(A, 'parent@sappl-a.test');
    other = await signIn(B, 'admin@sappl-b.test');
  }, 60_000);

  beforeEach(resetRateLimits);

  afterAll(async () => {
    await purge(client, PREFIX);
    await client.end();
  });

  it('student → enrollment → parent → guardian → teacher → assignment → search; all persisted', async () => {
    let r = await api(admin, 'POST', 'students', {
      admissionNumber: 'sa-001',
      firstName: 'Aarav',
      lastName: "D'Souza",
      dateOfBirth: '2016-05-01',
      enrollment: { sectionId: ac.sectionA },
    });
    expect(r.status).toBe(201);
    const studentId = String(r.json.id);
    r = await api(admin, 'POST', 'parents', {
      parentCode: 'par-9',
      firstName: 'Meera',
      lastName: "D'Souza",
      phone: '98111 22333',
    });
    expect(r.status).toBe(201);
    const parentId = String(r.json.id);
    expect(
      (
        await api(admin, 'POST', `students/${studentId}/guardians`, {
          parentId,
          relationship: 'MOTHER',
          isPrimary: true,
          pickupAuthorized: true,
        })
      ).status,
    ).toBe(201);
    r = await api(admin, 'POST', 'teachers', {
      employeeId: 'emp-9',
      firstName: 'Ravi',
      email: 'ravi@sappl-a.test',
    });
    const teacherId = String(r.json.id);
    expect(
      (
        await api(admin, 'POST', `teachers/${teacherId}/assignments`, {
          type: 'SUBJECT_TEACHER',
          sectionId: ac.sectionA,
          subjectId: ac.mathId,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await api(admin, 'POST', `teachers/${teacherId}/assignments`, {
          type: 'CLASS_TEACHER',
          sectionId: ac.sectionA,
        })
      ).status,
    ).toBe(201);

    // Fresh server renders show everything.
    let html = (await page(admin, `/people/students/${studentId}`)).body;
    expect(html).toContain('SA-001');
    expect(html).toContain('Grade 5 A · Main Campus');
    expect(html).toContain('Meera');
    expect(html).toContain('Primary');
    html = (await page(admin, '/people/students?q=aarav')).body;
    expect(html).toContain('data-testid="students-table"');
    expect(html).toContain('Aarav');
    html = (await page(admin, `/people/students?sectionId=${ac.sectionB}`)).body;
    expect(html).not.toContain('Aarav');
    html = (await page(admin, `/people/parents/${parentId}`)).body;
    expect(html).toContain('PAR-9');
    expect(html).toContain('+919811122333');
    expect(html).toContain('SA-001');
    html = (await page(admin, `/people/teachers/${teacherId}`)).body;
    expect(html).toContain('2026–27 · Main Campus · Grade 5 A');
    expect(html).toContain('Mathematics');
    expect(html).toContain('Class teacher');
    html = (await page(admin, '/')).body;
    expect(html).toContain('data-testid="people-summary"');
    expect(html).not.toMatch(/Student, attendance and other module screens/);

    // Account creation from the profile: PENDING, code shown once, no password.
    r = await api(admin, 'POST', `students/${studentId}/account`);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({
      account: { status: 'PENDING_ACTIVATION' },
      activation: { method: 'CODE' },
    });
    expect((await page(admin, `/people/students/${studentId}`)).body).toContain(
      'Pending activation',
    );

    // Safe errors.
    r = await api(admin, 'POST', 'students', { admissionNumber: 'SA-001', firstName: 'Dup' });
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.json)).not.toMatch(/constraint|prisma|sql/i);
    // CSRF on mutations.
    const noCsrf = await request('POST', '/bff/api/students', {
      host: A,
      headers: { origin: origin(A), cookie: admin.header() },
      body: { admissionNumber: 'X', firstName: 'x' },
    });
    expect(noCsrf.status).toBe(403);
  });

  it('bulk import: template download → upload → preview (nothing created) → confirm → completed', async () => {
    const tpl = await request('GET', '/bff/api/imports/templates/PARENTS/file?format=xlsx', {
      host: A,
      headers: { cookie: admin.header() },
    });
    expect(tpl.status).toBe(200);
    expect(tpl.headers['content-disposition']).toMatch(/acadlyx-parents-template-v1\.xlsx/);
    expect(tpl.bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true); // intact zip
    const csv = [
      'parent_code,first_name,middle_name,last_name,email,phone',
      'BP-1,Neha,,Rao,,9811100101',
      'BP-2,Karan,,Rao,,',
      'BP-2,Dup,,Row,,',
      ',,,Missing,,',
    ].join('\n');
    const form = multipart(
      { type: 'PARENTS' },
      { name: 'parents.csv', content: Buffer.from(csv), type: 'text/csv' },
    );
    const up = await request('POST', '/bff/api/imports', {
      host: A,
      raw: form.body,
      headers: {
        origin: origin(A),
        'x-acadlyx-csrf': '1',
        cookie: admin.header(),
        'content-type': form.contentType,
      },
    });
    expect(up.status, up.body).toBe(201);
    const job = JSON.parse(up.body) as {
      id: string;
      validRows: number;
      invalidRows: number;
      status: string;
    };
    expect(job).toMatchObject({ status: 'READY', validRows: 2, invalidRows: 2 });
    let html = (await page(admin, `/people/imports/${job.id}`)).body;
    expect(html).toContain('data-testid="import-summary"');
    expect(html).toContain('Row 4');
    expect(html).toContain('Confirm import of 2 valid rows');
    expect(
      (await client.query("SELECT count(*)::int AS n FROM parents WHERE parent_code LIKE 'BP-%'"))
        .rows[0],
    ).toEqual({ n: 0 });
    const report = await request('GET', `/bff/api/imports/${job.id}/errors.csv`, {
      host: A,
      headers: { cookie: admin.header() },
    });
    expect(report.body.split('\r\n')[0]).toBe('row_number,status,field,code,message');
    expect((await api(admin, 'POST', `imports/${job.id}/confirm`)).status).toBe(200);
    let status = '';
    for (let i = 0; i < 60 && status !== 'COMPLETED'; i += 1) {
      status = String((await api(admin, 'GET', `imports/${job.id}`)).json.status);
      if (status !== 'COMPLETED') await new Promise((r) => setTimeout(r, 250));
    }
    expect(status).toBe('COMPLETED');
    html = (await page(admin, '/people/parents?q=rao')).body;
    expect(html).toContain('BP-1');
    expect(html).toContain('BP-2');
    expect((await page(admin, '/people/imports')).body).toContain('2 imported, 0 failed');
  });

  it('teachers read people but cannot manage or import; parents see no people pages', async () => {
    // Phase 6 (approved decision A): a teacher with no assigned class sees no students at all.
    const html = (await page(teacher, '/people/students')).body;
    expect(html).not.toContain('data-testid="no-access"');
    expect(html).toContain('No students yet');
    expect(html).not.toContain('Aarav');
    expect(html).not.toContain('Add a student');
    expect((await page(teacher, '/people/imports')).body).toContain('data-testid="no-access"');
    expect(
      (await api(teacher, 'POST', 'students', { admissionNumber: 'T-1', firstName: 'x' })).status,
    ).toBe(403);
    for (const path of [
      '/people/students',
      '/people/parents',
      '/people/teachers',
      '/people/imports',
    ])
      expect((await page(parent, path)).body, path).toContain('data-testid="no-access"');
    expect((await api(parent, 'GET', 'students')).status).toBe(403);
    expect((await page(parent, '/')).body).not.toContain('data-testid="people-summary"');
  });

  it('another school sees none of this school’s people or imports', async () => {
    for (const path of ['/people/students', '/people/parents', '/people/teachers']) {
      const html = (await page(other, path, B)).body;
      expect(html, path).not.toMatch(/Aarav|Meera|Ravi|BP-1/);
    }
    const idRow = await client.query<{ id: string }>(
      "SELECT id FROM students WHERE admission_number = 'SA-001'",
    );
    expect(
      (await api(other, 'GET', `students/${idRow.rows[0]?.id ?? ''}`, undefined, B)).status,
    ).toBe(404);
    expect((await page(admin, '/people/students', B)).body).not.toContain('Aarav'); // A's cookies on B's host
  });
});
