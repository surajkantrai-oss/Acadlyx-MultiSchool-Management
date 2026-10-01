import { Prisma } from '../../generated/prisma/client.js';

/*
 * THE canonical Phase 9 result calculation (decisions D, J, K, S, U + approved rules 2–5).
 * Pure and deterministic: the same marks/configuration always produce the same output. Exact
 * decimal arithmetic only (no floating point). Nothing here is rounded; display rounding
 * (2 dp) happens only when presenting, and grades are chosen from the UNROUNDED ratio by exact
 * cross-multiplication (obtained × 100 compared with bound × maximum — no division at all).
 *
 *  Component  MARKED  → obtained = marks, max = component max; fails if below its own pass mark
 *             ABSENT  → obtained 0, max = component max; always fails (UI shows "Absent")
 *             EXEMPT  → excluded from obtained and max; never fails
 *             (none)  → INCOMPLETE (a required mark is missing)
 *             A component the student was not eligible for (not enrolled in the section on that
 *             branch's paper date) is not required and is excluded like EXEMPT.
 *  Subject    obtained = Σ non-exempt obtained; max = Σ non-exempt max; % = obtained / max × 100
 *             PASS ⇔ (subject pass mark absent OR obtained meets it) AND no component failed.
 *             When exemptions reduce the maximum, the subject pass mark applies proportionally:
 *             obtained × fullMax ≥ passMarks × max (identical to obtained ≥ passMarks otherwise).
 *             All components exempt ⇒ EXEMPT (no %, no grade, never fails).
 *  Overall    over non-exempt subjects: obtained = Σ, max = Σ, % = obtained / max × 100
 *             INCOMPLETE if any required mark is missing; else PASS ⇔ every non-exempt subject passes.
 *             No overall percentage minimum.
 */
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export type MarkState = 'MARKED' | 'ABSENT' | 'EXEMPT';
export type Outcome = 'PASS' | 'FAIL' | 'EXEMPT';
export type OverallStatus = 'PASS' | 'FAIL' | 'EXEMPT' | 'INCOMPLETE';

export interface CalcBand {
  label: string;
  min: Dec | string | number;
  max: Dec | string | number;
}
export interface CalcComponent {
  id: string;
  name: string;
  maxMarks: Dec | string | number;
  passMarks: Dec | string | number | null;
  displayOrder: number;
}
export interface CalcSubject {
  examSubjectId: string;
  subjectName: string;
  passMarks: Dec | string | number | null;
  displayOrder: number;
  components: CalcComponent[];
}
export interface CalcMark {
  status: MarkState;
  marks: Dec | string | number | null;
}
export interface CalcInput {
  subjects: CalcSubject[];
  /** componentId → mark for this student (missing = not entered). */
  marks: ReadonlyMap<string, CalcMark>;
  /** Components this student must sit (eligibility); others are excluded. */
  eligible: ReadonlySet<string>;
  bands: CalcBand[] | null;
}

export interface ComponentResult {
  componentId: string;
  name: string;
  displayOrder: number;
  maxMarks: Dec;
  passMarks: Dec | null;
  status: MarkState | null;
  marks: Dec | null;
  passed: boolean | null;
}
export interface SubjectResult {
  examSubjectId: string;
  subjectName: string;
  displayOrder: number;
  obtained: Dec | null;
  maxMarks: Dec | null;
  passMarks: Dec | null;
  percentage: Dec | null;
  grade: string | null;
  outcome: Outcome | 'INCOMPLETE';
  components: ComponentResult[];
}
export interface StudentResult {
  subjects: SubjectResult[];
  obtained: Dec;
  maxMarks: Dec;
  percentage: Dec | null;
  grade: string | null;
  status: OverallStatus;
}

const dec = (v: Dec | string | number) => new D(v);

/** Exact grade lookup for obtained / max without dividing: min ≤ p < max (or p = 100 in the top band). */
export function gradeFor(obtained: Dec, max: Dec, bands: CalcBand[] | null): string | null {
  if (!bands || bands.length === 0 || max.lte(0)) return null;
  const scaled = obtained.mul(100);
  for (const b of bands) {
    const lo = dec(b.min).mul(max);
    const hi = dec(b.max).mul(max);
    const inRange = scaled.gte(lo) && (scaled.lt(hi) || (dec(b.max).eq(100) && scaled.lte(hi)));
    if (inRange) return b.label;
  }
  return null;
}

/** Percentage kept to 6 decimal places for storage/display; never used for grading. */
export const percentOf = (obtained: Dec, max: Dec): Dec | null =>
  max.gt(0) ? obtained.mul(100).div(max).toDecimalPlaces(6, D.ROUND_HALF_UP) : null;

export function calculateStudent(input: CalcInput): StudentResult {
  const subjects: SubjectResult[] = [];
  let incomplete = false;
  for (const s of [...input.subjects].sort((a, b) => a.displayOrder - b.displayOrder)) {
    const required = s.components.filter((c) => input.eligible.has(c.id));
    if (required.length === 0) continue; // not this student's paper
    let obtained = new D(0);
    let max = new D(0);
    let fullMax = new D(0);
    let failed = false;
    let missing = false;
    let counted = 0;
    const components: ComponentResult[] = [];
    for (const c of [...required].sort((a, b) => a.displayOrder - b.displayOrder)) {
      const m = input.marks.get(c.id);
      const cMax = dec(c.maxMarks);
      const cPass = c.passMarks === null ? null : dec(c.passMarks);
      fullMax = fullMax.add(cMax);
      let passed: boolean | null = null;
      if (!m) missing = true;
      else if (m.status === 'EXEMPT') passed = null;
      else {
        counted += 1;
        max = max.add(cMax);
        if (m.status === 'ABSENT') {
          passed = false;
          failed = true;
        } else {
          const v = dec(m.marks ?? 0);
          obtained = obtained.add(v);
          passed = cPass === null ? null : v.gte(cPass);
          if (passed === false) failed = true;
        }
      }
      components.push({
        componentId: c.id,
        name: c.name,
        displayOrder: c.displayOrder,
        maxMarks: cMax,
        passMarks: cPass,
        status: m?.status ?? null,
        marks: m?.status === 'MARKED' && m.marks !== null ? dec(m.marks) : null,
        passed,
      });
    }
    const pass = s.passMarks === null ? null : dec(s.passMarks);
    let outcome: SubjectResult['outcome'];
    if (missing) {
      outcome = 'INCOMPLETE';
      incomplete = true;
    } else if (counted === 0) outcome = 'EXEMPT';
    else {
      const meetsSubject = pass === null || obtained.mul(fullMax).gte(pass.mul(max));
      outcome = meetsSubject && !failed ? 'PASS' : 'FAIL';
    }
    const scored = outcome === 'PASS' || outcome === 'FAIL';
    subjects.push({
      examSubjectId: s.examSubjectId,
      subjectName: s.subjectName,
      displayOrder: s.displayOrder,
      obtained: scored ? obtained : null,
      maxMarks: scored ? max : null,
      passMarks: pass,
      percentage: scored ? percentOf(obtained, max) : null,
      grade: scored ? gradeFor(obtained, max, input.bands) : null,
      outcome,
      components,
    });
  }
  const scored = subjects.filter((s) => s.outcome === 'PASS' || s.outcome === 'FAIL');
  const obtained = scored.reduce((a, s) => a.add(s.obtained ?? 0), new D(0));
  const max = scored.reduce((a, s) => a.add(s.maxMarks ?? 0), new D(0));
  let status: OverallStatus;
  if (incomplete) status = 'INCOMPLETE';
  else if (scored.length === 0) status = 'EXEMPT';
  else status = scored.every((s) => s.outcome === 'PASS') ? 'PASS' : 'FAIL';
  return {
    subjects,
    obtained,
    maxMarks: max,
    percentage: scored.length ? percentOf(obtained, max) : null,
    grade: scored.length && status !== 'INCOMPLETE' ? gradeFor(obtained, max, input.bands) : null,
    status,
  };
}

/** Bands must tile 0–100 exactly: sorted by min, first min = 0, each min = previous max, last max = 100. */
export function bandsCoverScale(
  bands: { min: Dec | string | number; max: Dec | string | number }[],
): boolean {
  if (bands.length === 0) return false;
  const sorted = [...bands].sort((a, b) => dec(a.min).comparedTo(dec(b.min)));
  if (!dec(sorted[0]?.min ?? -1).eq(0)) return false;
  for (let i = 0; i < sorted.length; i += 1) {
    const b = sorted[i];
    if (!b || !dec(b.min).lt(dec(b.max))) return false;
    const next = sorted[i + 1];
    if (next && !dec(next.min).eq(dec(b.max))) return false;
  }
  return dec(sorted[sorted.length - 1]?.max ?? -1).eq(100);
}

/** Display helper: 2 decimal places, half-up (presentation only). */
export const display2 = (v: Dec | null): string | null => (v === null ? null : v.toFixed(2));
