import { describe, expect, it } from 'vitest';
import {
  bandsCoverScale,
  calculateStudent,
  type CalcMark,
  type CalcSubject,
  display2,
  gradeFor,
} from './result-calc.js';
import { Prisma } from '../../generated/prisma/client.js';

const D = Prisma.Decimal;
const BANDS = [
  { label: 'A1', min: 90, max: 100 },
  { label: 'A2', min: 80, max: 90 },
  { label: 'B', min: 33, max: 80 },
  { label: 'E', min: 0, max: 33 },
];
const subject = (
  id: string,
  pass: number | null,
  comps: [string, number, number | null][],
  order = 0,
): CalcSubject => ({
  examSubjectId: id,
  subjectName: id,
  passMarks: pass,
  displayOrder: order,
  components: comps.map(([cid, max, cpass], i) => ({
    id: cid,
    name: cid,
    maxMarks: max,
    passMarks: cpass,
    displayOrder: i,
  })),
});
const run = (subjects: CalcSubject[], marks: Record<string, CalcMark>, eligible?: string[]) =>
  calculateStudent({
    subjects,
    marks: new Map(Object.entries(marks)),
    eligible: new Set(eligible ?? subjects.flatMap((s) => s.components.map((c) => c.id))),
    bands: BANDS,
  });
const m = (v: number | string): CalcMark => ({ status: 'MARKED', marks: v });

describe('Phase 9 canonical result calculation', () => {
  const math = subject('MATH', 33, [['m', 100, null]], 0);
  const sci = subject(
    'SCI',
    33,
    [
      ['th', 80, 26],
      ['pr', 20, null],
    ],
    1,
  );

  it('all pass: totals, exact percentage and grade', () => {
    const r = run([math, sci], { m: m(91), th: m(60), pr: m(18) });
    expect(r.status).toBe('PASS');
    expect(r.obtained.toString()).toBe('169');
    expect(r.maxMarks.toString()).toBe('200');
    expect(display2(r.percentage)).toBe('84.50');
    expect(r.grade).toBe('A2');
    expect(r.subjects.map((s) => [s.outcome, s.grade])).toEqual([
      ['PASS', 'A1'],
      ['PASS', 'B'],
    ]);
  });

  it('a component with its own pass mark fails the subject even if the total passes', () => {
    const r = run([sci], { th: m(25), pr: m(20) }); // 45/100 ≥ 33 but theory 25 < 26
    expect(r.subjects[0]?.outcome).toBe('FAIL');
    expect(r.status).toBe('FAIL');
    // A component without a pass mark never fails on its own.
    expect(run([sci], { th: m(30), pr: m(5) }).subjects[0]?.outcome).toBe('PASS');
    // …but the combined subject pass mark still applies (30/100 < 33).
    expect(run([sci], { th: m(30), pr: m(0) }).subjects[0]?.outcome).toBe('FAIL');
  });

  it('one failed subject fails overall regardless of the overall percentage', () => {
    const r = run([math, sci], { m: m(20), th: m(80), pr: m(20) }); // 120/200 = 60 %
    expect(display2(r.percentage)).toBe('60.00');
    expect(r.status).toBe('FAIL');
  });

  it('ABSENT counts 0 and fails; the state is kept (not a 0 mark)', () => {
    const r = run([math, sci], { m: { status: 'ABSENT', marks: null }, th: m(70), pr: m(20) });
    const mathR = r.subjects[0];
    expect(mathR?.outcome).toBe('FAIL');
    expect(mathR?.obtained?.toString()).toBe('0');
    expect(mathR?.maxMarks?.toString()).toBe('100');
    expect(mathR?.components[0]).toMatchObject({ status: 'ABSENT', marks: null, passed: false });
    expect(r.status).toBe('FAIL');
  });

  it('EXEMPT excludes obtained and max; a fully exempt subject is EXEMPT with no % or grade', () => {
    const r = run([math, sci], { m: { status: 'EXEMPT', marks: null }, th: m(70), pr: m(20) });
    expect(r.subjects[0]).toMatchObject({ outcome: 'EXEMPT', percentage: null, grade: null });
    expect(r.maxMarks.toString()).toBe('100');
    expect(r.status).toBe('PASS');
    // Partly exempt: practical exempt → max 80; subject pass mark 33/100 applies proportionally.
    const part = run([sci], { th: m(27), pr: { status: 'EXEMPT', marks: null } });
    expect(part.subjects[0]).toMatchObject({ outcome: 'PASS' });
    expect(part.subjects[0]?.maxMarks?.toString()).toBe('80');
    // Everything exempt → overall EXEMPT.
    expect(run([math], { m: { status: 'EXEMPT', marks: null } }).status).toBe('EXEMPT');
  });

  it('an EXEMPT subject never makes the overall result EXEMPT: PASS / FAIL / INCOMPLETE only', () => {
    const X: CalcMark = { status: 'EXEMPT', marks: null };
    const eng = subject('ENG', 33, [['e', 100, null]], 2);
    // One subject exempt + every other subject passes → PASS (exempt excluded from totals).
    const pass = run([math, sci, eng], { m: X, th: m(60), pr: m(18), e: m(70) });
    expect(pass.status).toBe('PASS');
    expect([pass.obtained.toString(), pass.maxMarks.toString()]).toEqual(['148', '200']);
    // One subject exempt + another subject fails → FAIL.
    const fail = run([math, sci, eng], { m: X, th: m(60), pr: m(18), e: m(20) });
    expect(fail.subjects.map((x) => x.outcome)).toEqual(['EXEMPT', 'PASS', 'FAIL']);
    expect(fail.status).toBe('FAIL');
    // One subject exempt + a required mark missing → INCOMPLETE.
    expect(run([math, sci, eng], { m: X, th: m(60), pr: m(18) }).status).toBe('INCOMPLETE');
  });

  it('missing marks make the result INCOMPLETE (no grade)', () => {
    const r = run([math, sci], { m: m(50), th: m(40) });
    expect(r.status).toBe('INCOMPLETE');
    expect(r.grade).toBeNull();
    expect(r.subjects[1]?.outcome).toBe('INCOMPLETE');
  });

  it('components the student was not eligible for are excluded', () => {
    const r = run([sci], { th: m(60) }, ['th']);
    expect(r.subjects[0]).toMatchObject({ outcome: 'PASS' });
    expect(r.subjects[0]?.maxMarks?.toString()).toBe('80');
  });

  it('decimal marks are exact', () => {
    const r = run([math], { m: m('33.33') });
    expect(r.obtained.toString()).toBe('33.33');
    expect(r.subjects[0]?.outcome).toBe('PASS');
    expect(run([math], { m: m('32.99') }).subjects[0]?.outcome).toBe('FAIL');
  });

  it('grades use the RAW ratio, not the rounded display value', () => {
    // 89.995 % displays as 90.00 but is still below 90 → A2.
    const r = gradeFor(new D('179.99'), new D('200'), BANDS);
    expect(r).toBe('A2');
    expect(display2(new D('179.99').mul(100).div(200))).toBe('90.00');
    expect(gradeFor(new D(90), new D(100), BANDS)).toBe('A1'); // exact boundary is inclusive
    expect(gradeFor(new D('89.99'), new D(100), BANDS)).toBe('A2');
    expect(gradeFor(new D(100), new D(100), BANDS)).toBe('A1'); // 100 belongs to the top band
    expect(gradeFor(new D(0), new D(100), BANDS)).toBe('E');
  });

  it('recalculation is deterministic', () => {
    const marks = { m: m(91), th: m(60), pr: m(18) };
    expect(JSON.stringify(run([math, sci], marks))).toBe(JSON.stringify(run([math, sci], marks)));
  });

  it('grade scales must tile 0–100 without gaps or overlaps', () => {
    expect(bandsCoverScale(BANDS)).toBe(true);
    expect(
      bandsCoverScale([
        { min: 0, max: 50 },
        { min: 60, max: 100 },
      ]),
    ).toBe(false); // gap
    expect(
      bandsCoverScale([
        { min: 0, max: 60 },
        { min: 50, max: 100 },
      ]),
    ).toBe(false); // overlap
    expect(bandsCoverScale([{ min: 10, max: 100 }])).toBe(false); // not from 0
    expect(bandsCoverScale([{ min: 0, max: 99 }])).toBe(false); // not to 100
    expect(bandsCoverScale([])).toBe(false);
  });
});
