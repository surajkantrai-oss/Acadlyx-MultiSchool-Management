/**
 * Academic operations validation (Phase 7), shared by backend DTOs (authoritative) and School
 * Admin forms. Dates are school-local `YYYY-MM-DD`; times are local `HH:MM` (24h).
 */
import { z } from 'zod';
import { isIsoDate, isoDateSchema } from './academic.js';

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const;
/** Brief operational context only — never medical detail (approved decision B). */
export const ATTENDANCE_NOTE_MAX = 200;
/** Teachers may record/correct today and the previous N school-local days (decision C). */
export const TEACHER_ATTENDANCE_WINDOW_DAYS = 7;
/** Upper bound of one roster save (a section roster is far smaller). */
export const ATTENDANCE_MAX_RECORDS = 500;

export const HOMEWORK_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export const ASSIGNMENT_STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED'] as const;
export const CLASSWORK_TITLE_MAX = 200;
export const CLASSWORK_INSTRUCTIONS_MAX = 5000;

export const TIMETABLE_PERIOD_TYPES = ['INSTRUCTIONAL', 'BREAK', 'LUNCH', 'ASSEMBLY'] as const;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const attendanceNoteSchema = z
  .string()
  .trim()
  .max(ATTENDANCE_NOTE_MAX, `At most ${String(ATTENDANCE_NOTE_MAX)} characters`)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

/** Class work (homework or assignment) form: due date on/after the assigned date. */
export const classworkSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Title is required')
      .max(CLASSWORK_TITLE_MAX, `At most ${String(CLASSWORK_TITLE_MAX)} characters`),
    instructions: z
      .string()
      .trim()
      .max(CLASSWORK_INSTRUCTIONS_MAX, `At most ${String(CLASSWORK_INSTRUCTIONS_MAX)} characters`)
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    assignedDate: isoDateSchema,
    dueDate: isoDateSchema,
  })
  .refine(
    (v) => !isIsoDate(v.assignedDate) || !isIsoDate(v.dueDate) || v.dueDate >= v.assignedDate,
    {
      message: 'Due date must be on or after the assigned date',
      path: ['dueDate'],
    },
  );

export const timetablePeriodSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(60, 'At most 60 characters'),
    type: z.enum(TIMETABLE_PERIOD_TYPES),
    startTime: z.string().regex(TIME_PATTERN, 'Use 24-hour HH:MM'),
    endTime: z.string().regex(TIME_PATTERN, 'Use 24-hour HH:MM'),
  })
  .refine((v) => v.startTime < v.endTime, {
    message: 'End must be after start',
    path: ['endTime'],
  });

/** Adds `days` to a `YYYY-MM-DD` calendar date (pure date arithmetic, no timezone). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today's calendar date in an IANA timezone (the school/branch-local "today"). */
export function localToday(timezone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Weekday name of a calendar date. */
export function weekdayOf(
  date: string,
): 'SUNDAY' | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' {
  return (['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const)[
    new Date(`${date}T00:00:00.000Z`).getUTCDay()
  ] as 'MONDAY';
}

export interface AttendanceStatusCounts {
  PRESENT: number;
  ABSENT: number;
  LATE: number;
  EXCUSED: number;
}

/**
 * Exact attendance percentage: (PRESENT + LATE) ÷ (PRESENT + LATE + ABSENT) × 100.
 * EXCUSED and unmarked days count in neither numerator nor denominator; null when nothing is
 * eligible (no marks, or only EXCUSED). Rounding is a display concern (see roundRate).
 */
export function attendancePercentage(c: AttendanceStatusCounts): number | null {
  const eligible = c.PRESENT + c.LATE + c.ABSENT;
  return eligible ? ((c.PRESENT + c.LATE) / eligible) * 100 : null;
}

/** Display rounding for an attendance percentage: one decimal place, half away from zero. */
export function roundRate(pct: number | null): number | null {
  return pct === null ? null : Math.round(pct * 10) / 10;
}
