/**
 * School & academic configuration validation (Phase 4).
 *
 * Patterns are exported so the backend's class-validator DTOs (authoritative) and the School
 * Admin forms (zod) enforce identical rules. Human-facing names are preserved as typed (only
 * trimmed); machine codes are normalised to upper-case.
 */
import { z } from 'zod';
import { PLAIN_TEXT_MESSAGE, PLAIN_TEXT_PATTERN } from './tenant.js';

export const WEEKDAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;
export const SCHOOL_BOARDS = ['CBSE', 'ICSE', 'STATE_BOARD', 'IB', 'CAMBRIDGE', 'OTHER'] as const;
export const ACADEMIC_YEAR_STATUSES = ['PLANNED', 'ACTIVE', 'CLOSED'] as const;

/** Upper-case letters/digits, may contain - or _ after the first character. 1–20 chars. */
export const ACADEMIC_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,19}$/;
export const ACADEMIC_CODE_MESSAGE =
  'Code must be 1–20 characters: letters, digits, - or _ (starting with a letter or digit)';

/** Loose international postal code: letters, digits, spaces, hyphens. */
export const POSTAL_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 -]{1,11}$/;
export const POSTAL_CODE_MESSAGE = 'Postal code may contain letters, digits, spaces and hyphens';

/** ISO 3166-1 alpha-2 country code. */
export const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
export const COUNTRY_CODE_MESSAGE = 'Country must be a 2-letter ISO code such as IN';

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

/** True for real IANA identifiers (Asia/Kolkata); rejects abbreviations like IST and offsets. */
export function isIanaTimezone(value: string): boolean {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(value) && value !== 'UTC') return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Calendar-valid `YYYY-MM-DD` (rejects 2026-02-30). */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const plainText = (max: number) =>
  z.string().trim().min(1).max(max).regex(PLAIN_TEXT_PATTERN, PLAIN_TEXT_MESSAGE);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(PLAIN_TEXT_PATTERN, PLAIN_TEXT_MESSAGE)
    .nullish()
    .transform((v) => (v ? v : null));

export const academicCodeSchema = z
  .string()
  .transform(normalizeCode)
  .pipe(z.string().regex(ACADEMIC_CODE_PATTERN, ACADEMIC_CODE_MESSAGE));

export const timezoneSchema = z
  .string()
  .trim()
  .refine(isIanaTimezone, 'Must be a valid IANA time zone, e.g. Asia/Kolkata');

export const isoDateSchema = z.string().refine(isIsoDate, 'Must be a valid date (YYYY-MM-DD)');

const addressShape = {
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(100),
  state: optionalText(100),
  postalCode: z
    .string()
    .trim()
    .regex(POSTAL_CODE_PATTERN, POSTAL_CODE_MESSAGE)
    .nullish()
    .or(z.literal('').transform(() => null)),
  country: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(COUNTRY_CODE_PATTERN, COUNTRY_CODE_MESSAGE))
    .nullish()
    .or(z.literal('').transform(() => null)),
};

const contactShape = {
  email: z
    .email()
    .max(254)
    .nullish()
    .or(z.literal('').transform(() => null)),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9 ()-]{6,19}$/, 'Phone must contain 7–20 digits')
    .nullish()
    .or(z.literal('').transform(() => null)),
};

export const schoolProfileSchema = z
  .object({
    name: plainText(160),
    shortName: optionalText(40),
    code: academicCodeSchema.nullish().or(z.literal('').transform(() => null)),
    board: z.enum(SCHOOL_BOARDS).nullish(),
    boardName: optionalText(100),
    website: z
      .url({ protocol: /^https?$/ })
      .max(2048)
      .nullish()
      .or(z.literal('').transform(() => null)),
    ...contactShape,
    ...addressShape,
  })
  .refine((v) => v.board === 'OTHER' || !v.boardName, {
    message: 'A custom board name is only allowed when the board is Other',
    path: ['boardName'],
  });

export const branchSchema = z.object({
  name: plainText(120),
  code: academicCodeSchema,
  timezone: timezoneSchema,
  ...contactShape,
  ...addressShape,
});

export const academicYearSchema = z
  .object({ name: plainText(40), startDate: isoDateSchema, endDate: isoDateSchema })
  .refine((v) => v.startDate < v.endDate, {
    message: 'The end date must be after the start date',
    path: ['endDate'],
  });

export const gradeSchema = z.object({ name: plainText(60), code: academicCodeSchema });

export const sectionSchema = z.object({
  name: plainText(40),
  code: academicCodeSchema,
  capacity: z.coerce.number().int().min(1).max(1000).nullish(),
});

export const subjectSchema = z.object({ name: plainText(100), code: academicCodeSchema });

export const academicSettingsSchema = z.object({
  timezone: timezoneSchema,
  weekStartDay: z.enum(WEEKDAYS),
  workingDays: z
    .array(z.enum(WEEKDAYS))
    .min(1, 'Select at least one working day')
    .refine((days) => new Set(days).size === days.length, 'Working days must be unique'),
  academicYearStartMonth: z.coerce.number().int().min(1).max(12),
});
