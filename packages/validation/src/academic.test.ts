import { describe, expect, it } from 'vitest';
import {
  academicSettingsSchema,
  academicYearSchema,
  branchSchema,
  isIanaTimezone,
  isIsoDate,
  normalizeCode,
  schoolProfileSchema,
  sectionSchema,
} from './academic.js';

describe('academic validation', () => {
  it('accepts real IANA zones only', () => {
    expect(isIanaTimezone('Asia/Kolkata')).toBe(true);
    expect(isIanaTimezone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isIanaTimezone('UTC')).toBe(true);
    for (const bad of ['IST', '+05:30', 'GMT+5', 'Asia/Nowhere', '']) {
      expect(isIanaTimezone(bad)).toBe(false);
    }
  });

  it('validates calendar dates without time-zone shifts', () => {
    expect(isIsoDate('2026-04-01')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-4-1')).toBe(false);
    expect(
      academicYearSchema.safeParse({
        name: '2026–27',
        startDate: '2027-03-31',
        endDate: '2026-04-01',
      }).success,
    ).toBe(false);
    expect(
      academicYearSchema.safeParse({
        name: '2026–27',
        startDate: '2026-04-01',
        endDate: '2027-03-31',
      }).success,
    ).toBe(true);
  });

  it('normalises codes but preserves names', () => {
    expect(normalizeCode('  g5-a ')).toBe('G5-A');
    const parsed = branchSchema.parse({
      name: "  St. Joseph's Campus ",
      code: 'main',
      timezone: 'Asia/Kolkata',
      country: 'in',
    });
    expect(parsed.name).toBe("St. Joseph's Campus");
    expect(parsed.code).toBe('MAIN');
    expect(parsed.country).toBe('IN');
    expect(
      branchSchema.safeParse({ name: 'X', code: 'bad code!', timezone: 'Asia/Kolkata' }).success,
    ).toBe(false);
    expect(
      branchSchema.safeParse({ name: '<b>x</b>', code: 'X', timezone: 'Asia/Kolkata' }).success,
    ).toBe(false);
  });

  it('enforces board name only for OTHER, positive capacity and unique working days', () => {
    expect(
      schoolProfileSchema.safeParse({ name: 'S', board: 'CBSE', boardName: 'X' }).success,
    ).toBe(false);
    expect(
      schoolProfileSchema.safeParse({ name: 'S', board: 'OTHER', boardName: 'Montessori' }).success,
    ).toBe(true);
    expect(sectionSchema.safeParse({ name: 'A', code: 'A', capacity: 0 }).success).toBe(false);
    expect(sectionSchema.safeParse({ name: 'A', code: 'A', capacity: null }).success).toBe(true);
    const settings = {
      timezone: 'Asia/Kolkata',
      weekStartDay: 'MONDAY',
      academicYearStartMonth: 4,
    };
    expect(academicSettingsSchema.safeParse({ ...settings, workingDays: [] }).success).toBe(false);
    expect(
      academicSettingsSchema.safeParse({ ...settings, workingDays: ['MONDAY', 'MONDAY'] }).success,
    ).toBe(false);
    expect(
      academicSettingsSchema.safeParse({ ...settings, workingDays: ['SUNDAY', 'MONDAY'] }).success,
    ).toBe(true);
  });
});
