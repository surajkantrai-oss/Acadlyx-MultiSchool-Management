import type {
  AttendanceStatus,
  ComponentResultView,
  OverallResultStatus,
  TimetableEntry,
  Weekday,
} from '@acadlyx/types';

/*
 * Display helpers (pure, unit-tested). Dates are school-local `YYYY-MM-DD` and are formatted as
 * calendar dates (UTC maths on the date itself) — the DEVICE time zone never shifts them, so a
 * travelling student still sees the school's dates. Times are branch-local `HH:MM`, shown as-is.
 */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${(WEEKDAYS[d.getUTCDay()] ?? '').slice(0, 3)} ${String(d.getUTCDate())} ${MONTHS[d.getUTCMonth()] ?? ''} ${String(d.getUTCFullYear())}`;
}

/** "Due today", "Due tomorrow", "Due Mon 5 Oct 2026", "Was due …" relative to the school's today. */
export function dueLabel(due: string, today: string): string {
  if (due === today) return 'Due today';
  const next = new Date(`${today}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  if (due === next.toISOString().slice(0, 10)) return 'Due tomorrow';
  return due < today ? `Was due ${formatDate(due)}` : `Due ${formatDate(due)}`;
}

/** Instant (ISO timestamp) shown in the SCHOOL's time zone, never the device's. */
export function formatInstant(iso: string, timezone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

export const ATTENDANCE_LABEL: Record<
  AttendanceStatus,
  { label: string; symbol: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }
> = {
  PRESENT: { label: 'Present', symbol: '✓', tone: 'good' },
  LATE: { label: 'Late', symbol: '◷', tone: 'warn' },
  ABSENT: { label: 'Absent', symbol: '✕', tone: 'bad' },
  EXCUSED: { label: 'Excused', symbol: '○', tone: 'neutral' },
};

export function rateLabel(rate: number | null): string {
  return rate === null ? 'No attendance recorded yet' : `${String(rate)}% attendance`;
}

const DAY_ORDER: Weekday[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];
export const dayName = (d: Weekday) => d.charAt(0) + d.slice(1).toLowerCase();

/** Timetable as day sections (working days in school order), lessons by start time. */
export function groupWeek(
  workingDays: Weekday[],
  entries: TimetableEntry[],
): { day: Weekday; lessons: TimetableEntry[] }[] {
  const days = DAY_ORDER.filter((d) => workingDays.includes(d));
  return days.map((day) => ({
    day,
    lessons: entries
      .filter((e) => e.weekday === day)
      .sort((a, b) => a.startTime.localeCompare(b.startTime)),
  }));
}

// ---- Results (Phase 9) -------------------------------------------------------------------------

/** Result outcomes: always words (plus a symbol on the chip), never colour alone. */
export const OUTCOME_LABEL: Record<OverallResultStatus, string> = {
  PASS: 'Pass',
  FAIL: 'Fail',
  EXEMPT: 'Exempt',
  INCOMPLETE: 'Incomplete',
};

export function outcomeTone(status: OverallResultStatus): {
  symbol: string;
  tone: 'good' | 'bad' | 'neutral' | 'warn';
} {
  switch (status) {
    case 'PASS':
      return { symbol: '✓', tone: 'good' };
    case 'FAIL':
      return { symbol: '✕', tone: 'bad' };
    case 'EXEMPT':
      return { symbol: '–', tone: 'neutral' };
    case 'INCOMPLETE':
      return { symbol: '…', tone: 'warn' };
  }
}

/** One component line: "Absent", "Exempt", or "obtained / max" (with "below pass mark"). */
export function componentLabel(c: ComponentResultView): string {
  if (c.status === 'ABSENT') return `Absent (0 / ${c.maxMarks})`;
  if (c.status === 'EXEMPT') return 'Exempt';
  if (c.status === null || c.marks === null) return 'Not entered';
  return `${c.marks} / ${c.maxMarks}${c.passed === false ? ' · below pass mark' : ''}`;
}
