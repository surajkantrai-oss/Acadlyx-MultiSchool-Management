import type { Paginated } from '@acadlyx/tenant-config';
import type {
  CreatedAccount,
  ParentDetail,
  StudentDetail,
  StudentSummary,
  TeacherDetail,
  TeacherSummary,
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
  type AcademicFixture,
  createAcademicFixture,
  createFixtureSchools,
  createFixtureTenants,
  FIXTURE_LETTERS,
  type FixtureLetter,
  type FixtureTenant,
  purgeTenants,
} from './helpers/tenant-fixtures.js';

const PREFIX = 'PPL';
const PW = 'People-pass-2026';
const PIN = '258147';
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
 * Phase 5 people API (e2e): RBAC per role, students/parents/teachers, guardians, enrollment
 * history, teacher assignments, accounts, A→B/B→C/C→A attacks, same-tenant cross-school
 * attacks, concurrency invariants and audit.
 */
describe('People, enrollment and accounts API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PlatformPrismaService;
  let t: Record<FixtureLetter, FixtureTenant>;
  let school: Record<FixtureLetter, string>;
  const ac = {} as Record<FixtureLetter, AcademicFixture>;
  const token = {} as Record<FixtureLetter, string>;
  const roleToken = {} as Record<Role, string>;
  const userId = {} as Record<Role, string>;

  const api = (l: FixtureLetter, bearer = token[l]) =>
    call(app, { host: t[l].domain, token: bearer });
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
      const email = `principal@ppl-${l.toLowerCase()}.test`;
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
      ['admin', 'SCHOOL_ADMIN', 'admin@ppl-a.test'],
      ['teacher', 'TEACHER', 'teacher@ppl-a.test'],
      ['accountant', 'ACCOUNTANT', 'accounts@ppl-a.test'],
      ['admission', 'ADMISSION_OFFICER', 'admissions@ppl-a.test'],
      ['transport', 'TRANSPORT_MANAGER', 'transport@ppl-a.test'],
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
      phone: '+919822200001',
      credentialType: 'PIN',
      secret: PIN,
    });
    roleToken.parent = (
      await tenantLogin(app, t.A.domain, '+919822200001', PIN)
    ).tokens.accessToken;
    userId.student = await createTenantUser(app, {
      tenantId: t.A.id,
      roles: ['STUDENT'],
      loginId: 'PPL-STU',
      loginIdKind: 'STUDENT_ID',
      credentialType: 'PIN',
      secret: PIN,
    });
    roleToken.student = (await tenantLogin(app, t.A.domain, 'PPL-STU', PIN)).tokens.accessToken;
  }, 180_000);

  beforeEach(async () => {
    await resetRateLimits(app);
  });

  afterAll(async () => {
    await purgeTenants(prisma, PREFIX);
    await purgePlatformUsers(app, 'ppl-');
    await app.close();
  });

  const newStudent = async (
    l: FixtureLetter,
    admissionNumber: string,
    extra: Record<string, unknown> = {},
  ) =>
    (
      await api(l)
        .post('/api/v1/students')
        .send({ admissionNumber, firstName: `Kid ${admissionNumber}`, lastName: 'Test', ...extra })
        .expect(201)
    ).body as StudentDetail;
  const newParent = async (
    l: FixtureLetter,
    firstName: string,
    extra: Record<string, unknown> = {},
  ) =>
    (
      await api(l)
        .post('/api/v1/parents')
        .send({ firstName, lastName: 'Parent', ...extra })
        .expect(201)
    ).body as ParentDetail;
  const newTeacher = async (
    l: FixtureLetter,
    employeeId: string,
    extra: Record<string, unknown> = {},
  ) =>
    (
      await api(l)
        .post('/api/v1/teachers')
        .send({ employeeId, firstName: `Teacher ${employeeId}`, ...extra })
        .expect(201)
    ).body as TeacherDetail;

  // ---- RBAC -----------------------------------------------------------------------------------
  describe('RBAC', () => {
    it('grants management to leadership, conservative reads to staff, nothing to parents/students', async () => {
      for (const r of ['principal', 'admin'] as const) {
        await as(r).get('/api/v1/students').expect(200);
        await as(r)
          .post('/api/v1/teachers')
          .send({ employeeId: `RB-${r}`, firstName: 'X' })
          .expect(201);
        await as(r).get('/api/v1/imports').expect(200);
      }
      // Teacher: read-only people, no imports, no management.
      for (const p of ['/api/v1/students', '/api/v1/parents', '/api/v1/teachers'])
        await as('teacher').get(p).expect(200);
      await as('teacher')
        .post('/api/v1/students')
        .send({ admissionNumber: 'T1', firstName: 'x' })
        .expect(403);
      await as('teacher').get('/api/v1/imports').expect(403);
      await as('teacher')
        .post('/api/v1/teachers')
        .send({ employeeId: 'T1', firstName: 'x' })
        .expect(403);
      // Admission officer: students/parents/enrollment manage, no teachers, no accounts.
      await as('admission')
        .post('/api/v1/students')
        .send({ admissionNumber: 'AO-1', firstName: 'Ao' })
        .expect(201);
      await as('admission').post('/api/v1/parents').send({ firstName: 'Ao parent' }).expect(201);
      await as('admission')
        .post('/api/v1/teachers')
        .send({ employeeId: 'AO-T', firstName: 'x' })
        .expect(403);
      await as('admission').get('/api/v1/teachers').expect(403);
      const ao = (await as('admission').get('/api/v1/students?q=AO-1').expect(200))
        .body as Paginated<StudentSummary>;
      await as('admission')
        .post(`/api/v1/students/${ao.items[0]?.id ?? ''}/account`)
        .expect(403);
      // Accountant: student + enrollment read only; guardian contacts hidden.
      await as('accountant').get('/api/v1/students').expect(200);
      await as('accountant').get('/api/v1/parents').expect(403);
      await as('accountant')
        .post('/api/v1/students')
        .send({ admissionNumber: 'AC-1', firstName: 'x' })
        .expect(403);
      // Transport, parent, student: no people access at all.
      for (const r of ['transport', 'parent', 'student'] as const) {
        for (const p of [
          '/api/v1/students',
          '/api/v1/parents',
          '/api/v1/teachers',
          '/api/v1/imports',
          '/api/v1/people/summary',
        ]) {
          expect((await as(r).get(p)).status, `${r} ${p}`).toBe(403);
        }
      }
      await call(app, { host: t.A.domain }).get('/api/v1/students').expect(401);
    });

    it('keeps platform and tenant scopes separate', async () => {
      await purgePlatformUsers(app, 'ppl-');
      await createPlatformUser(app, {
        email: 'ppl-admin@acadlyx.test',
        password: 'Ppl-admin-pass-26',
      });
      const platform = (await platformLogin(app, 'ppl-admin@acadlyx.test', 'Ppl-admin-pass-26'))
        .tokens.accessToken;
      expect([401, 403]).toContain(
        (await call(app, { host: t.A.domain, token: platform }).get('/api/v1/students')).status,
      );
      expect([401, 403]).toContain(
        (await call(app, { token: token.A }).get('/api/v1/platform/tenants')).status,
      );
    });
  });

  // ---- Students, guardians, enrollment ---------------------------------------------------------
  describe('students', () => {
    it('creates with placement + guardians; identifiers unique per school only; names preserved', async () => {
      const mum = await newParent('A', 'Meera', {
        phone: '98111 00001',
        email: 'Meera@Example.com',
        parentCode: 'par-1',
      });
      expect(mum).toMatchObject({
        parentCode: 'PAR-1',
        phone: '+919811100001',
        email: 'meera@example.com',
      });
      const dad = await newParent('A', 'Arjun', { phone: '9811100001' }); // shared family phone is fine
      const s = await newStudent('A', 'adm-001', {
        firstName: "D'Souza",
        middleName: 'K.',
        dateOfBirth: '2016-02-29',
        enrollment: { sectionId: ac.A.sectionA },
        guardians: [
          { parentId: mum.id, relationship: 'MOTHER', isPrimary: true, pickupAuthorized: true },
          { parentId: dad.id, relationship: 'FATHER' },
        ],
      });
      expect(s).toMatchObject({
        admissionNumber: 'ADM-001',
        firstName: "D'Souza",
        middleName: 'K.',
        dateOfBirth: '2016-02-29',
        status: 'ACTIVE',
        account: null,
      });
      expect(s.currentPlacement).toMatchObject({
        sectionName: 'A',
        gradeName: 'Grade 5',
        branchName: 'Main',
        academicYearName: '2026–27',
      });
      expect(s.guardians.map((g) => [g.relationship, g.isPrimary])).toEqual([
        ['MOTHER', true],
        ['FATHER', false],
      ]);
      expect(s.statusHistory).toEqual([
        expect.objectContaining({ fromStatus: null, toStatus: 'ACTIVE' }),
      ]);
      const dup = await api('A')
        .post('/api/v1/students')
        .send({ admissionNumber: 'ADM-001', firstName: 'Again' })
        .expect(409);
      expect(dup.body).toMatchObject({ code: 'DUPLICATE_ADMISSION_NUMBER' });
      await newStudent('B', 'ADM-001'); // same number, other school/tenant
      // Validation: bad dates, markup, unknown fields.
      await api('A')
        .post('/api/v1/students')
        .send({ admissionNumber: 'X1', firstName: 'x', dateOfBirth: '2016-02-30' })
        .expect(400);
      await api('A')
        .post('/api/v1/students')
        .send({ admissionNumber: 'X1', firstName: '<b>x</b>' })
        .expect(400);
      await api('A')
        .post('/api/v1/students')
        .send({ admissionNumber: 'X1', firstName: 'x', tenantId: t.B.id })
        .expect(400);
      await api('A')
        .post('/api/v1/students')
        .send({ admissionNumber: 'X1', firstName: 'x', userId: userId.student })
        .expect(400);
    });

    it('searches, filters by placement and status, paginates server-side', async () => {
      await newStudent('C', 'S-1', {
        firstName: 'Zara',
        lastName: 'Khan',
        enrollment: { sectionId: ac.C.sectionA },
      });
      await newStudent('C', 'S-2', {
        firstName: 'Zoya',
        lastName: 'Khan',
        enrollment: { sectionId: ac.C.sectionB },
      });
      await newStudent('C', 'S-3', { firstName: 'Ira', lastName: 'Rao' });
      const bySection = (
        await api('C').get(`/api/v1/students?sectionId=${ac.C.sectionB}`).expect(200)
      ).body as Paginated<StudentSummary>;
      expect(bySection.items.map((s) => s.admissionNumber)).toEqual(['S-2']);
      const byGrade = (
        await api('C')
          .get(`/api/v1/students?gradeId=${ac.C.gradeId}&academicYearId=${ac.C.yearId}`)
          .expect(200)
      ).body as Paginated<StudentSummary>;
      expect(byGrade.total).toBe(2);
      const byName = (await api('C').get('/api/v1/students?q=zara khan').expect(200))
        .body as Paginated<StudentSummary>;
      expect(byName.items.map((s) => s.firstName)).toEqual(['Zara']);
      expect(
        (
          (await api('C').get('/api/v1/students?q=s-3').expect(200))
            .body as Paginated<StudentSummary>
        ).total,
      ).toBe(1);
      const page = (await api('C').get('/api/v1/students?pageSize=2&page=2').expect(200))
        .body as Paginated<StudentSummary>;
      expect(page).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
      expect(page.items).toHaveLength(1);
      await api('C').get('/api/v1/students?pageSize=500').expect(400);
    });

    it('enforces the approved lifecycle and keeps history; withdrawal ends the enrollment', async () => {
      const s = await newStudent('A', 'LIFE-1', { enrollment: { sectionId: ac.A.sectionA } });
      const st = (status: string, expected = 200) =>
        api('A')
          .post(`/api/v1/students/${s.id}/status`)
          .send({ status, reason: 'test' })
          .expect(expected);
      await st('INACTIVE');
      await st('ACTIVE');
      const w = (await st('WITHDRAWN')).body as StudentDetail;
      expect(w.enrollments[0]).toMatchObject({ status: 'WITHDRAWN' });
      expect(w.enrollments[0]?.endDate).not.toBeNull();
      expect(w.currentPlacement).toBeNull();
      expect((await st('INACTIVE', 409)).body).toMatchObject({
        code: 'STUDENT_STATUS_TRANSITION_INVALID',
      });
      await st('ACTIVE'); // re-admission
      await st('GRADUATED');
      await st('ACTIVE', 409); // terminal
      const detail = (await api('A').get(`/api/v1/students/${s.id}`).expect(200))
        .body as StudentDetail;
      expect(detail.statusHistory.map((h) => h.toStatus)).toEqual([
        'GRADUATED',
        'ACTIVE',
        'WITHDRAWN',
        'ACTIVE',
        'INACTIVE',
        'ACTIVE',
      ]);
      expect(detail.enrollments).toHaveLength(1); // history kept, nothing deleted
    });

    it('enrollment: one ACTIVE per year, same-year transfer keeps history, closed/inactive sections refused', async () => {
      const s = await newStudent('A', 'ENR-1');
      const enroll = (sectionId: string) =>
        api('A')
          .post(`/api/v1/students/${s.id}/enrollments`)
          .send({ sectionId, startDate: '2026-06-01' });
      await enroll(ac.A.sectionA).expect(201);
      expect((await enroll(ac.A.sectionB).expect(409)).body).toMatchObject({
        code: 'ACTIVE_ENROLLMENT_EXISTS',
      });
      expect((await enroll(ac.A.closedSection).expect(409)).body).toMatchObject({
        code: 'SECTION_UNAVAILABLE',
      });
      expect((await enroll(ac.A.inactiveSection).expect(409)).body).toMatchObject({
        code: 'SECTION_UNAVAILABLE',
      });
      await api('A')
        .post(`/api/v1/students/${s.id}/enrollments`)
        .send({ sectionId: ac.A.sectionA, startDate: '2030-01-01' })
        .expect(400);
      const first = (
        (await api('A').get(`/api/v1/students/${s.id}/enrollments`).expect(200)).body as {
          enrollmentId: string;
        }[]
      )[0];
      const moved = (
        await api('A')
          .post(`/api/v1/students/${s.id}/enrollments/${first?.enrollmentId ?? ''}/transfer`)
          .send({ sectionId: ac.A.sectionB, date: '2026-09-01' })
          .expect(200)
      ).body as StudentDetail;
      expect(moved.enrollments.map((e) => [e.sectionName, e.status, e.endDate])).toEqual([
        ['B', 'ACTIVE', null],
        ['A', 'TRANSFERRED', '2026-09-01'],
      ]);
      expect(moved.currentPlacement?.sectionName).toBe('B');
      const active = moved.enrollments[0]?.enrollmentId ?? '';
      const done = (
        await api('A')
          .post(`/api/v1/students/${s.id}/enrollments/${active}/end`)
          .send({ status: 'COMPLETED', date: '2027-03-31' })
          .expect(200)
      ).body as StudentDetail;
      expect(done.enrollments[0]).toMatchObject({ status: 'COMPLETED', endDate: '2027-03-31' });
      await api('A')
        .post(`/api/v1/students/${s.id}/enrollments/${active}/end`)
        .send({ status: 'WITHDRAWN' })
        .expect(409);
    });

    it('guardians: many-to-many, 0/1 primary, unlink keeps the parent', async () => {
      const p = await newParent('A', 'Shared');
      const p2 = await newParent('A', 'Second');
      const k1 = await newStudent('A', 'SIB-1', {
        guardians: [{ parentId: p.id, relationship: 'GUARDIAN', isPrimary: true }],
      });
      const k2 = await newStudent('A', 'SIB-2', {
        guardians: [{ parentId: p.id, relationship: 'GUARDIAN' }],
      });
      const parent = (await api('A').get(`/api/v1/parents/${p.id}`).expect(200))
        .body as ParentDetail;
      expect(parent.children.map((c) => c.student.admissionNumber).sort()).toEqual([
        'SIB-1',
        'SIB-2',
      ]);
      // New primary replaces the old one atomically.
      let d = (
        await api('A')
          .post(`/api/v1/students/${k1.id}/guardians`)
          .send({ parentId: p2.id, relationship: 'OTHER', isPrimary: true })
          .expect(201)
      ).body as StudentDetail;
      expect(d.guardians.filter((g) => g.isPrimary).map((g) => g.parentId)).toEqual([p2.id]);
      expect(
        (
          await api('A')
            .post(`/api/v1/students/${k1.id}/guardians`)
            .send({ parentId: p.id, relationship: 'MOTHER' })
            .expect(409)
        ).body,
      ).toMatchObject({ code: 'GUARDIAN_ALREADY_LINKED' });
      await api('A')
        .post(`/api/v1/students/${k1.id}/guardians`)
        .send({ parentId: p.id, relationship: 'AUNT' })
        .expect(400);
      const link = d.guardians.find((g) => g.parentId === p.id);
      d = (
        await api('A')
          .patch(`/api/v1/students/${k1.id}/guardians/${link?.id ?? ''}`)
          .send({ relationship: 'MOTHER', isEmergencyContact: true })
          .expect(200)
      ).body as StudentDetail;
      expect(d.guardians.find((g) => g.parentId === p.id)).toMatchObject({
        relationship: 'MOTHER',
        isEmergencyContact: true,
      });
      d = (
        await api('A')
          .delete(`/api/v1/students/${k1.id}/guardians/${link?.id ?? ''}`)
          .expect(200)
      ).body as StudentDetail;
      expect(d.guardians.map((g) => g.parentId)).toEqual([p2.id]);
      await api('A').get(`/api/v1/parents/${p.id}`).expect(200); // parent still exists
      expect(k2.guardians).toHaveLength(1);
      // Inactive parents cannot be newly linked.
      await api('A').post(`/api/v1/parents/${p2.id}/deactivate`).expect(200);
      expect(
        (
          await api('A')
            .post(`/api/v1/students/${k2.id}/guardians`)
            .send({ parentId: p2.id, relationship: 'OTHER' })
            .expect(409)
        ).body,
      ).toMatchObject({ code: 'PARENT_INACTIVE' });
      // Accountant sees the student but not guardian contact data.
      const acc = (await as('accountant').get(`/api/v1/students/${k1.id}`).expect(200))
        .body as StudentDetail;
      expect(acc.guardians.every((g) => g.parent.phone === null && g.parent.email === null)).toBe(
        true,
      );
    });
  });

  // ---- Teachers & assignments ------------------------------------------------------------------
  describe('teachers', () => {
    it('employee IDs unique per school; subject must be mapped to the grade; one class teacher; co-teaching; history', async () => {
      const t1 = await newTeacher('A', 'emp-1', {
        email: 'Ravi@School.test',
        joiningDate: '2024-06-01',
      });
      const t2 = await newTeacher('A', 'EMP-2');
      expect(t1).toMatchObject({
        employeeId: 'EMP-1',
        email: 'ravi@school.test',
        joiningDate: '2024-06-01',
        status: 'ACTIVE',
      });
      expect(
        (
          await api('A')
            .post('/api/v1/teachers')
            .send({ employeeId: 'EMP-1', firstName: 'x' })
            .expect(409)
        ).body,
      ).toMatchObject({ code: 'DUPLICATE_EMPLOYEE_ID' });
      await newTeacher('B', 'EMP-1');
      const assign = (tid: string, body: Record<string, unknown>) =>
        api('A').post(`/api/v1/teachers/${tid}/assignments`).send(body);
      expect(
        (
          await assign(t1.id, {
            type: 'SUBJECT_TEACHER',
            sectionId: ac.A.sectionA,
            subjectId: ac.A.artId,
          }).expect(409)
        ).body,
      ).toMatchObject({ code: 'SUBJECT_NOT_IN_GRADE' });
      await assign(t1.id, { type: 'SUBJECT_TEACHER', sectionId: ac.A.sectionA }).expect(400);
      await assign(t1.id, {
        type: 'CLASS_TEACHER',
        sectionId: ac.A.sectionA,
        subjectId: ac.A.mathId,
      }).expect(400);
      await assign(t1.id, {
        type: 'SUBJECT_TEACHER',
        sectionId: ac.A.sectionA,
        subjectId: ac.A.mathId,
      }).expect(201);
      expect(
        (
          await assign(t1.id, {
            type: 'SUBJECT_TEACHER',
            sectionId: ac.A.sectionA,
            subjectId: ac.A.mathId,
          }).expect(409)
        ).body,
      ).toMatchObject({ code: 'DUPLICATE_ASSIGNMENT' });
      await assign(t2.id, {
        type: 'SUBJECT_TEACHER',
        sectionId: ac.A.sectionA,
        subjectId: ac.A.mathId,
      }).expect(201); // co-teacher
      await assign(t1.id, { type: 'CLASS_TEACHER', sectionId: ac.A.sectionA }).expect(201);
      expect(
        (await assign(t2.id, { type: 'CLASS_TEACHER', sectionId: ac.A.sectionA }).expect(409)).body,
      ).toMatchObject({ code: 'CLASS_TEACHER_EXISTS' });
      expect(
        (await assign(t2.id, { type: 'CLASS_TEACHER', sectionId: ac.A.closedSection }).expect(409))
          .body,
      ).toMatchObject({ code: 'SECTION_UNAVAILABLE' });
      const detail = (await api('A').get(`/api/v1/teachers/${t1.id}`).expect(200))
        .body as TeacherDetail;
      expect(detail.activeAssignments).toBe(2);
      const classA = detail.assignments.find((a) => a.type === 'CLASS_TEACHER');
      expect(classA).toMatchObject({
        sectionName: 'A',
        gradeName: 'Grade 5',
        branchName: 'Main',
        academicYearName: '2026–27',
      });
      await api('A')
        .post(`/api/v1/teachers/${t1.id}/assignments/${classA?.id ?? ''}/end`)
        .expect(200);
      await api('A')
        .post(`/api/v1/teachers/${t1.id}/assignments/${classA?.id ?? ''}/end`)
        .expect(409);
      await assign(t2.id, { type: 'CLASS_TEACHER', sectionId: ac.A.sectionA }).expect(201); // slot free again
      const history = (
        await api('A').get(`/api/v1/teachers/${t1.id}/assignments?includeEnded=true`).expect(200)
      ).body as { endedAt: string | null }[];
      expect(history.filter((a) => a.endedAt !== null)).toHaveLength(1);
      await api('A')
        .post(`/api/v1/teachers/${t2.id}/status`)
        .send({ status: 'INACTIVE' })
        .expect(200);
      expect(
        (
          await assign(t2.id, {
            type: 'SUBJECT_TEACHER',
            sectionId: ac.A.sectionB,
            subjectId: ac.A.mathId,
          }).expect(409)
        ).body,
      ).toMatchObject({ code: 'TEACHER_INACTIVE' });
      const list = (await api('A').get('/api/v1/teachers?status=INACTIVE').expect(200))
        .body as Paginated<TeacherSummary>;
      expect(list.items.map((x) => x.employeeId)).toContain('EMP-2');
    });
  });

  // ---- Accounts -------------------------------------------------------------------------------
  describe('accounts', () => {
    it('creates PENDING accounts with exactly the matching role, never a password', async () => {
      const s = await newStudent('A', 'ACC-S1');
      const created = (await api('A').post(`/api/v1/students/${s.id}/account`).expect(201))
        .body as CreatedAccount;
      expect(created.account.status).toBe('PENDING_ACTIVATION');
      expect(created.activation).toMatchObject({
        method: 'CODE',
        code: expect.stringMatching(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/),
      });
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: created.account.userId },
        include: { roles: { include: { role: true } } },
      });
      expect(user).toMatchObject({
        tenantId: t.A.id,
        status: 'PENDING_ACTIVATION',
        credentialHash: null,
        loginId: 'ACC-S1',
        loginIdKind: 'STUDENT_ID',
      });
      expect(user.roles.map((r) => r.role.key)).toEqual(['STUDENT']);
      expect(created.account.userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/); // uuid v7
      await api('A').post(`/api/v1/students/${s.id}/account`).expect(409); // already linked
      const code2 = (
        await api('A').post(`/api/v1/students/${s.id}/account/activation-code`).expect(200)
      ).body as CreatedAccount;
      expect(code2.activation.method).toBe('CODE');
      // The code activates the account through the normal Phase 3 flow.
      const code = code2.activation.method === 'CODE' ? code2.activation.code : '';
      const grant = await call(app, { host: t.A.domain })
        .post('/api/v1/auth/activation/verify')
        .send({ identifier: 'ACC-S1', code })
        .expect(200);
      await call(app, { host: t.A.domain })
        .post('/api/v1/auth/activation/complete')
        .send({
          grantToken: (grant.body as { grantToken: string }).grantToken,
          credentialType: 'PIN',
          secret: '369147',
        })
        .expect(200);
      expect(
        ((await api('A').get(`/api/v1/students/${s.id}`).expect(200)).body as StudentDetail).account
          ?.status,
      ).toBe('ACTIVE');

      const noPhone = await newParent('A', 'NoPhone');
      expect(
        (await api('A').post(`/api/v1/parents/${noPhone.id}/account`).expect(400)).body,
      ).toMatchObject({ code: 'IDENTIFIER_REQUIRED' });
      const withPhone = await newParent('A', 'HasPhone', { phone: '9822211111' });
      const pa = (await api('A').post(`/api/v1/parents/${withPhone.id}/account`).expect(201))
        .body as CreatedAccount;
      expect(pa.activation).toEqual({ method: 'OTP' }); // self-service OTP to the phone
      await api('A').post(`/api/v1/parents/${withPhone.id}/account/activation-code`).expect(409);
      // Same phone for another parent account in the tenant → link instead.
      const twin = await newParent('A', 'Twin', { phone: '9822211111' });
      expect(
        (await api('A').post(`/api/v1/parents/${twin.id}/account`).expect(409)).body,
      ).toMatchObject({ code: 'IDENTIFIER_TAKEN' });
      const te = await newTeacher('A', 'ACC-T1', { email: 'acc.t1@ppl-a.test' });
      expect(
        (
          (await api('A').post(`/api/v1/teachers/${te.id}/account`).expect(201))
            .body as CreatedAccount
        ).activation,
      ).toEqual({ method: 'OTP' });
    });

    it('links an existing account only when it already holds the role (Teacher + Parent = one login)', async () => {
      const both = await createTenantUser(app, {
        tenantId: t.A.id,
        roles: ['TEACHER', 'PARENT'],
        email: 'both@ppl-a.test',
        phone: '+919833300001',
        secret: PW,
      });
      const onlyTeacher = await createTenantUser(app, {
        tenantId: t.A.id,
        roles: ['TEACHER'],
        email: 'only.t@ppl-a.test',
        secret: PW,
      });
      const te = await newTeacher('A', 'LNK-T');
      const pa = await newParent('A', 'Linky');
      await api('A')
        .post(`/api/v1/teachers/${te.id}/account/link`)
        .send({ userId: both })
        .expect(200);
      await api('A')
        .post(`/api/v1/parents/${pa.id}/account/link`)
        .send({ userId: both })
        .expect(200);
      const pb = await newParent('A', 'NoRole');
      expect(
        (
          await api('A')
            .post(`/api/v1/parents/${pb.id}/account/link`)
            .send({ userId: onlyTeacher })
            .expect(409)
        ).body,
      ).toMatchObject({ code: 'ROLE_REQUIRED' });
      const te2 = await newTeacher('A', 'LNK-T2');
      expect(
        (
          await api('A')
            .post(`/api/v1/teachers/${te2.id}/account/link`)
            .send({ userId: both })
            .expect(409)
        ).body,
      ).toMatchObject({ code: 'USER_ALREADY_LINKED' });
      // Cross-tenant user → not found (and the DB FK would refuse it anyway).
      const bUser = await createTenantUser(app, {
        tenantId: t.B.id,
        roles: ['TEACHER'],
        email: 'b.t@ppl-b.test',
        secret: PW,
      });
      expect(
        (
          await api('A')
            .post(`/api/v1/teachers/${te2.id}/account/link`)
            .send({ userId: bUser })
            .expect(404)
        ).body,
      ).toMatchObject({ code: 'USER_NOT_FOUND' });
      // Only one role grant exists — nothing was granted silently.
      expect(await prisma.userRole.count({ where: { userId: onlyTeacher } })).toBe(1);
    });

    it('profile status and account status are independent; a SUSPENDED account still cannot sign in', async () => {
      const user = await createTenantUser(app, {
        tenantId: t.A.id,
        roles: ['TEACHER'],
        email: 'susp@ppl-a.test',
        secret: PW,
      });
      const te = await newTeacher('A', 'SUSP-1');
      await api('A')
        .post(`/api/v1/teachers/${te.id}/account/link`)
        .send({ userId: user })
        .expect(200);
      await api('A')
        .post(`/api/v1/teachers/${te.id}/status`)
        .send({ status: 'INACTIVE' })
        .expect(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user } })).status).toBe('ACTIVE');
      await api('A')
        .post(`/api/v1/teachers/${te.id}/status`)
        .send({ status: 'ACTIVE' })
        .expect(200);
      await prisma.user.update({ where: { id: user }, data: { status: 'SUSPENDED' } });
      await call(app, { host: t.A.domain })
        .post('/api/v1/auth/login')
        .send({ identifier: 'susp@ppl-a.test', secret: PW })
        .expect(401);
      expect(
        ((await api('A').get(`/api/v1/teachers/${te.id}`).expect(200)).body as TeacherDetail)
          .account?.status,
      ).toBe('SUSPENDED');
    });
  });

  // ---- Cross-tenant & cross-school -------------------------------------------------------------
  describe('isolation', () => {
    it('A→B, B→C, C→A: no read, update, link, enroll or assign across tenants', async () => {
      const ids = {} as Record<
        FixtureLetter,
        {
          student: string;
          parent: string;
          teacher: string;
          link: string;
          enrollment: string;
          user: string;
        }
      >;
      for (const l of FIXTURE_LETTERS) {
        const p = await newParent(l, `Secret Parent ${l}`);
        const s = await newStudent(l, `ISO-${l}`, {
          firstName: `Secret Student ${l}`,
          enrollment: { sectionId: ac[l].sectionA },
          guardians: [{ parentId: p.id, relationship: 'MOTHER' }],
        });
        const te = await newTeacher(l, `ISO-${l}`, { firstName: `Secret Teacher ${l}` });
        const u = await createTenantUser(app, {
          tenantId: t[l].id,
          roles: ['TEACHER', 'PARENT', 'STUDENT'],
          email: `iso@ppl-${l.toLowerCase()}.test`,
          secret: PW,
        });
        ids[l] = {
          student: s.id,
          parent: p.id,
          teacher: te.id,
          link: s.guardians[0]?.id ?? '',
          enrollment: s.enrollments[0]?.enrollmentId ?? '',
          user: u,
        };
      }
      for (const [me, v] of [
        ['A', 'B'],
        ['B', 'C'],
        ['C', 'A'],
      ] as const) {
        const o = ids[v];
        const mine = ids[me];
        const probes: [string, string, Record<string, unknown>?][] = [
          ['get', `/api/v1/students/${o.student}`],
          ['patch', `/api/v1/students/${o.student}`, { firstName: 'pwned' }],
          ['post', `/api/v1/students/${o.student}/status`, { status: 'INACTIVE' }],
          ['get', `/api/v1/students/${o.student}/enrollments`],
          [
            'post',
            `/api/v1/students/${o.student}/enrollments/${o.enrollment}/end`,
            { status: 'WITHDRAWN' },
          ],
          ['patch', `/api/v1/students/${o.student}/guardians/${o.link}`, { isPrimary: true }],
          ['delete', `/api/v1/students/${o.student}/guardians/${o.link}`],
          ['post', `/api/v1/students/${o.student}/account`],
          ['get', `/api/v1/parents/${o.parent}`],
          ['patch', `/api/v1/parents/${o.parent}`, { firstName: 'pwned' }],
          ['get', `/api/v1/teachers/${o.teacher}`],
          ['post', `/api/v1/teachers/${o.teacher}/status`, { status: 'INACTIVE' }],
          // Linking my records to theirs.
          [
            'post',
            `/api/v1/students/${mine.student}/guardians`,
            { parentId: o.parent, relationship: 'OTHER' },
          ],
          [
            'post',
            `/api/v1/students/${mine.student}/enrollments/${mine.enrollment}/transfer`,
            { sectionId: ac[v].sectionB },
          ],
          [
            'post',
            `/api/v1/teachers/${mine.teacher}/assignments`,
            { type: 'SUBJECT_TEACHER', sectionId: ac[v].sectionA, subjectId: ac[v].mathId },
          ],
          [
            'post',
            `/api/v1/teachers/${mine.teacher}/assignments`,
            { type: 'SUBJECT_TEACHER', sectionId: ac[me].sectionB, subjectId: ac[v].mathId },
          ],
          ['post', `/api/v1/teachers/${mine.teacher}/account/link`, { userId: o.user }],
        ];
        for (const [method, path, body] of probes) {
          const req = api(me)[method as 'get'](path);
          const res = body ? await req.send(body) : await req;
          expect([400, 404], `${me}→${v} ${method} ${path}`).toContain(res.status);
          expect(JSON.stringify(res.body)).not.toContain('Secret');
        }
        expect(
          (await call(app, { host: t[v].domain, token: token[me] }).get('/api/v1/students')).status,
        ).toBe(403);
        const list = JSON.stringify(
          (await api(me).get('/api/v1/students?pageSize=100').expect(200)).body,
        );
        expect(list).not.toContain(`Secret Student ${v}`);
      }
      for (const l of FIXTURE_LETTERS) {
        const s = await prisma.student.findUniqueOrThrow({ where: { id: ids[l].student } });
        expect(s).toMatchObject({ firstName: `Secret Student ${l}`, status: 'ACTIVE' });
        expect(await prisma.studentGuardian.count({ where: { studentId: ids[l].student } })).toBe(
          1,
        );
        expect(await prisma.teacherAssignment.count({ where: { teacherId: ids[l].teacher } })).toBe(
          0,
        );
      }
    });

    it('same tenant, second school: its sections/subjects/parents are not reachable', async () => {
      const second = await prisma.school.create({
        data: { tenantId: t.A.id, name: 'Second A', timezone: 'UTC', workingDays: ['MONDAY'] },
      });
      const other = await createAcademicFixture(prisma, t.A.id, second.id);
      const otherParent = await prisma.parent.create({
        data: { tenantId: t.A.id, schoolId: second.id, firstName: 'Other school parent' },
      });
      try {
        const s = await newStudent('A', 'XSCH-1');
        const te = await newTeacher('A', 'XSCH-T');
        expect(
          (
            await api('A')
              .post(`/api/v1/students/${s.id}/enrollments`)
              .send({ sectionId: other.sectionA })
              .expect(404)
          ).body,
        ).toMatchObject({ code: 'SECTION_NOT_FOUND' });
        await api('A')
          .post(`/api/v1/students/${s.id}/guardians`)
          .send({ parentId: otherParent.id, relationship: 'OTHER' })
          .expect(404);
        await api('A')
          .post(`/api/v1/teachers/${te.id}/assignments`)
          .send({ type: 'CLASS_TEACHER', sectionId: other.sectionA })
          .expect(404);
        await api('A')
          .post(`/api/v1/teachers/${te.id}/assignments`)
          .send({ type: 'SUBJECT_TEACHER', sectionId: ac.A.sectionB, subjectId: other.mathId })
          .expect(404);
      } finally {
        await prisma.parent.delete({ where: { id: otherParent.id } });
        await prisma.gradeSubject.deleteMany({ where: { schoolId: second.id } });
        await prisma.section.deleteMany({ where: { schoolId: second.id } });
        await prisma.subject.deleteMany({ where: { schoolId: second.id } });
        await prisma.grade.deleteMany({ where: { schoolId: second.id } });
        await prisma.academicYear.deleteMany({ where: { schoolId: second.id } });
        await prisma.branch.deleteMany({ where: { schoolId: second.id } });
        await prisma.school.delete({ where: { id: second.id } });
      }
    });
  });

  // ---- Concurrency ----------------------------------------------------------------------------
  describe('concurrency', () => {
    it('duplicate admission numbers / employee IDs: exactly one wins', async () => {
      const s = await Promise.all(
        Array.from({ length: 6 }, () =>
          api('B').post('/api/v1/students').send({ admissionNumber: 'RACE-1', firstName: 'Race' }),
        ),
      );
      expect(s.filter((r) => r.status === 201)).toHaveLength(1);
      expect(s.filter((r) => r.status === 409)).toHaveLength(5);
      const te = await Promise.all(
        Array.from({ length: 6 }, () =>
          api('B').post('/api/v1/teachers').send({ employeeId: 'RACE-T', firstName: 'Race' }),
        ),
      );
      expect(te.filter((r) => r.status === 201)).toHaveLength(1);
      expect(
        await prisma.student.count({ where: { schoolId: school.B, admissionNumber: 'RACE-1' } }),
      ).toBe(1);
    });

    it('concurrent enrollments and guardian links keep the invariants', async () => {
      const s = await newStudent('B', 'RACE-E');
      const e = await Promise.all(
        [ac.B.sectionA, ac.B.sectionB, ac.B.sectionA, ac.B.sectionB].map((sectionId) =>
          api('B').post(`/api/v1/students/${s.id}/enrollments`).send({ sectionId }),
        ),
      );
      expect(e.filter((r) => r.status === 201)).toHaveLength(1);
      expect(e.every((r) => r.status === 201 || r.status === 409)).toBe(true);
      expect(
        await prisma.studentEnrollment.count({ where: { studentId: s.id, status: 'ACTIVE' } }),
      ).toBe(1);
      const p = await newParent('B', 'RaceParent');
      const g = await Promise.all(
        Array.from({ length: 5 }, () =>
          api('B')
            .post(`/api/v1/students/${s.id}/guardians`)
            .send({ parentId: p.id, relationship: 'MOTHER', isPrimary: true }),
        ),
      );
      expect(g.filter((r) => r.status === 201)).toHaveLength(1);
      expect(await prisma.studentGuardian.count({ where: { studentId: s.id } })).toBe(1);
      const parents = await Promise.all(
        Array.from({ length: 3 }, (_, i) => newParent('B', `Pri ${String(i)}`)),
      );
      await Promise.all(
        parents.map((pp) =>
          api('B')
            .post(`/api/v1/students/${s.id}/guardians`)
            .send({ parentId: pp.id, relationship: 'OTHER', isPrimary: true }),
        ),
      );
      expect(
        await prisma.studentGuardian.count({ where: { studentId: s.id, isPrimary: true } }),
      ).toBe(1);
    });
  });

  // ---- Audit ----------------------------------------------------------------------------------
  it('audits Phase 5 mutations with the real actor and no personal data values', async () => {
    const edited = await newStudent('A', 'AUD-1');
    await api('A')
      .patch(`/api/v1/students/${edited.id}`)
      .send({ preferredName: 'Audi' })
      .expect(200);
    const rows = await prisma.auditLog.findMany({ where: { tenantId: t.A.id } });
    const actions = new Set(rows.map((r) => r.action));
    for (const a of [
      'STUDENT_CREATED',
      'STUDENT_UPDATED',
      'STUDENT_STATUS_CHANGED',
      'PARENT_CREATED',
      'PARENT_DEACTIVATED',
      'GUARDIAN_LINKED',
      'GUARDIAN_UPDATED',
      'GUARDIAN_UNLINKED',
      'ENROLLMENT_CREATED',
      'ENROLLMENT_TRANSFERRED',
      'ENROLLMENT_UPDATED',
      'TEACHER_CREATED',
      'TEACHER_STATUS_CHANGED',
      'TEACHER_ASSIGNMENT_CREATED',
      'TEACHER_ASSIGNMENT_REMOVED',
      'PROFILE_ACCOUNT_CREATED',
      'PROFILE_ACCOUNT_LINKED',
      'ACTIVATION_CODE_ISSUED',
    ]) {
      expect(actions.has(a), a).toBe(true);
    }
    const created = rows.find(
      (r) => r.action === 'STUDENT_CREATED' && r.actorUserId === userId.principal,
    );
    expect(created?.requestId).toBeTruthy();
    const serialized = JSON.stringify(rows.map((r) => r.metadata));
    for (const pii of ['+9198', 'meera@example.com', '2016-02-29', "D'Souza"])
      expect(serialized).not.toContain(pii);
  });
});
