import { describe, expect, it } from 'vitest';
import {
  componentLabel,
  dueLabel,
  formatDate,
  formatInstant,
  groupWeek,
  OUTCOME_LABEL,
  outcomeTone,
  rateLabel,
} from './format';

describe('mobile formatting', () => {
  it('formats school-local dates without shifting by the device time zone', () => {
    const tz = process.env.TZ;
    for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC']) {
      process.env.TZ = zone;
      expect(formatDate('2026-09-30')).toBe('Wed 30 Sep 2026');
    }
    process.env.TZ = tz;
  });

  it('due labels are relative to the school’s today', () => {
    expect(dueLabel('2026-09-28', '2026-09-28')).toBe('Due today');
    expect(dueLabel('2026-09-29', '2026-09-28')).toBe('Due tomorrow');
    expect(dueLabel('2026-10-05', '2026-09-28')).toBe('Due Mon 5 Oct 2026');
    expect(dueLabel('2026-09-20', '2026-09-28')).toBe('Was due Sun 20 Sep 2026');
  });

  it('submission instants are shown in the school time zone', () => {
    // 20:00 UTC is already the next day in India.
    expect(formatInstant('2026-09-28T20:00:00.000Z', 'Asia/Kolkata')).toContain('29 Sept 2026');
  });

  it('attendance rate: null means "no data", never 0%', () => {
    expect(rateLabel(null)).toBe('No attendance recorded yet');
    expect(rateLabel(87)).toBe('87% attendance');
  });

  it('groups a week by working day, lessons by start time', () => {
    const e = (weekday: 'MONDAY' | 'TUESDAY', startTime: string) =>
      ({ id: `${weekday}${startTime}`, weekday, startTime }) as never;
    const week = groupWeek(
      ['TUESDAY', 'MONDAY'],
      [e('MONDAY', '10:00'), e('MONDAY', '09:00'), e('TUESDAY', '09:00')],
    );
    expect(week.map((d) => d.day)).toEqual(['MONDAY', 'TUESDAY']);
    expect(week[0]?.lessons.map((l) => l.startTime)).toEqual(['09:00', '10:00']);
  });

  it('labels result states in words (never colour alone)', () => {
    const base = { name: 'Theory', maxMarks: '80.00', passMarks: '28.00' };
    expect(componentLabel({ ...base, status: 'MARKED', marks: '72.50', passed: true })).toBe(
      '72.50 / 80.00',
    );
    expect(componentLabel({ ...base, status: 'MARKED', marks: '20.00', passed: false })).toBe(
      '20.00 / 80.00 · below pass mark',
    );
    expect(componentLabel({ ...base, status: 'ABSENT', marks: null, passed: false })).toBe(
      'Absent (0 / 80.00)',
    );
    expect(componentLabel({ ...base, status: 'EXEMPT', marks: null, passed: null })).toBe('Exempt');
    expect(OUTCOME_LABEL.FAIL).toBe('Fail');
    expect(outcomeTone('PASS').symbol).toBe('✓');
    expect(outcomeTone('INCOMPLETE').tone).toBe('warn');
  });
});
