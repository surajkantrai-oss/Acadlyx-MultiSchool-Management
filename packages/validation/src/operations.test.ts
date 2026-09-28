import { describe, expect, it } from 'vitest';
import {
  addDays,
  attendancePercentage,
  classworkSchema,
  localToday,
  roundRate,
  timetablePeriodSchema,
  weekdayOf,
} from './operations.js';

describe('Phase 7 operations validation', () => {
  it('computes the school-local today regardless of the server/browser clock', () => {
    const late = new Date('2026-09-28T20:00:00.000Z'); // 01:30 on the 29th in India
    expect(localToday('Asia/Kolkata', late)).toBe('2026-09-29');
    expect(localToday('America/New_York', late)).toBe('2026-09-28');
  });
  it('does calendar arithmetic and weekdays on plain dates', () => {
    expect(addDays('2026-09-28', -7)).toBe('2026-09-21');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(weekdayOf('2026-09-28')).toBe('MONDAY');
  });
  it('validates class work dates and period times', () => {
    expect(
      classworkSchema.safeParse({
        title: 'Read',
        assignedDate: '2026-09-28',
        dueDate: '2026-09-27',
      }).success,
    ).toBe(false);
    expect(
      classworkSchema.safeParse({ title: ' ', assignedDate: '2026-09-28', dueDate: '2026-09-28' })
        .success,
    ).toBe(false);
    expect(
      classworkSchema.safeParse({
        title: 'Read',
        assignedDate: '2026-09-28',
        dueDate: '2026-09-28',
      }).success,
    ).toBe(true);
    expect(
      timetablePeriodSchema.safeParse({
        name: 'P1',
        type: 'INSTRUCTIONAL',
        startTime: '09:45',
        endTime: '09:00',
      }).success,
    ).toBe(false);
    expect(
      timetablePeriodSchema.safeParse({
        name: 'P1',
        type: 'BREAK',
        startTime: '9:00',
        endTime: '09:45',
      }).success,
    ).toBe(false);
    expect(
      timetablePeriodSchema.safeParse({
        name: 'P1',
        type: 'LUNCH',
        startTime: '12:00',
        endTime: '12:30',
      }).success,
    ).toBe(true);
  });

  describe('attendance percentage = (PRESENT + LATE) / (PRESENT + LATE + ABSENT)', () => {
    const c = (p = 0, l = 0, a = 0, e = 0) => ({ PRESENT: p, LATE: l, ABSENT: a, EXCUSED: e });
    it('counts PRESENT and LATE in both parts, ABSENT in the denominator only', () => {
      expect(attendancePercentage(c(1))).toBe(100);
      expect(attendancePercentage(c(0, 1))).toBe(100);
      expect(attendancePercentage(c(0, 0, 1))).toBe(0);
    });
    it('excludes EXCUSED (never treated as absent) and unmarked days (not in the counts at all)', () => {
      expect(attendancePercentage(c(1, 0, 0, 5))).toBe(100);
      expect(attendancePercentage(c(0, 0, 1, 5))).toBe(0);
    });
    it('mixed: 18 present, 2 late, 3 absent, 2 excused = 20/23', () => {
      expect(attendancePercentage(c(18, 2, 3, 2))).toBeCloseTo((20 / 23) * 100, 10);
      expect(roundRate(attendancePercentage(c(18, 2, 3, 2)))).toBe(87);
      expect(roundRate(attendancePercentage(c(2, 0, 1)))).toBe(66.7);
    });
    it('is null (not 0%) when all are EXCUSED or nothing eligible is marked', () => {
      expect(attendancePercentage(c(0, 0, 0, 4))).toBeNull();
      expect(attendancePercentage(c())).toBeNull();
      expect(roundRate(null)).toBeNull();
    });
  });
});
