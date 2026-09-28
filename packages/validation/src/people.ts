/**
 * People & onboarding validation (Phase 5). Patterns are shared by the backend DTOs
 * (authoritative) and School Admin forms. Names are only trimmed; identifiers are upper-cased.
 * Phone/email NORMALISATION is done by the backend's Phase 3 identifier helpers.
 */
import { z } from 'zod';
import { isIsoDate } from './academic.js';
import { PHONE_MESSAGE, PHONE_PATTERN, PLAIN_TEXT_MESSAGE, PLAIN_TEXT_PATTERN } from './tenant.js';

export const STUDENT_STATUSES = ['ACTIVE', 'INACTIVE', 'WITHDRAWN', 'GRADUATED'] as const;
export const TEACHER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export const GUARDIAN_RELATIONSHIPS = [
  'FATHER',
  'MOTHER',
  'GUARDIAN',
  'GRANDPARENT',
  'SIBLING',
  'OTHER',
] as const;
export const ENROLLMENT_STATUSES = ['ACTIVE', 'TRANSFERRED', 'WITHDRAWN', 'COMPLETED'] as const;
export const TEACHER_ASSIGNMENT_TYPES = ['SUBJECT_TEACHER', 'CLASS_TEACHER'] as const;
export const IMPORT_TYPES = ['STUDENTS', 'PARENTS', 'TEACHERS'] as const;

/**
 * Allowed student status transitions (approved Phase 5 lifecycle). GRADUATED is terminal;
 * WITHDRAWN → ACTIVE is re-admission.
 */
export const STUDENT_STATUS_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  ACTIVE: ['INACTIVE', 'WITHDRAWN', 'GRADUATED'],
  INACTIVE: ['ACTIVE', 'WITHDRAWN', 'GRADUATED'],
  WITHDRAWN: ['ACTIVE'],
  GRADUATED: [],
};

export function canTransitionStudent(from: string, to: string): boolean {
  return STUDENT_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Admission number / employee ID / parent code: 1–40 chars, letters, digits, / _ . - */
export const PERSON_ID_PATTERN = /^[A-Z0-9][A-Z0-9/_.-]{0,39}$/;
export const PERSON_ID_MESSAGE =
  'Use 1–40 letters, digits or / _ . - (starting with a letter or digit)';

export function normalizePersonId(value: string): string {
  return value.trim().toUpperCase();
}

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5_000;

const name = (max = 80) =>
  z.string().trim().min(1).max(max).regex(PLAIN_TEXT_PATTERN, PLAIN_TEXT_MESSAGE);
const optionalName = (max = 80) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(PLAIN_TEXT_PATTERN, PLAIN_TEXT_MESSAGE)
    .nullish()
    .transform((v) => (v ? v : null));
const personId = z
  .string()
  .transform(normalizePersonId)
  .pipe(z.string().regex(PERSON_ID_PATTERN, PERSON_ID_MESSAGE));
const optionalDate = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isIsoDate(v), 'Must be a valid date (YYYY-MM-DD)');
const optionalEmail = z
  .email()
  .max(254)
  .nullish()
  .or(z.literal('').transform(() => null));
const optionalPhone = z
  .string()
  .trim()
  .regex(PHONE_PATTERN, PHONE_MESSAGE)
  .nullish()
  .or(z.literal('').transform(() => null));

export const studentProfileSchema = z.object({
  admissionNumber: personId,
  firstName: name(),
  middleName: optionalName(),
  lastName: optionalName(),
  preferredName: optionalName(),
  dateOfBirth: optionalDate,
  admissionDate: optionalDate,
});

export const parentProfileSchema = z.object({
  parentCode: personId.nullish().or(z.literal('').transform(() => null)),
  firstName: name(),
  middleName: optionalName(),
  lastName: optionalName(),
  email: optionalEmail,
  phone: optionalPhone,
});

export const teacherProfileSchema = z.object({
  employeeId: personId,
  firstName: name(),
  middleName: optionalName(),
  lastName: optionalName(),
  email: optionalEmail,
  phone: optionalPhone,
  joiningDate: optionalDate,
});

export function fullName(p: {
  firstName: string;
  middleName?: string | null;
  lastName?: string | null;
}): string {
  return [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ');
}

// ---- Phase 6: School Admin workspace ---------------------------------------------------------

/** Profile login-account state ("NONE" = no linked login). */
export const ACCOUNT_STATES = [
  'NONE',
  'PENDING_ACTIVATION',
  'ACTIVE',
  'SUSPENDED',
  'DISABLED',
] as const;

/** Global search bounds: short queries are refused, long ones never reach the database. */
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 64;
/** Results per entity type in global search (links lead to the full, paginated lists). */
export const SEARCH_LIMIT_PER_TYPE = 6;
