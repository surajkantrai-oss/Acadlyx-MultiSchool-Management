/**
 * Phase 9 through the real School Admin app (pages + BFF): navigation, exam building, mark entry
 * and review, results publication, report cards, assignment grading, scope and isolation.
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

const PREFIX = 'SAEXM';
const A = 'saexm-a.localhost';
const B = 'saexm-b.localhost';
const PW = 'Exams-admin-pass-1';
const origin = (host: string) => `http://${host}:4002`;
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

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

describe('School Admin — exams, marks, results and grading (Phase 9)', () => {
  let client: pg.Client;
  let admin: Jar;
  let teacher: Jar;
  let parent: Jar;
  let otherAdmin: Jar;
  let ac: Awaited<ReturnType<typeof createAcademic>>;
  let tenantA = '';
  const ids = { s1: '', s2: '', gradeId: '', exam: '', examSubject: '', comp: '', assignment: '' };

  const page = (jar: Jar, path: string, host = A) =>
    request('GET', path, { host, headers: { cookie: jar.header() } });
  const api = async (jar: Jar, method: string, path: string, body?: unknown, host = A) => {
    const r = await request(method, `/bff/api/${path}`, {
      host,
      headers: { origin: origin(host), 'x-acadlyx-csrf': '1', cookie: jar.header() },
      ...(body === undefined ? {} : { body }),
    });
    return {
      status: r.status,
      json: (r.body ? JSON.parse(r.body) : {}) as Record<string, unknown> & { version?: number },
    };
  };
  const examVersion = async () =>
    Number((await api(admin, 'GET', `exams/${ids.exam}`)).json.version);
  const sheetPath = () => `exams/${ids.exam}/sheets/${ids.examSubject}/${ac.sectionA}`;

  beforeAll(async () => {
    client = db();
    await client.connect();
    await purge(client, PREFIX);
    tenantA = await createSchool(client, {
      key: `${PREFIX}_A`,
      status: 'ACTIVE',
      domain: A,
      name: 'Exam School A',
    });
    const b = await createSchool(client, {
      key: `${PREFIX}_B`,
      status: 'ACTIVE',
      domain: B,
      name: 'Exam School B',
    });
    ac = await createAcademic(client, tenantA);
    await createAcademic(client, b);
    await createUser(client, {
      tenantId: tenantA,
      name: 'Ada Admin',
      email: 'admin@saexm-a.test',
      password: PW,
      role: 'SCHOOL_ADMIN',
    });
    const teacherUser = await createUser(client, {
      tenantId: tenantA,
      name: 'Tomas Teacher',
      email: 'teacher@saexm-a.test',
      password: PW,
      role: 'TEACHER',
    });
    await createUser(client, {
      tenantId: tenantA,
      name: 'Petra Parent',
      email: 'parent@saexm-a.test',
      password: PW,
      role: 'PARENT',
    });
    await createUser(client, {
      tenantId: b,
      name: 'Bram Admin',
      email: 'admin@saexm-b.test',
      password: PW,
      role: 'SCHOOL_ADMIN',
    });
    const q = async (sql: string, params: unknown[]) =>
      (await client.query<{ id: string }>(sql, params)).rows[0]?.id ?? '';
    ids.gradeId = await q('SELECT grade_id AS id FROM sections WHERE id = $1', [ac.sectionA]);
    const student = (adm: string, first: string) =>
      q(
        "INSERT INTO students (id, tenant_id, school_id, admission_number, first_name, last_name, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'Examroll', now()) RETURNING id",
        [tenantA, ac.schoolId, adm, first],
      ).then(async (id) => {
        await client.query(
          "INSERT INTO student_enrollments (id, tenant_id, school_id, student_id, section_id, academic_year_id, start_date, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, '2026-04-01', now())",
          [tenantA, ac.schoolId, id, ac.sectionA, ac.yearId],
        );
        return id;
      });
    ids.s1 = await student('SAE-1', 'Amara');
    ids.s2 = await student('SAE-2', 'Bodhi');
    const t1 = await q(
      "INSERT INTO teachers (id, tenant_id, school_id, user_id, employee_id, first_name, last_name, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 'SAE-T1', 'Tomas', 'Teacher', now()) RETURNING id",
      [tenantA, ac.schoolId, teacherUser],
    );
    await client.query(
      "INSERT INTO teacher_assignments (id, tenant_id, school_id, teacher_id, section_id, subject_id, type, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'SUBJECT_TEACHER', now())",
      [tenantA, ac.schoolId, t1, ac.sectionA, ac.mathId],
    );
    await resetRateLimits();
    admin = await signIn(A, 'admin@saexm-a.test');
    teacher = await signIn(A, 'teacher@saexm-a.test');
    parent = await signIn(A, 'parent@saexm-a.test');
    otherAdmin = await signIn(B, 'admin@saexm-b.test');
  }, 60_000);

  beforeEach(resetRateLimits);

  afterAll(async () => {
    await purge(client, PREFIX);
    await client.end();
  });

  it('navigation: Exams for admin and teacher, not for parents; pages deny parents', async () => {
    const nav = (html: string) =>
      html.slice(html.indexOf('data-testid="side-nav"'), html.indexOf('id="workspace-main"'));
    for (const jar of [admin, teacher]) expect(nav((await page(jar, '/')).body)).toContain('Exams');
    expect(nav((await page(parent, '/')).body)).not.toContain('Exams');
    for (const path of ['/exams', '/exams/grade-scales'])
      expect((await page(parent, path)).body, path).toContain('data-testid="no-access"');
    const list = (await page(admin, '/exams')).body;
    expect(list).toContain('New exam');
    expect((await page(teacher, '/exams')).body).not.toContain('New exam');
  });

  it('BFF allow-list: Phase 9 paths pass, unknown paths are refused', async () => {
    expect((await api(admin, 'GET', 'exams')).status).toBe(200);
    expect((await api(admin, 'GET', `grade-scales?academicYearId=${ac.yearId}`)).status).toBe(200);
    expect((await api(admin, 'GET', 'exams/x/y/z/w/v')).status).toBe(404);
    expect((await api(admin, 'GET', 'result-publications')).status).toBe(404);
  });

  it('leadership builds an exam (scale, subject, paper, schedule) and opens marks entry', async () => {
    const scale = await api(admin, 'POST', 'grade-scales', {
      academicYearId: ac.yearId,
      name: 'Standard',
      bands: [
        { label: 'A', minPercentage: '75', maxPercentage: '100' },
        { label: 'B', minPercentage: '50', maxPercentage: '75' },
        { label: 'C', minPercentage: '0', maxPercentage: '50' },
      ],
    });
    expect(scale.status, JSON.stringify(scale.json)).toBe(201);
    const gap = await api(admin, 'POST', 'grade-scales', {
      academicYearId: ac.yearId,
      name: 'Gappy',
      bands: [{ label: 'A', minPercentage: '10', maxPercentage: '100' }],
    });
    expect(gap.json.code).toBe('GRADE_SCALE_INVALID');
    const scaleId = String((scale.json as unknown as { id: string }[])[0]?.id);
    const teacherTry = await api(teacher, 'POST', 'exams', {
      academicYearId: ac.yearId,
      name: 'X',
      startDate: '2026-10-01',
      endDate: '2026-10-02',
    });
    expect(teacherTry.status).toBe(403);
    const exam = await api(admin, 'POST', 'exams', {
      academicYearId: ac.yearId,
      name: 'Half Yearly',
      startDate: '2026-10-05',
      endDate: '2026-10-09',
      gradeScaleId: scaleId,
    });
    expect(exam.status, JSON.stringify(exam.json)).toBe(201);
    ids.exam = String(exam.json.id);
    const sub = await api(admin, 'POST', `exams/${ids.exam}/subjects`, {
      gradeId: ids.gradeId,
      subjectId: ac.mathId,
      passMarks: '20',
    });
    expect(sub.status, JSON.stringify(sub.json)).toBe(201);
    ids.examSubject = String((sub.json.subjects as { id: string }[])[0]?.id);
    const comp = await api(
      admin,
      'POST',
      `exams/${ids.exam}/subjects/${ids.examSubject}/components`,
      { name: 'Written', maxMarks: '50', passMarks: '17' },
    );
    expect(comp.status).toBe(201);
    ids.comp = String(
      (comp.json.subjects as { components: { id: string }[] }[])[0]?.components[0]?.id,
    );
    const sch = await api(
      admin,
      'PUT',
      `exams/${ids.exam}/components/${ids.comp}/schedules/${ac.branchId}`,
      { examDate: '2026-10-06', startTime: '09:00', endTime: '11:00' },
    );
    expect(sch.status, JSON.stringify(sch.json)).toBe(200);
    const detail = (await page(admin, `/exams/${ids.exam}`)).body;
    expect(detail).toContain('data-testid="exam-structure"');
    expect(detail).toContain('Written');
    expect(detail).toContain('2026-10-06 09:00');
    expect(detail).toContain('Publish schedule');
    for (const t of ['publish', 'open-marks']) {
      const r = await api(admin, 'POST', `exams/${ids.exam}/transitions/${t}`, {
        expectedVersion: await examVersion(),
      });
      expect(r.status, `${t} ${JSON.stringify(r.json)}`).toBeLessThan(300);
    }
    expect((await page(teacher, '/exams')).body).toContain('Half Yearly');
  });

  it('teacher enters marks on their sheet, submits; leadership finalizes; exam finalizes', async () => {
    const view = (await page(teacher, `/exams/${ids.exam}`)).body;
    expect(view).toContain('data-testid="sheets-table"');
    const sheetHtml = (await page(teacher, `/${sheetPath().replace('sheets', 'marks')}`)).body;
    expect(sheetHtml).toContain('data-testid="mark-sheet"');
    expect(sheetHtml).toContain('Amara Examroll, Written marks'.split(',')[0]);
    const v0 = Number((await api(teacher, 'GET', sheetPath())).json.version);
    const bad = await api(teacher, 'PUT', sheetPath(), {
      expectedVersion: v0,
      entries: [{ studentId: ids.s1, componentId: ids.comp, status: 'MARKED', marks: '51' }],
    });
    expect(bad.json.code).toBe('INVALID_MARK');
    const saved = await api(teacher, 'PUT', sheetPath(), {
      expectedVersion: v0,
      entries: [
        { studentId: ids.s1, componentId: ids.comp, status: 'MARKED', marks: '42.5' },
        { studentId: ids.s2, componentId: ids.comp, status: 'ABSENT' },
      ],
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    const stale = await api(teacher, 'PUT', sheetPath(), {
      expectedVersion: v0,
      entries: [{ studentId: ids.s1, componentId: ids.comp, status: 'MARKED', marks: '40' }],
    });
    expect(stale.json.code).toBe('STALE_VERSION');
    const sub = await api(teacher, 'POST', `${sheetPath()}/submit`, {
      expectedVersion: saved.json.version,
    });
    expect(sub.status, JSON.stringify(sub.json)).toBe(201);
    expect(
      (await api(teacher, 'POST', `${sheetPath()}/finalize`, { expectedVersion: sub.json.version }))
        .status,
    ).toBe(403);
    const fin = await api(admin, 'POST', `${sheetPath()}/finalize`, {
      expectedVersion: sub.json.version,
    });
    expect(fin.status).toBe(201);
    const fm = await api(admin, 'POST', `exams/${ids.exam}/transitions/finalize-marks`, {
      expectedVersion: await examVersion(),
    });
    expect(fm.status, JSON.stringify(fm.json)).toBeLessThan(300);
  });

  it('results: live table, teacher cannot publish, admin publishes; report card prints the snapshot', async () => {
    const html = (await page(admin, `/exams/${ids.exam}/results`)).body;
    expect(html).toContain('data-testid="results-table"');
    expect(html).toContain('85.00');
    expect(html).toContain('Publish results');
    expect((await page(teacher, `/exams/${ids.exam}/results`)).body).not.toContain(
      'Publish results',
    );
    expect(
      (
        await api(teacher, 'POST', `exams/${ids.exam}/results/publish`, {
          expectedVersion: await examVersion(),
        })
      ).status,
    ).toBe(403);
    const pub = await api(admin, 'POST', `exams/${ids.exam}/results/publish`, {
      expectedVersion: await examVersion(),
    });
    expect(pub.status, JSON.stringify(pub.json)).toBeLessThan(300);
    const pubs = (await api(admin, 'GET', `exams/${ids.exam}/publications`)).json as unknown as {
      id: string;
      version: number;
      isCurrent: boolean;
    }[];
    expect(pubs).toHaveLength(1);
    const card = (
      await page(admin, `/exams/${ids.exam}/results/${ids.s1}?publication=${pubs[0]?.id}`)
    ).body;
    expect(card).toContain('data-testid="report-card"');
    expect(card).toContain('Published version 1');
    expect(card).toContain('Print');
    expect(card).not.toContain('data-testid="remark-editor"');
    const absent = (await page(admin, `/exams/${ids.exam}/results/${ids.s2}`)).body;
    expect(absent).toContain('Absent');
    expect(absent).toContain('PREVIEW');
  });

  it('cross-school: another school cannot see the exam or report card', async () => {
    expect((await api(otherAdmin, 'GET', `exams/${ids.exam}`, undefined, B)).status).toBe(404);
    expect((await page(otherAdmin, `/exams/${ids.exam}`, B)).status).toBe(404);
    expect((await api(parent, 'GET', `exams/${ids.exam}`)).status).toBe(403);
  });

  it('assignment grading: max marks, grading page, draft → publish', async () => {
    const created = await api(teacher, 'POST', 'assignments', {
      sectionId: ac.sectionA,
      subjectId: ac.mathId,
      title: 'Geometry worksheet',
      assignedDate: today,
      dueDate: today,
      maxMarks: '20',
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    ids.assignment = String(created.json.id);
    expect(created.json.maxMarks).toBe('20.00');
    expect(
      (
        await api(teacher, 'POST', `assignments/${ids.assignment}/publish`, {
          expectedVersion: created.json.version,
        })
      ).status,
    ).toBe(200);
    const detail = (await page(teacher, `/assignments/${ids.assignment}`)).body;
    expect(detail).toContain('Submissions &amp; grading');
    const g = (await page(teacher, `/assignments/${ids.assignment}/grading`)).body;
    expect(g).toContain('No submissions yet');
    expect((await page(parent, `/assignments/${ids.assignment}/grading`)).body).toContain(
      'data-testid="no-access"',
    );
  });
});
