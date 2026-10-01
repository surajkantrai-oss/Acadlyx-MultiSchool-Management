import type { Paginated } from '@acadlyx/tenant-config';
import type {
  AssignmentGrading,
  ClassResults,
  ExamDetail,
  MarkSheet,
  MarkSheetSummary,
  MobileWorkItem,
  PublishedResultSummary,
  ReportCard,
  ResultPublicationSummary,
} from '@acadlyx/types';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type request from 'supertest';
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

const PREFIX = 'ASM';
const PW = 'Assessment-pass-2026';
const PIN = '615243';
type Who =
  | 'principal'
  | 'teacher'
  | 'teacher2'
  | 'accountant'
  | 'parent'
  | 'parent2'
  | 'student'
  | 'student2';

/**
 * Phase 9 (e2e): grade scales, exam lifecycle/structure/branch schedules, mark sheets (draft →
 * submit → finalize → reopen with reason, history, races), canonical results, immutable versioned
 * publication, report cards (parent/student self-service), class-teacher overview + remarks,
 * assignment grading per submission version, and A→B/B→C/C→A + same-tenant school isolation.
 */
describe('Exams, marks, results & grading (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PlatformPrismaService;
  let t: Record<FixtureLetter, FixtureTenant>;
  let school: Record<FixtureLetter, string>;
  const ac = {} as Record<FixtureLetter, AcademicFixture & { sciId: string }>;
  const tok = {} as Record<FixtureLetter, Partial<Record<Who, string>>>;
  const ids = {} as Record<FixtureLetter, { s1: string; s2: string; s3: string; s4: string }>;
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
      const base = await createAcademicFixture(prisma, t[l].id, school[l]);
      const sci = await prisma.subject.create({ data: { ...scope, name: 'Science', code: 'SCI' } });
      await prisma.gradeSubject.create({
        data: { ...scope, gradeId: base.gradeId, subjectId: sci.id },
      });
      ac[l] = { ...base, sciId: sci.id };
      const lc = l.toLowerCase();
      const user = async (
        who: Who,
        roles: string[],
        login: Record<string, string>,
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
      await user('principal', ['PRINCIPAL'], { email: `principal@asm-${lc}.test` });
      const tU = await user('teacher', ['TEACHER'], { email: `teacher@asm-${lc}.test` });
      const t2U = await user('teacher2', ['TEACHER'], { email: `teacher2@asm-${lc}.test` });
      await user('accountant', ['ACCOUNTANT'], { email: `acc@asm-${lc}.test` });
      const n = String(FIXTURE_LETTERS.indexOf(l));
      const pU = await user('parent', ['PARENT'], { phone: `+9198666000${n}1` }, true);
      const p2U = await user('parent2', ['PARENT'], { phone: `+9198666000${n}2` }, true);
      const sU = await user('student', ['STUDENT'], { loginId: `AS-${l}-1` }, true);
      const s2U = await user('student2', ['STUDENT'], { loginId: `AS-${l}-2` }, true);
      const st = (k: string, userId: string | null) =>
        prisma.student.create({
          data: {
            ...scope,
            admissionNumber: `AS-${k}`,
            firstName: `Asmk${k}`,
            lastName: l,
            userId,
          },
        });
      const [s1, s2, s3, s4] = [
        await st('1', sU),
        await st('2', s2U),
        await st('3', null),
        await st('4', null),
      ];
      const enroll = (studentId: string, sectionId: string, start: string, end?: string) =>
        prisma.studentEnrollment.create({
          data: {
            ...scope,
            studentId,
            sectionId,
            academicYearId: base.yearId,
            startDate: new Date(start),
            endDate: end ? new Date(end) : null,
            status: end ? 'TRANSFERRED' : 'ACTIVE',
          },
        });
      await enroll(s1.id, base.sectionA, '2026-04-01');
      await enroll(s2.id, base.sectionA, '2026-04-01');
      await enroll(s3.id, base.sectionB, '2026-04-01');
      // s4 sits the 6 Oct maths paper in 5 A, then moves to 5 B on 8 Oct (decision H).
      await enroll(s4.id, base.sectionA, '2026-04-01', '2026-10-08');
      await enroll(s4.id, base.sectionB, '2026-10-08');
      ids[l] = { s1: s1.id, s2: s2.id, s3: s3.id, s4: s4.id };
      const parent = await prisma.parent.create({
        data: { ...scope, firstName: 'Asmp', userId: pU },
      });
      const parent2 = await prisma.parent.create({
        data: { ...scope, firstName: 'Asmq', userId: p2U },
      });
      await prisma.studentGuardian.create({
        data: { ...scope, studentId: s1.id, parentId: parent.id, relationship: 'MOTHER' },
      });
      await prisma.studentGuardian.create({
        data: { ...scope, studentId: s3.id, parentId: parent2.id, relationship: 'FATHER' },
      });
      const teacher = await prisma.teacher.create({
        data: { ...scope, employeeId: 'AT-1', firstName: 'Asmt', userId: tU },
      });
      const teacher2 = await prisma.teacher.create({
        data: { ...scope, employeeId: 'AT-2', firstName: 'Asmu', userId: t2U },
      });
      // teacher: Maths in 5 A + class teacher of 5 A. teacher2: Maths in 5 B only.
      await prisma.teacherAssignment.createMany({
        data: [
          {
            ...scope,
            teacherId: teacher.id,
            sectionId: base.sectionA,
            subjectId: base.mathId,
            type: 'SUBJECT_TEACHER',
          },
          {
            ...scope,
            teacherId: teacher.id,
            sectionId: base.sectionA,
            subjectId: null,
            type: 'CLASS_TEACHER',
          },
          {
            ...scope,
            teacherId: teacher2.id,
            sectionId: base.sectionB,
            subjectId: base.mathId,
            type: 'SUBJECT_TEACHER',
          },
        ],
      });
    }
  }, 300_000);

  afterAll(async () => {
    await purgeTenants(prisma, PREFIX);
    await app.close();
  });

  beforeEach(async () => {
    await resetRateLimits(app);
  });

  const BANDS = [
    { label: 'A1', minPercentage: '90', maxPercentage: '100' },
    { label: 'A2', minPercentage: '80', maxPercentage: '90' },
    { label: 'B', minPercentage: '33', maxPercentage: '80' },
    { label: 'E', minPercentage: '0', maxPercentage: '33' },
  ];
  const state = {} as Record<
    FixtureLetter,
    {
      exam: string;
      math: string;
      sci: string;
      mWritten: string;
      sTheory: string;
      sPractical: string;
    }
  >;

  /** Build and publish the Mid Term of a tenant; returns its detail. */
  async function setupExam(l: FixtureLetter, name = 'Mid Term'): Promise<ExamDetail> {
    const p = (path: string) => as('principal', l).post(path);
    const scale = (
      await p('/api/v1/grade-scales')
        .send({ academicYearId: ac[l].yearId, name: `CBSE ${name}`, bands: BANDS })
        .expect(201)
    ).body as { id: string; name: string }[];
    const scaleId = scale.find((s) => s.name === `CBSE ${name}`)?.id;
    let exam = (
      await p('/api/v1/exams')
        .send({
          academicYearId: ac[l].yearId,
          name,
          startDate: '2026-10-05',
          endDate: '2026-10-20',
          gradeScaleId: scaleId,
        })
        .expect(201)
    ).body as ExamDetail;
    exam = (
      await p(`/api/v1/exams/${exam.id}/subjects`)
        .send({ gradeId: ac[l].gradeId, subjectId: ac[l].mathId, passMarks: '33' })
        .expect(201)
    ).body as ExamDetail;
    exam = (
      await p(`/api/v1/exams/${exam.id}/subjects`)
        .send({ gradeId: ac[l].gradeId, subjectId: ac[l].sciId, passMarks: '33', displayOrder: 1 })
        .expect(201)
    ).body as ExamDetail;
    const math = exam.subjects.find((s) => s.subjectName === 'Mathematics')?.id ?? '';
    const sci = exam.subjects.find((s) => s.subjectName === 'Science')?.id ?? '';
    exam = (
      await p(`/api/v1/exams/${exam.id}/subjects/${math}/components`)
        .send({ name: 'Written', maxMarks: '100' })
        .expect(201)
    ).body as ExamDetail;
    exam = (
      await p(`/api/v1/exams/${exam.id}/subjects/${sci}/components`)
        .send({ name: 'Theory', maxMarks: '80', passMarks: '26' })
        .expect(201)
    ).body as ExamDetail;
    exam = (
      await p(`/api/v1/exams/${exam.id}/subjects/${sci}/components`)
        .send({ name: 'Practical', maxMarks: '20' })
        .expect(201)
    ).body as ExamDetail;
    const comp = (subject: string, c: string) =>
      exam.subjects.find((s) => s.id === subject)?.components.find((x) => x.name === c)?.id ?? '';
    const ids2 = {
      mWritten: comp(math, 'Written'),
      sTheory: comp(sci, 'Theory'),
      sPractical: comp(sci, 'Practical'),
    };
    const sched = (cid: string, examDate: string, startTime: string, endTime: string) =>
      as('principal', l)
        .put(`/api/v1/exams/${exam.id}/components/${cid}/schedules/${ac[l].branchId}`)
        .send({ examDate, startTime, endTime });
    await sched(ids2.mWritten, '2026-10-06', '09:00', '12:00').expect(200);
    await sched(ids2.sTheory, '2026-10-10', '09:00', '12:00').expect(200);
    exam = (await sched(ids2.sPractical, '2026-10-12', '09:00', '11:00').expect(200))
      .body as ExamDetail;
    state[l] = { exam: exam.id, math, sci, ...ids2 };
    return exam;
  }
  const version = async (l: FixtureLetter, examId = state[l].exam) =>
    ((await as('principal', l).get(`/api/v1/exams/${examId}`).expect(200)).body as ExamDetail)
      .version;
  const step = async (l: FixtureLetter, action: string, code = 201) =>
    as('principal', l)
      .post(`/api/v1/exams/${state[l].exam}/transitions/${action}`)
      .send({ expectedVersion: await version(l) })
      .expect(code);
  const sheetPath = (l: FixtureLetter, subject: string, section: string) =>
    `/api/v1/exams/${state[l].exam}/sheets/${subject}/${section}`;
  const sheet = async (who: Who, l: FixtureLetter, subject: string, section: string) =>
    (
      await as(who, l)
        .get(sheetPath(l, subject, section))
        .expect(200)
    ).body as MarkSheet;
  /** Lets an async-built request be used as `await x.expect(code)` or `await x` (response). */
  const lazy = (mk: () => Promise<{ req: request.Test }>) => {
    const p = mk();
    return {
      expect: (code: number) => p.then(({ req }) => req.expect(code)),
      then: <T>(ok: (r: request.Response) => T, bad?: (e: unknown) => T) =>
        p.then(({ req }) => req).then(ok, bad),
    };
  };
  const save = (
    who: Who,
    l: FixtureLetter,
    subject: string,
    section: string,
    entries: unknown[],
    expected?: number,
  ) =>
    lazy(async () => ({
      req: as(who, l)
        .put(sheetPath(l, subject, section))
        .send({
          expectedVersion: expected ?? (await sheet('principal', l, subject, section)).version,
          entries,
        }),
    }));
  const act = (
    who: Who,
    l: FixtureLetter,
    subject: string,
    section: string,
    a: string,
    extra: Record<string, unknown> = {},
  ) =>
    lazy(async () => ({
      req: as(who, l)
        .post(`${sheetPath(l, subject, section)}/${a}`)
        .send({
          expectedVersion: (await sheet('principal', l, subject, section)).version,
          ...extra,
        }),
    }));
  const M = (studentId: string, componentId: string, marks: string) => ({
    studentId,
    componentId,
    status: 'MARKED',
    marks,
  });

  describe('grade scales', () => {
    it('bands must tile 0–100 exactly; labels unique; only leadership configures', async () => {
      const post = (bands: unknown, who: Who = 'principal') =>
        as(who)
          .post('/api/v1/grade-scales')
          .send({ academicYearId: ac.A.yearId, name: `S-${String(Math.random())}`, bands });
      expect(
        (
          await post([
            { label: 'A', minPercentage: '0', maxPercentage: '50' },
            { label: 'B', minPercentage: '60', maxPercentage: '100' },
          ]).expect(400)
        ).body.code,
      ).toBe('GRADE_SCALE_INVALID');
      expect(
        (
          await post([
            { label: 'A', minPercentage: '0', maxPercentage: '60' },
            { label: 'B', minPercentage: '50', maxPercentage: '100' },
          ]).expect(400)
        ).body.code,
      ).toBe('GRADE_SCALE_INVALID');
      expect(
        (
          await post([
            { label: 'A', minPercentage: '0', maxPercentage: '50' },
            { label: 'a', minPercentage: '50', maxPercentage: '100' },
          ]).expect(400)
        ).body.code,
      ).toBe('GRADE_SCALE_INVALID');
      await post([{ label: 'A', minPercentage: '0', maxPercentage: '101' }]).expect(400);
      await post(BANDS, 'teacher').expect(403);
      await post(BANDS).expect(201);
    });
  });

  describe('exam structure and lifecycle', () => {
    it('validates dates, grade subjects, pass marks, branch schedules and conflicts', async () => {
      const p = (path: string) => as('principal').post(path);
      expect(
        (
          await p('/api/v1/exams')
            .send({
              academicYearId: ac.A.yearId,
              name: 'Bad',
              startDate: '2027-05-01',
              endDate: '2027-05-02',
            })
            .expect(400)
        ).body.code,
      ).toBe('EXAM_DATES_INVALID');
      expect(
        (
          await p('/api/v1/exams')
            .send({
              academicYearId: ac.A.closedYearId,
              name: 'Old',
              startDate: '2025-10-01',
              endDate: '2025-10-02',
            })
            .expect(400)
        ).body.code,
      ).toBe('ACADEMIC_YEAR_CLOSED');
      const exam = (
        await p('/api/v1/exams')
          .send({
            academicYearId: ac.A.yearId,
            name: 'Unit Test 1',
            startDate: '2026-07-01',
            endDate: '2026-07-10',
          })
          .expect(201)
      ).body as ExamDetail;
      expect(
        (
          await p('/api/v1/exams')
            .send({
              academicYearId: ac.A.yearId,
              name: 'UNIT test 1',
              startDate: '2026-07-01',
              endDate: '2026-07-10',
            })
            .expect(409)
        ).body.code,
      ).toBe('EXAM_NAME_TAKEN');
      expect(
        (
          await p(`/api/v1/exams/${exam.id}/subjects`)
            .send({ gradeId: ac.A.gradeId, subjectId: ac.A.artId })
            .expect(400)
        ).body.code,
      ).toBe('SUBJECT_NOT_IN_GRADE');
      const withMath = (
        await p(`/api/v1/exams/${exam.id}/subjects`)
          .send({ gradeId: ac.A.gradeId, subjectId: ac.A.mathId })
          .expect(201)
      ).body as ExamDetail;
      const sid = withMath.subjects[0]?.id ?? '';
      expect(
        (
          await p(`/api/v1/exams/${exam.id}/subjects/${sid}/components`)
            .send({ name: 'Theory', maxMarks: '50', passMarks: '60' })
            .expect(400)
        ).body.code,
      ).toBe('PASS_MARKS_INVALID');
      const withComp = (
        await p(`/api/v1/exams/${exam.id}/subjects/${sid}/components`)
          .send({ name: 'Theory', maxMarks: '50', passMarks: '17' })
          .expect(201)
      ).body as ExamDetail;
      await p(`/api/v1/exams/${exam.id}/subjects/${sid}/components`)
        .send({ name: 'THEORY', maxMarks: '10' })
        .expect(409);
      await as('principal')
        .patch(`/api/v1/exams/${exam.id}/subjects/${sid}`)
        .send({ passMarks: '51' })
        .expect(400);
      // Publishing needs a schedule for every branch with an active section of the grade.
      expect(
        (
          await as('principal')
            .post(`/api/v1/exams/${exam.id}/transitions/publish`)
            .send({ expectedVersion: withComp.version })
            .expect(400)
        ).body.code,
      ).toBe('EXAM_STRUCTURE_INCOMPLETE');
      const cid = withComp.subjects[0]?.components[0]?.id ?? '';
      await as('principal')
        .put(`/api/v1/exams/${exam.id}/components/${cid}/schedules/${ac.A.branchId}`)
        .send({ examDate: '2026-08-01', startTime: '09:00', endTime: '10:00' })
        .expect(400);
      // A second component of the same exam + grade + branch may not overlap.
      const two = (
        await p(`/api/v1/exams/${exam.id}/subjects/${sid}/components`)
          .send({ name: 'Oral', maxMarks: '10' })
          .expect(201)
      ).body as ExamDetail;
      const oral = two.subjects[0]?.components.find((c) => c.name === 'Oral')?.id ?? '';
      await as('principal')
        .put(`/api/v1/exams/${exam.id}/components/${cid}/schedules/${ac.A.branchId}`)
        .send({ examDate: '2026-07-02', startTime: '09:00', endTime: '11:00' })
        .expect(200);
      expect(
        (
          await as('principal')
            .put(`/api/v1/exams/${exam.id}/components/${oral}/schedules/${ac.A.branchId}`)
            .send({ examDate: '2026-07-02', startTime: '10:30', endTime: '11:30' })
            .expect(409)
        ).body.code,
      ).toBe('SCHEDULE_CONFLICT');
      const ok = (
        await as('principal')
          .put(`/api/v1/exams/${exam.id}/components/${oral}/schedules/${ac.A.branchId}`)
          .send({ examDate: '2026-07-02', startTime: '11:00', endTime: '11:30' })
          .expect(200)
      ).body as ExamDetail;
      // Teachers never see drafts.
      await as('teacher').get(`/api/v1/exams/${exam.id}`).expect(404);
      const published = (
        await as('principal')
          .post(`/api/v1/exams/${exam.id}/transitions/publish`)
          .send({ expectedVersion: ok.version })
          .expect(201)
      ).body as ExamDetail;
      expect(published.status).toBe('PUBLISHED');
      await as('teacher').get(`/api/v1/exams/${exam.id}`).expect(200);
      // Structure is locked after publication; no skipping states; no delete once published.
      expect(
        (
          await p(`/api/v1/exams/${exam.id}/subjects/${sid}/components`)
            .send({ name: 'X', maxMarks: '5' })
            .expect(409)
        ).body.code,
      ).toBe('EXAM_NOT_EDITABLE');
      await as('principal')
        .post(`/api/v1/exams/${exam.id}/transitions/archive`)
        .send({ expectedVersion: published.version })
        .expect(409);
      expect((await as('principal').delete(`/api/v1/exams/${exam.id}`).expect(409)).body.code).toBe(
        'EXAM_HAS_DATA',
      );
      // A draft without data can be deleted; teachers cannot manage exams.
      const d = (
        await p('/api/v1/exams')
          .send({
            academicYearId: ac.A.yearId,
            name: 'Temp',
            startDate: '2026-07-01',
            endDate: '2026-07-02',
          })
          .expect(201)
      ).body as ExamDetail;
      await as('teacher').delete(`/api/v1/exams/${d.id}`).expect(403);
      await as('principal').delete(`/api/v1/exams/${d.id}`).expect(204);
      await as('accountant').get('/api/v1/exams').expect(403);
    });
  });

  describe('marks workflow', () => {
    it('setup: Mid Term published and open for marks in every tenant', async () => {
      for (const l of FIXTURE_LETTERS) {
        await setupExam(l);
        await step(l, 'publish');
        await step(l, 'open-marks');
      }
    });

    it('teacher sees only their Section + Subject sheet; eligibility follows enrollment history', async () => {
      const list = (await as('teacher').get(`/api/v1/exams/${state.A.exam}/sheets`).expect(200))
        .body as Paginated<MarkSheetSummary>;
      expect(list.items.map((s) => [s.className, s.subjectName])).toEqual([
        ['Grade 5 A', 'Mathematics'],
      ]);
      expect(list).toMatchObject({ page: 1, total: 1, totalPages: 1 });
      // Leadership: paginated summary rows (2 subjects × 2 sections = 4 sheets).
      const p1 = (
        await as('principal').get(`/api/v1/exams/${state.A.exam}/sheets?pageSize=3`).expect(200)
      ).body as Paginated<MarkSheetSummary>;
      expect(p1).toMatchObject({ total: 4, totalPages: 2 });
      expect(p1.items).toHaveLength(3);
      const p2 = (
        await as('principal')
          .get(`/api/v1/exams/${state.A.exam}/sheets?page=2&pageSize=3`)
          .expect(200)
      ).body as Paginated<MarkSheetSummary>;
      expect(p2.items).toHaveLength(1);
      await as('principal').get(`/api/v1/exams/${state.A.exam}/sheets?pageSize=101`).expect(400);
      const math5A = await sheet('teacher', 'A', state.A.math, ac.A.sectionA);
      expect(math5A.students.map((s) => s.studentId).sort()).toEqual(
        [ids.A.s1, ids.A.s2, ids.A.s4].sort(),
      );
      const sci5A = await sheet('principal', 'A', state.A.sci, ac.A.sectionA);
      expect(sci5A.students.map((s) => s.studentId).sort()).toEqual([ids.A.s1, ids.A.s2].sort());
      await as('teacher')
        .get(sheetPath('A', state.A.sci, ac.A.sectionA))
        .expect(404);
      await as('teacher')
        .get(sheetPath('A', state.A.math, ac.A.sectionB))
        .expect(404);
      await as('teacher2')
        .get(sheetPath('A', state.A.math, ac.A.sectionA))
        .expect(404);
    });

    it('rejects impossible marks, sentinel values and ineligible students', async () => {
      const bad = async (e: unknown): Promise<string> =>
        (
          (await save('teacher', 'A', state.A.math, ac.A.sectionA, [e]).expect(400)).body as {
            code: string;
          }
        ).code;
      expect(await bad(M(ids.A.s1, state.A.mWritten, '100.01'))).toBe('INVALID_MARK');
      expect(await bad(M(ids.A.s1, state.A.mWritten, '-1'))).toBe('INVALID_MARK');
      expect(await bad(M(ids.A.s1, state.A.mWritten, '12.345'))).toBe('INVALID_MARK');
      expect(await bad(M(ids.A.s1, state.A.mWritten, 'AB'))).toBe('INVALID_MARK');
      expect(
        await bad({
          studentId: ids.A.s1,
          componentId: state.A.mWritten,
          status: 'ABSENT',
          marks: '0',
        }),
      ).toBe('INVALID_MARK');
      expect(await bad(M(ids.A.s3, state.A.mWritten, '10'))).toBe('STUDENT_NOT_ELIGIBLE');
    });

    it('draft → submit (complete only) → locked for teacher → leadership finalizes', async () => {
      const r = await save('teacher', 'A', state.A.math, ac.A.sectionA, [
        M(ids.A.s1, state.A.mWritten, '91'),
        { studentId: ids.A.s2, componentId: state.A.mWritten, status: 'ABSENT' },
      ]).expect(200);
      expect((r.body as MarkSheet).status).toBe('DRAFT');
      expect(
        (await act('teacher', 'A', state.A.math, ac.A.sectionA, 'submit').expect(409)).body.code,
      ).toBe('MARKS_INCOMPLETE');
      await save('teacher', 'A', state.A.math, ac.A.sectionA, [
        M(ids.A.s4, state.A.mWritten, '40.5'),
      ]).expect(200);
      expect(
        (
          (await act('teacher', 'A', state.A.math, ac.A.sectionA, 'submit').expect(201))
            .body as MarkSheet
        ).status,
      ).toBe('SUBMITTED');
      expect(
        (
          await save('teacher', 'A', state.A.math, ac.A.sectionA, [
            M(ids.A.s1, state.A.mWritten, '92'),
          ]).expect(409)
        ).body.code,
      ).toBe('MARK_SHEET_LOCKED');
      await act('teacher', 'A', state.A.math, ac.A.sectionA, 'finalize').expect(403);
      expect(
        (
          (await act('principal', 'A', state.A.math, ac.A.sectionA, 'finalize').expect(201))
            .body as MarkSheet
        ).status,
      ).toBe('FINALIZED');
      expect(
        (await act('principal', 'A', state.A.math, ac.A.sectionA, 'finalize').expect(409)).body
          .code,
      ).toBe('MARKS_FINALIZED');
      // Absent stays a state, never a number.
      const row = await prisma.studentExamMark.findFirstOrThrow({
        where: { studentId: ids.A.s2, componentId: state.A.mWritten },
      });
      expect(row).toMatchObject({ status: 'ABSENT', marksObtained: null });
    });

    it('reopen needs a 3–500 char reason; corrections are traceable in history', async () => {
      await act('principal', 'A', state.A.math, ac.A.sectionA, 'reopen', { reason: 'no' }).expect(
        400,
      );
      expect(
        (
          (
            await act('principal', 'A', state.A.math, ac.A.sectionA, 'reopen', {
              reason: 'Re-marked page 3',
            }).expect(201)
          ).body as MarkSheet
        ).status,
      ).toBe('REOPENED');
      await save('teacher', 'A', state.A.math, ac.A.sectionA, [
        M(ids.A.s4, state.A.mWritten, '42'),
      ]).expect(200);
      const mark = await prisma.studentExamMark.findFirstOrThrow({
        where: { studentId: ids.A.s4, componentId: state.A.mWritten },
      });
      const history = await prisma.studentExamMarkHistory.findMany({
        where: { markId: mark.id },
        orderBy: { version: 'asc' },
      });
      expect(history.map((h) => [h.version, h.toMarks?.toString(), h.reason])).toEqual([
        [1, '40.5', null],
        [2, '42', 'Re-marked page 3'],
      ]);
      const s = await sheet('principal', 'A', state.A.math, ac.A.sectionA);
      expect(s.events.map((e) => e.toStatus)).toEqual(['SUBMITTED', 'FINALIZED', 'REOPENED']);
      expect(s.events[2]?.reason).toBe('Re-marked page 3');
      await act('teacher', 'A', state.A.math, ac.A.sectionA, 'submit').expect(201);
      await act('principal', 'A', state.A.math, ac.A.sectionA, 'finalize').expect(201);
    });

    it('concurrent saves on one sheet version: exactly one wins', async () => {
      const v = (await sheet('principal', 'A', state.A.sci, ac.A.sectionA)).version;
      const [a, b] = await Promise.all([
        save('principal', 'A', state.A.sci, ac.A.sectionA, [M(ids.A.s1, state.A.sTheory, '60')], v),
        save('principal', 'A', state.A.sci, ac.A.sectionA, [M(ids.A.s1, state.A.sTheory, '61')], v),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(
        await prisma.studentExamMark.count({
          where: { studentId: ids.A.s1, componentId: state.A.sTheory },
        }),
      ).toBe(1);
    });

    it('the exam cannot finalize while any sheet is open; leadership completes the rest', async () => {
      expect((await step('A', 'finalize-marks', 409)).body.code).toBe('MARK_SHEETS_NOT_FINALIZED');
      for (const l of FIXTURE_LETTERS) {
        if (l !== 'A') {
          await save('principal', l, state[l].math, ac[l].sectionA, [
            M(ids[l].s1, state[l].mWritten, '91'),
            { studentId: ids[l].s2, componentId: state[l].mWritten, status: 'ABSENT' },
            M(ids[l].s4, state[l].mWritten, '42'),
          ]).expect(200);
          await act('principal', l, state[l].math, ac[l].sectionA, 'submit').expect(201);
          await act('principal', l, state[l].math, ac[l].sectionA, 'finalize').expect(201);
        }
        const entries: [string, string, string, string][] = [
          [state[l].sci, ac[l].sectionA, ids[l].s1, '60|18'],
          [state[l].sci, ac[l].sectionA, ids[l].s2, '25|20'],
          [state[l].sci, ac[l].sectionB, ids[l].s3, '30|10'],
          [state[l].sci, ac[l].sectionB, ids[l].s4, '70|20'],
        ];
        for (const [subject, section, student, v] of entries) {
          const [th, pr] = v.split('|');
          await save('principal', l, subject, section, [
            M(student, state[l].sTheory, th ?? ''),
            M(student, state[l].sPractical, pr ?? ''),
          ]).expect(200);
        }
        await save('principal', l, state[l].math, ac[l].sectionB, [
          M(ids[l].s3, state[l].mWritten, '50'),
        ]).expect(200);
        for (const [subject, section] of [
          [state[l].sci, ac[l].sectionA],
          [state[l].sci, ac[l].sectionB],
          [state[l].math, ac[l].sectionB],
        ] as const) {
          await act('principal', l, subject, section, 'submit').expect(201);
          await act('principal', l, subject, section, 'finalize').expect(201);
        }
        await step(l, 'finalize-marks');
      }
    });
  });

  describe('results', () => {
    it('canonical results: totals, pass/fail, absent, component pass marks, grades', async () => {
      const r = (await as('principal').get(`/api/v1/exams/${state.A.exam}/results`).expect(200))
        .body as ClassResults;
      const by = Object.fromEntries(r.rows.map((x) => [x.studentId, x]));
      expect(by[ids.A.s1]).toMatchObject({
        obtained: '169.00',
        maxMarks: '200.00',
        percentageDisplay: '84.50',
        grade: 'A2',
        status: 'PASS',
      });
      // Absent in maths (0 + fail) and theory below its own pass mark.
      expect(by[ids.A.s2]).toMatchObject({
        obtained: '45.00',
        percentageDisplay: '22.50',
        grade: 'E',
        status: 'FAIL',
      });
      expect(by[ids.A.s3]).toMatchObject({
        obtained: '90.00',
        percentageDisplay: '45.00',
        status: 'PASS',
      });
      // s4: maths sat in 5 A (42 after correction), science in 5 B; listed under 5 B.
      expect(by[ids.A.s4]).toMatchObject({
        obtained: '132.00',
        className: 'Grade 5 B',
        status: 'PASS',
      });
      expect(r).toMatchObject({ incompleteCount: 0, canPublish: true });
      const card = (
        await as('principal')
          .get(`/api/v1/exams/${state.A.exam}/results/students/${ids.A.s2}`)
          .expect(200)
      ).body as ReportCard;
      const mathS = card.subjects.find((s) => s.subjectName === 'Mathematics');
      expect(mathS?.components[0]).toMatchObject({ status: 'ABSENT', marks: null, passed: false });
      const sciS = card.subjects.find((s) => s.subjectName === 'Science');
      expect(sciS).toMatchObject({ outcome: 'FAIL', obtained: '45.00' });
    });

    it('class teacher sees only their section; can write a remark; others cannot', async () => {
      const mine = (
        await as('teacher')
          .get(`/api/v1/exams/${state.A.exam}/results?sectionId=${ac.A.sectionA}`)
          .expect(200)
      ).body as ClassResults;
      expect(mine.rows.map((r) => r.studentId).sort()).toEqual([ids.A.s1, ids.A.s2].sort());
      expect(mine.canPublish).toBe(false);
      await as('teacher')
        .get(`/api/v1/exams/${state.A.exam}/results?sectionId=${ac.A.sectionB}`)
        .expect(404);
      await as('teacher').get(`/api/v1/exams/${state.A.exam}/results`).expect(404);
      await as('teacher2')
        .get(`/api/v1/exams/${state.A.exam}/results?sectionId=${ac.A.sectionB}`)
        .expect(404);
      await as('accountant').get(`/api/v1/exams/${state.A.exam}/results`).expect(403);
      await as('teacher')
        .put(`/api/v1/exams/${state.A.exam}/remarks/${ids.A.s1}`)
        .send({ remark: 'Consistent effort in every subject.' })
        .expect(200);
      await as('teacher')
        .put(`/api/v1/exams/${state.A.exam}/remarks/${ids.A.s3}`)
        .send({ remark: 'x' })
        .expect(404);
      await as('teacher')
        .put(`/api/v1/exams/${state.A.exam}/remarks/${ids.A.s1}`)
        .send({ remark: 'x'.repeat(501) })
        .expect(400);
    });

    it('unpublished results are invisible to parents and students', async () => {
      await as('parent')
        .get(`/api/v1/mobile/parent/children/${ids.A.s1}/results/${state.A.exam}`)
        .expect(404);
      expect((await as('student').get('/api/v1/mobile/student/results').expect(200)).body).toEqual(
        [],
      );
    });

    it('publish: exactly one of two concurrent requests; teachers cannot publish', async () => {
      const v = await version('A');
      await as('teacher')
        .post(`/api/v1/exams/${state.A.exam}/results/publish`)
        .send({ expectedVersion: v })
        .expect(403);
      const [a, b] = await Promise.all([
        as('principal')
          .post(`/api/v1/exams/${state.A.exam}/results/publish`)
          .send({ expectedVersion: v }),
        as('principal')
          .post(`/api/v1/exams/${state.A.exam}/results/publish`)
          .send({ expectedVersion: v }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await prisma.resultPublication.count({ where: { examId: state.A.exam } })).toBe(1);
      for (const l of ['B', 'C'] as const)
        await as('principal', l)
          .post(`/api/v1/exams/${state[l].exam}/results/publish`)
          .send({ expectedVersion: await version(l) })
          .expect(201);
      // Activity feed: exam/class-level wording only; never a student's marks. Audit metadata
      // holds ids only (no mark sheets, snapshots or feedback).
      const feed = (
        (await as('principal').get('/api/v1/workspace/dashboard').expect(200)).body as {
          activity: { message: string; subject: string | null }[];
        }
      ).activity;
      const msgs = feed.map((x) => `${x.message}|${x.subject ?? ''}`);
      expect(msgs).toContain('Results published|Mid Term');
      expect(msgs).toContain('Marks finalized|Mid Term · Grade 5 A Mathematics');
      expect(JSON.stringify(feed)).not.toMatch(/\b91\b|Asmk/);
      const audits = await prisma.auditLog.findMany({
        where: { tenantId: t.A.id, resourceType: { in: ['exam', 'exam_mark_sheet'] } },
      });
      expect(JSON.stringify(audits.map((x) => x.metadata))).not.toMatch(/marks|"91"|remark"/i);
    });

    it('parent sees the linked child only; student sees own; nothing else', async () => {
      const list = (
        await as('parent').get(`/api/v1/mobile/parent/children/${ids.A.s1}/results`).expect(200)
      ).body as PublishedResultSummary[];
      expect(list).toMatchObject([
        {
          examName: 'Mid Term',
          version: 1,
          percentageDisplay: '84.50',
          grade: 'A2',
          status: 'PASS',
        },
      ]);
      const card = (
        await as('parent')
          .get(`/api/v1/mobile/parent/children/${ids.A.s1}/results/${state.A.exam}`)
          .expect(200)
      ).body as ReportCard;
      expect(card).toMatchObject({
        preview: false,
        publicationVersion: 1,
        studentName: 'Asmk1 A',
        remark: 'Consistent effort in every subject.',
      });
      await as('parent')
        .get(`/api/v1/mobile/parent/children/${ids.A.s3}/results/${state.A.exam}`)
        .expect(404);
      await as('parent2').get(`/api/v1/mobile/parent/children/${ids.A.s1}/results`).expect(404);
      const own = (
        await as('student').get(`/api/v1/mobile/student/results/${state.A.exam}`).expect(200)
      ).body as ReportCard;
      expect(own.admissionNumber).toBe('AS-1');
      const s2 = (
        await as('student2').get(`/api/v1/mobile/student/results/${state.A.exam}`).expect(200)
      ).body as ReportCard;
      expect(s2.admissionNumber).toBe('AS-2');
      expect(s2.subjects.find((s) => s.subjectName === 'Mathematics')?.components[0]?.status).toBe(
        'ABSENT',
      );
    });

    it('published report cards are immutable; a correction publishes version 2', async () => {
      // Renaming the subject later does not change the published card.
      await prisma.subject.update({ where: { id: ac.A.mathId }, data: { name: 'Maths' } });
      const v1 = (
        await as('student').get(`/api/v1/mobile/student/results/${state.A.exam}`).expect(200)
      ).body as ReportCard;
      expect(v1.subjects.map((s) => s.subjectName)).toContain('Mathematics');
      // Correction: reopen (back to marks entry) → fix → finalize → publish v2.
      await act('principal', 'A', state.A.sci, ac.A.sectionA, 'reopen', {
        reason: 'Practical re-assessed',
      }).expect(201);
      expect(
        (
          (await as('principal').get(`/api/v1/exams/${state.A.exam}`).expect(200))
            .body as ExamDetail
        ).status,
      ).toBe('MARKS_ENTRY');
      // The published v1 stays visible meanwhile.
      await as('student').get(`/api/v1/mobile/student/results/${state.A.exam}`).expect(200);
      await save('principal', 'A', state.A.sci, ac.A.sectionA, [
        M(ids.A.s1, state.A.sPractical, '20'),
      ]).expect(200);
      await act('principal', 'A', state.A.sci, ac.A.sectionA, 'submit').expect(201);
      await act('principal', 'A', state.A.sci, ac.A.sectionA, 'finalize').expect(201);
      await step('A', 'finalize-marks');
      const pubs = (
        await as('principal')
          .post(`/api/v1/exams/${state.A.exam}/results/publish`)
          .send({ expectedVersion: await version('A') })
          .expect(201)
      ).body as ResultPublicationSummary[];
      expect(pubs.map((p) => [p.version, p.isCurrent])).toEqual([
        [2, true],
        [1, false],
      ]);
      const v2 = (
        await as('student').get(`/api/v1/mobile/student/results/${state.A.exam}`).expect(200)
      ).body as ReportCard;
      expect(v2).toMatchObject({ publicationVersion: 2, obtained: '171.00' });
      expect(v2.subjects.map((s) => s.subjectName)).toContain('Maths');
      // Version 1 remains readable (staff) and unchanged.
      const old = pubs.find((p) => p.version === 1);
      const staffV1 = (
        await as('principal')
          .get(`/api/v1/result-publications/${old?.id ?? ''}/students/${ids.A.s1}`)
          .expect(200)
      ).body as ReportCard;
      expect(staffV1).toMatchObject({ publicationVersion: 1, obtained: '169.00' });
      await prisma.subject.update({ where: { id: ac.A.mathId }, data: { name: 'Mathematics' } });
      // Archive is the only step after publication; archived exams stay readable.
      await step('A', 'archive');
      await as('student').get(`/api/v1/mobile/student/results/${state.A.exam}`).expect(200);
      expect(
        (
          await act('principal', 'A', state.A.math, ac.A.sectionA, 'reopen', {
            reason: 'late fix',
          }).expect(409)
        ).body.code,
      ).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  describe('assignment grading', () => {
    let assignmentId = '';
    let feedbackOnly = '';
    const submit = (who: Who, id: string, body: Record<string, unknown>) =>
      as(who).put(`/api/v1/mobile/student/assignments/${id}/submission`).send(body);
    const gradePath = (id: string, sub: string, v: number) =>
      `/api/v1/assignments/${id}/submissions/${sub}/versions/${String(v)}/grade`;

    it('setup: gradable (max 20) and feedback-only assignments', async () => {
      const create = async (title: string, maxMarks: string | null) => {
        const a = (
          await as('teacher')
            .post('/api/v1/assignments')
            .send({
              sectionId: ac.A.sectionA,
              subjectId: ac.A.mathId,
              title,
              assignedDate: '2026-04-10',
              dueDate: '2027-03-30',
              maxMarks,
            })
            .expect(201)
        ).body as { id: string; version: number; maxMarks: string | null };
        await as('teacher')
          .post(`/api/v1/assignments/${a.id}/publish`)
          .send({ expectedVersion: a.version })
          .expect(200);
        return a;
      };
      const g = await create('Fractions test', '20');
      expect(g.maxMarks).toBe('20.00');
      assignmentId = g.id;
      feedbackOnly = (await create('Reading journal', null)).id;
      await submit('student', assignmentId, { expectedVersion: 0, text: 'My answers v1' }).expect(
        200,
      );
      await submit('student', feedbackOnly, { expectedVersion: 0, text: 'Journal' }).expect(200);
    });

    it('draft grades are invisible; published grade shows; resubmission is ungraded (no carry-over)', async () => {
      const view = (
        await as('teacher').get(`/api/v1/assignments/${assignmentId}/grading`).expect(200)
      ).body as AssignmentGrading;
      const row = view.rows.find((r) => r.studentId === ids.A.s1);
      const sub = row?.submissionId ?? '';
      await as('teacher2').get(`/api/v1/assignments/${assignmentId}/grading`).expect(404);
      await as('teacher2')
        .put(gradePath(assignmentId, sub, 1))
        .send({ marksAwarded: '10', expectedVersion: 0 })
        .expect(404);
      await as('student').get(`/api/v1/assignments/${assignmentId}/grading`).expect(403);
      expect(
        (
          await as('teacher')
            .put(gradePath(assignmentId, sub, 1))
            .send({ marksAwarded: '25', expectedVersion: 0 })
            .expect(400)
        ).body.code,
      ).toBe('GRADE_INVALID');
      await as('teacher')
        .put(gradePath(assignmentId, sub, 1))
        .send({ marksAwarded: '15.5', feedback: 'Good method; check q4.', expectedVersion: 0 })
        .expect(200);
      let seen = (
        await as('student').get(`/api/v1/mobile/student/assignments/${assignmentId}`).expect(200)
      ).body as MobileWorkItem;
      expect(seen).toMatchObject({ grade: null, awaitingGrading: true, maxMarks: '20.00' });
      // Max marks lock only after a published grade.
      await as('teacher')
        .post(gradePath(assignmentId, sub, 1) + '/publish')
        .send({ expectedVersion: 1 })
        .expect(201);
      seen = (
        await as('student').get(`/api/v1/mobile/student/assignments/${assignmentId}`).expect(200)
      ).body as MobileWorkItem;
      expect(seen.grade).toMatchObject({
        submissionVersion: 1,
        marksAwarded: '15.50',
        feedback: 'Good method; check q4.',
      });
      const parentSeen = (
        await as('parent')
          .get(`/api/v1/mobile/parent/children/${ids.A.s1}/assignments/${assignmentId}`)
          .expect(200)
      ).body as MobileWorkItem;
      expect(parentSeen.grade?.marksAwarded).toBe('15.50');
      const a = (await as('teacher').get(`/api/v1/assignments/${assignmentId}`).expect(200))
        .body as { version: number };
      expect(
        (
          await as('teacher')
            .patch(`/api/v1/assignments/${assignmentId}`)
            .send({ maxMarks: '25', expectedVersion: a.version })
            .expect(409)
        ).body.code,
      ).toBe('MAX_MARKS_LOCKED');
      // Student resubmits v2 → the v1 grade is historical; v2 awaits grading.
      await submit('student', assignmentId, { expectedVersion: 1, text: 'My answers v2' }).expect(
        200,
      );
      seen = (
        await as('student').get(`/api/v1/mobile/student/assignments/${assignmentId}`).expect(200)
      ).body as MobileWorkItem;
      expect(seen).toMatchObject({ grade: null, awaitingGrading: true });
      const after = (
        await as('teacher').get(`/api/v1/assignments/${assignmentId}/grading`).expect(200)
      ).body as AssignmentGrading;
      const versions = after.rows.find((r) => r.studentId === ids.A.s1)?.versions ?? [];
      expect(versions.map((v) => [v.version, v.grade?.status ?? null])).toEqual([
        [2, null],
        [1, 'PUBLISHED'],
      ]);
      // Audit carries no marks or feedback.
      const audits = await prisma.auditLog.findMany({
        where: { tenantId: t.A.id, action: { startsWith: 'ASSIGNMENT_GRADE' } },
      });
      expect(audits.length).toBeGreaterThan(0);
      expect(JSON.stringify(audits)).not.toContain('check q4');
    });

    it('feedback-only assignments refuse marks but accept feedback', async () => {
      const view = (
        await as('teacher').get(`/api/v1/assignments/${feedbackOnly}/grading`).expect(200)
      ).body as AssignmentGrading;
      const sub = view.rows[0]?.submissionId ?? '';
      expect(
        (
          await as('teacher')
            .put(gradePath(feedbackOnly, sub, 1))
            .send({ marksAwarded: '5', expectedVersion: 0 })
            .expect(400)
        ).body.code,
      ).toBe('GRADE_MARKS_NOT_ALLOWED');
      await as('teacher')
        .put(gradePath(feedbackOnly, sub, 1))
        .send({ feedback: 'Lovely reflections.', expectedVersion: 0 })
        .expect(200);
      await as('teacher')
        .post(gradePath(feedbackOnly, sub, 1) + '/publish')
        .send({ expectedVersion: 1 })
        .expect(201);
      const seen = (
        await as('student').get(`/api/v1/mobile/student/assignments/${feedbackOnly}`).expect(200)
      ).body as MobileWorkItem;
      expect(seen.grade).toMatchObject({
        marksAwarded: null,
        maxMarks: null,
        feedback: 'Lovely reflections.',
      });
    });
  });

  describe('races (deterministic winners)', () => {
    const raw = (who: Who, l: FixtureLetter, method: 'put' | 'post', path: string, body: object) =>
      as(who, l)[method](path).send(body);
    const status = async (l: FixtureLetter, subject: string, section: string) =>
      sheet('principal', l, subject, section);

    it('save vs submit, save vs finalize, double reopen: one winner, no lost update', async () => {
      // A fresh exam in C (V: exams are independent), open for marks.
      await setupExam('C', 'Race Term');
      await step('C', 'publish');
      await step('C', 'open-marks');
      const path = sheetPath('C', state.C.math, ac.C.sectionA);
      const full = [
        M(ids.C.s1, state.C.mWritten, '70'),
        M(ids.C.s2, state.C.mWritten, '71'),
        M(ids.C.s4, state.C.mWritten, '72'),
      ];
      await save('teacher', 'C', state.C.math, ac.C.sectionA, full).expect(200);

      // 1) teacher edit racing teacher submit on the same sheet version.
      let v = (await status('C', state.C.math, ac.C.sectionA)).version;
      const [edit, sub] = await Promise.all([
        raw('teacher', 'C', 'put', path, {
          expectedVersion: v,
          entries: [M(ids.C.s1, state.C.mWritten, '99')],
        }),
        raw('teacher', 'C', 'post', `${path}/submit`, { expectedVersion: v }),
      ]);
      expect([edit.status, sub.status].filter((c) => c >= 200 && c < 300)).toHaveLength(1);
      expect([edit.status, sub.status]).toContain(409);
      let s = await status('C', state.C.math, ac.C.sectionA);
      const stored = await prisma.studentExamMark.findFirstOrThrow({
        where: { studentId: ids.C.s1, componentId: state.C.mWritten },
      });
      if (sub.status === 201) {
        expect(s.status).toBe('SUBMITTED');
        expect(stored.marksObtained?.toString()).toBe('70');
      } else {
        expect(s.status).toBe('DRAFT');
        expect(stored.marksObtained?.toString()).toBe('99');
        await act('teacher', 'C', state.C.math, ac.C.sectionA, 'submit').expect(201);
      }

      // 2) leadership edit racing leadership finalize: finalized marks are never overwritten.
      v = (await status('C', state.C.math, ac.C.sectionA)).version;
      const before = (
        await prisma.studentExamMark.findFirstOrThrow({
          where: { studentId: ids.C.s2, componentId: state.C.mWritten },
        })
      ).marksObtained?.toString();
      const [edit2, fin] = await Promise.all([
        raw('principal', 'C', 'put', path, {
          expectedVersion: v,
          entries: [M(ids.C.s2, state.C.mWritten, '5')],
        }),
        raw('principal', 'C', 'post', `${path}/finalize`, { expectedVersion: v }),
      ]);
      expect([edit2.status, fin.status].filter((c) => c >= 200 && c < 300)).toHaveLength(1);
      expect([edit2.status, fin.status]).toContain(409);
      s = await status('C', state.C.math, ac.C.sectionA);
      const after = (
        await prisma.studentExamMark.findFirstOrThrow({
          where: { studentId: ids.C.s2, componentId: state.C.mWritten },
        })
      ).marksObtained?.toString();
      if (fin.status === 201) {
        expect(s.status).toBe('FINALIZED');
        expect(after).toBe(before);
      } else {
        expect(after).toBe('5');
        await act('principal', 'C', state.C.math, ac.C.sectionA, 'finalize').expect(201);
      }

      // 3) two reopen requests on the same version: exactly one reopen event.
      v = (await status('C', state.C.math, ac.C.sectionA)).version;
      const reopens = await Promise.all(
        [1, 2].map(() =>
          raw('principal', 'C', 'post', `${path}/reopen`, {
            expectedVersion: v,
            reason: 'Recount requested',
          }),
        ),
      );
      expect(reopens.map((r) => r.status).sort()).toEqual([201, 409]);
      s = await status('C', state.C.math, ac.C.sectionA);
      expect(s.status).toBe('REOPENED');
      expect(s.events.filter((e) => e.toStatus === 'REOPENED')).toHaveLength(1);
    });

    it('two simultaneous grade publications for one submission version: one published grade', async () => {
      const a = (
        await as('teacher', 'B')
          .post('/api/v1/assignments')
          .send({
            sectionId: ac.B.sectionA,
            subjectId: ac.B.mathId,
            title: 'Race quiz',
            assignedDate: '2026-04-10',
            dueDate: '2027-03-30',
            maxMarks: '10',
          })
          .expect(201)
      ).body as { id: string; version: number };
      await as('teacher', 'B')
        .post(`/api/v1/assignments/${a.id}/publish`)
        .send({ expectedVersion: a.version })
        .expect(200);
      await as('student', 'B')
        .put(`/api/v1/mobile/student/assignments/${a.id}/submission`)
        .send({ expectedVersion: 0, text: 'Answers' })
        .expect(200);
      const view = (await as('teacher', 'B').get(`/api/v1/assignments/${a.id}/grading`).expect(200))
        .body as AssignmentGrading;
      const sub = view.rows[0]?.submissionId ?? '';
      const gp = `/api/v1/assignments/${a.id}/submissions/${sub}/versions/1/grade`;
      await as('teacher', 'B').put(gp).send({ marksAwarded: '8', expectedVersion: 0 }).expect(200);
      const results = await Promise.all(
        [1, 2].map(() => as('teacher', 'B').post(`${gp}/publish`).send({ expectedVersion: 1 })),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(
        await prisma.assignmentSubmissionGrade.count({
          where: { submissionId: sub, status: 'PUBLISHED' },
        }),
      ).toBe(1);
    });
  });

  describe('isolation', () => {
    it.each([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'A'],
    ] as const)(
      '%s → %s: exams, sheets, results, publications never cross tenants',
      async (me, other) => {
        await call(app, { host: t[other].domain, token: tok[me].principal ?? '' })
          .get('/api/v1/exams')
          .expect(403);
        await as('principal', me).get(`/api/v1/exams/${state[other].exam}`).expect(404);
        await as('principal', me).get(`/api/v1/exams/${state[other].exam}/sheets`).expect(404);
        await as('principal', me).get(`/api/v1/exams/${state[other].exam}/results`).expect(404);
        await as('principal', me)
          .put(`/api/v1/exams/${state[me].exam}/sheets/${state[other].math}/${ac[me].sectionA}`)
          .send({ expectedVersion: 0, entries: [] })
          .expect(404);
        await as('parent', me)
          .get(`/api/v1/mobile/parent/children/${ids[other].s1}/results`)
          .expect(404);
        await as('student', me)
          .get(`/api/v1/mobile/student/results/${state[other].exam}`)
          .expect(404);
      },
    );

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
      const exam = await prisma.exam.create({
        data: {
          tenantId: t.A.id,
          schoolId: second.id,
          academicYearId: other.yearId,
          name: 'Elsewhere',
          startDate: new Date('2026-10-01'),
          endDate: new Date('2026-10-02'),
          createdByUserId: '01900000-0000-7000-8000-000000000001',
        },
      });
      try {
        await as('principal').get(`/api/v1/exams/${exam.id}`).expect(404);
        await as('principal')
          .post(`/api/v1/exams/${state.A.exam}/subjects`)
          .send({ gradeId: other.gradeId, subjectId: other.mathId })
          .expect(409);
        await as('principal')
          .post('/api/v1/grade-scales')
          .send({ academicYearId: other.yearId, name: 'X', bands: BANDS })
          .expect(404);
      } finally {
        await prisma.exam.delete({ where: { id: exam.id } });
      }
    });
  });
});
