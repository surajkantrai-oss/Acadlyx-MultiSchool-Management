/**
 * Phase 7 academic operations through the real School Admin app (pages + BFF): navigation,
 * attendance (sheet, save, correction log), homework and assignments (draft → publish, scope),
 * timetable (periods, lessons, accessible grid, conflicts), teacher scope, parent denial and
 * cross-school isolation.
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

const PREFIX = 'SAOPS';
const A = 'saops-a.localhost';
const B = 'saops-b.localhost';
const PW = 'Operations-admin-pass-1';
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

describe('School Admin — academic operations (Phase 7)', () => {
  let client: pg.Client;
  let admin: Jar;
  let teacher: Jar;
  let parent: Jar;
  let otherAdmin: Jar;
  let ac: Awaited<ReturnType<typeof createAcademic>>;
  let acB: Awaited<ReturnType<typeof createAcademic>>;
  let tenantA = '';
  const ids = { t1: '', t2: '', s1: '', s2: '', hw: '' };

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
      name: 'Ops School A',
    });
    const b = await createSchool(client, {
      key: `${PREFIX}_B`,
      status: 'ACTIVE',
      domain: B,
      name: 'Ops School B',
    });
    ac = await createAcademic(client, tenantA);
    acB = await createAcademic(client, b);
    await createUser(client, {
      tenantId: tenantA,
      name: 'Ada Admin',
      email: 'admin@saops-a.test',
      password: PW,
      role: 'SCHOOL_ADMIN',
    });
    const teacherUser = await createUser(client, {
      tenantId: tenantA,
      name: 'Tomas Teacher',
      email: 'teacher@saops-a.test',
      password: PW,
      role: 'TEACHER',
    });
    await createUser(client, {
      tenantId: tenantA,
      name: 'Petra Parent',
      email: 'parent@saops-a.test',
      password: PW,
      role: 'PARENT',
    });
    await createUser(client, {
      tenantId: b,
      name: 'Bram Admin',
      email: 'admin@saops-b.test',
      password: PW,
      role: 'SCHOOL_ADMIN',
    });
    const q = async (sql: string, params: unknown[]) =>
      (await client.query<{ id: string }>(sql, params)).rows[0]?.id ?? '';
    const student = (adm: string, first: string, sectionId: string) =>
      q(
        "INSERT INTO students (id, tenant_id, school_id, admission_number, first_name, last_name, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'Opsroll', now()) RETURNING id",
        [tenantA, ac.schoolId, adm, first],
      ).then(async (id) => {
        await client.query(
          "INSERT INTO student_enrollments (id, tenant_id, school_id, student_id, section_id, academic_year_id, start_date, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, '2026-04-01', now())",
          [tenantA, ac.schoolId, id, sectionId, ac.yearId],
        );
        return id;
      });
    ids.s1 = await student('SAO-1', 'Amara', ac.sectionA);
    ids.s2 = await student('SAO-2', 'Bodhi', ac.sectionA);
    await student('SAO-3', 'Chen', ac.sectionB);
    ids.t1 = await q(
      "INSERT INTO teachers (id, tenant_id, school_id, user_id, employee_id, first_name, last_name, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 'SAO-T1', 'Tomas', 'Teacher', now()) RETURNING id",
      [tenantA, ac.schoolId, teacherUser],
    );
    ids.t2 = await q(
      "INSERT INTO teachers (id, tenant_id, school_id, employee_id, first_name, last_name, updated_at) VALUES (gen_random_uuid(), $1, $2, 'SAO-T2', 'Uma', 'Second', now()) RETURNING id",
      [tenantA, ac.schoolId],
    );
    for (const [teacherId, sectionId] of [
      [ids.t1, ac.sectionA],
      [ids.t2, ac.sectionA],
      [ids.t2, ac.sectionB],
    ])
      await client.query(
        "INSERT INTO teacher_assignments (id, tenant_id, school_id, teacher_id, section_id, subject_id, type, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'SUBJECT_TEACHER', now())",
        [tenantA, ac.schoolId, teacherId, sectionId, ac.mathId],
      );
    await resetRateLimits();
    admin = await signIn(A, 'admin@saops-a.test');
    teacher = await signIn(A, 'teacher@saops-a.test');
    parent = await signIn(A, 'parent@saops-a.test');
    otherAdmin = await signIn(B, 'admin@saops-b.test');
  }, 60_000);

  beforeEach(resetRateLimits);

  afterAll(async () => {
    await purge(client, PREFIX);
    await client.end();
  });

  it('navigation shows the operations to staff who hold them, not to parents', async () => {
    const nav = (html: string) =>
      html.slice(html.indexOf('data-testid="side-nav"'), html.indexOf('id="workspace-main"'));
    for (const jar of [admin, teacher]) {
      const n = nav((await page(jar, '/')).body);
      for (const l of ['Attendance', 'Homework', 'Assignments', 'Timetable'])
        expect(n, l).toContain(l);
    }
    const p = nav((await page(parent, '/')).body);
    expect(p).not.toMatch(/Attendance|Homework|Assignments|Timetable/);
    for (const path of ['/attendance', '/homework', '/assignments', '/timetable'])
      expect((await page(parent, path)).body, path).toContain('data-testid="no-access"');
  });

  it('attendance: teacher sees only their class, saves the roster, admin corrects, log shows it', async () => {
    const home = (await page(teacher, '/attendance')).body;
    expect(home).toContain('data-testid="attendance-classes"');
    expect(home).toContain('Grade 5 A');
    expect(home).not.toContain('Grade 5 B');
    const sheet = (await page(teacher, `/attendance/${ac.sectionA}`)).body;
    expect(sheet).toContain('data-testid="attendance-roster"');
    expect(sheet).toContain('SAO-1');
    expect(sheet).toContain('Mark all present');
    expect(sheet).toContain('Attendance for Amara Opsroll');
    const saved = await api(teacher, 'PUT', 'attendance', {
      sectionId: ac.sectionA,
      date: today,
      records: [
        { studentId: ids.s1, status: 'PRESENT' },
        { studentId: ids.s2, status: 'ABSENT' },
      ],
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    const version = (saved.json.session as { version: number }).version;
    const corrected = await api(admin, 'PUT', 'attendance', {
      sectionId: ac.sectionA,
      date: today,
      expectedVersion: version,
      records: [{ studentId: ids.s2, status: 'LATE', note: 'Traffic' }],
    });
    expect(corrected.status).toBe(200);
    const stale = await api(teacher, 'PUT', 'attendance', {
      sectionId: ac.sectionA,
      date: today,
      expectedVersion: version,
      records: [{ studentId: ids.s2, status: 'PRESENT' }],
    });
    expect(stale.status).toBe(409);
    const after = (await page(teacher, `/attendance/${ac.sectionA}?date=${today}`)).body;
    expect(after).toContain('data-testid="attendance-corrections"');
    expect(after).toContain('Absent → Late');
    expect(after).toContain('data-testid="attendance-history"');
    const other = await page(teacher, `/attendance/${ac.sectionB}`);
    expect(other.status).toBe(404);
    expect(other.body).toContain('record-not-found');
    const future = await api(admin, 'PUT', 'attendance', {
      sectionId: ac.sectionA,
      date: '2099-01-01',
      records: [{ studentId: ids.s1, status: 'PRESENT' }],
    });
    expect(future.json.code).toBe('ATTENDANCE_FUTURE_DATE');
  });

  it('homework: teacher creates a draft for their subject, publishes it; admin sees it; others cannot', async () => {
    const form = (await page(teacher, '/homework/new')).body;
    expect(form).toContain('Grade 5 A');
    expect(form).toContain('Mathematics');
    expect(form).not.toContain('Grade 5 B');
    const created = await api(teacher, 'POST', 'homework', {
      sectionId: ac.sectionA,
      subjectId: ac.mathId,
      title: 'Times tables 6–9',
      assignedDate: today,
      dueDate: today,
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    ids.hw = String(created.json.id);
    expect(created.json.status).toBe('DRAFT');
    expect((await page(admin, `/homework/${ids.hw}`)).body).toContain('Times tables 6–9');
    const pub = await api(teacher, 'POST', `homework/${ids.hw}/publish`, { expectedVersion: 1 });
    expect(pub.json.status).toBe('PUBLISHED');
    const list = (await page(admin, '/homework')).body;
    expect(list).toContain('data-testid="homework-table"');
    expect(list).toContain('Times tables 6–9');
    const wrong = await api(teacher, 'POST', 'homework', {
      sectionId: ac.sectionB,
      subjectId: ac.mathId,
      title: 'x',
      assignedDate: today,
      dueDate: today,
    });
    expect(wrong.status).toBe(404);
    expect((await api(parent, 'GET', 'homework')).status).toBe(403);
    expect((await page(otherAdmin, `/homework/${ids.hw}`, B)).status).toBe(404);
  });

  it('assignments: draft → publish → close with confirm-able actions', async () => {
    const a = await api(teacher, 'POST', 'assignments', {
      sectionId: ac.sectionA,
      subjectId: ac.mathId,
      title: 'Survey project',
      assignedDate: today,
      dueDate: today,
    });
    expect(a.status).toBe(201);
    const id = String(a.json.id);
    await api(teacher, 'POST', `assignments/${id}/publish`, { expectedVersion: 1 });
    const detail = (await page(teacher, `/assignments/${id}`)).body;
    expect(detail).toContain('data-testid="classwork-header"');
    expect(detail).toContain('Close');
    const closed = await api(teacher, 'POST', `assignments/${id}/close`, { expectedVersion: 2 });
    expect(closed.json.status).toBe('CLOSED');
    expect((await page(admin, '/assignments?status=CLOSED')).body).toContain('Survey project');
  });

  it('timetable: periods and lessons with accessible grid; conflicts explained; teacher sees own week, cannot edit', async () => {
    const period = async (name: string, type: string, startTime: string, endTime: string) =>
      String(
        (
          await api(admin, 'POST', 'timetable/periods', {
            branchId: ac.branchId,
            academicYearId: ac.yearId,
            name,
            type,
            startTime,
            endTime,
          })
        ).json.id,
      );
    const p1 = await period('P1', 'INSTRUCTIONAL', '09:00', '09:45');
    await period('Break', 'BREAK', '09:45', '10:00');
    const lesson = await api(admin, 'POST', 'timetable/entries', {
      sectionId: ac.sectionA,
      periodId: p1,
      weekday: 'MONDAY',
      subjectId: ac.mathId,
      teacherId: ids.t2,
    });
    expect(lesson.status, JSON.stringify(lesson.json)).toBe(201);
    const clash = await api(admin, 'POST', 'timetable/entries', {
      sectionId: ac.sectionB,
      periodId: p1,
      weekday: 'MONDAY',
      subjectId: ac.mathId,
      teacherId: ids.t2,
    });
    expect(clash.status).toBe(409);
    expect(clash.json.code).toBe('TEACHER_TIMETABLE_CONFLICT');
    expect(String(clash.json.message)).toContain('already scheduled');
    const grid = (await page(admin, `/timetable?section=${ac.sectionA}`)).body;
    expect(grid).toContain('data-testid="timetable-grid"');
    expect(grid).toContain('Monday, P1 09:00 to 09:45, Mathematics, Grade 5 A, Uma Second');
    expect(grid).toContain('Break');
    expect(grid).toContain('Add a lesson');
    expect((await page(admin, '/timetable/periods')).body).toContain('data-testid="periods-table"');
    await api(admin, 'POST', 'timetable/entries', {
      sectionId: ac.sectionA,
      periodId: p1,
      weekday: 'TUESDAY',
      subjectId: ac.mathId,
      teacherId: ids.t1,
    });
    const mine = (await page(teacher, '/timetable')).body;
    expect(mine).toContain('My timetable');
    expect(mine).toContain('Tuesday, P1 09:00 to 09:45, Mathematics, Grade 5 A');
    expect(mine).not.toContain('Add a lesson');
    expect(
      (
        await api(teacher, 'POST', 'timetable/entries', {
          sectionId: ac.sectionA,
          periodId: p1,
          weekday: 'WEDNESDAY',
          subjectId: ac.mathId,
          teacherId: ids.t1,
        })
      ).status,
    ).toBe(403);
  });

  it('class page links to operations; dashboard shows today’s real counts; school B sees none of A', async () => {
    const cls = (await page(admin, `/classes/${ac.sectionA}`)).body;
    expect(cls).toContain('data-testid="class-ops"');
    expect(cls).toContain(`/attendance/${ac.sectionA}`);
    const dash = (await page(teacher, '/')).body;
    expect(dash).toContain('data-testid="dashboard-operations"');
    expect(dash).toContain('Classes to mark attendance');
    for (const path of ['/attendance', '/homework', '/assignments', '/timetable']) {
      const html = (await page(otherAdmin, path, B)).body;
      expect(html, path).not.toMatch(/Times tables|Survey project|Amara|Tomas Teacher|Uma Second/);
    }
    expect((await page(otherAdmin, `/attendance/${ac.sectionA}`, B)).status).toBe(404);
    expect(
      (await api(otherAdmin, 'GET', `timetable/sections/${ac.sectionA}`, undefined, B)).status,
    ).toBe(404);
    expect((await page(otherAdmin, `/timetable?section=${acB.sectionA}`, B)).body).toContain(
      'timetable-empty',
    );
  });
});
