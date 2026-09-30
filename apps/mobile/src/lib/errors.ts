import { ApiError } from '@acadlyx/api-client';

/**
 * Friendly, stable messages for API errors. Raw server/SQL text is never shown; unknown errors
 * fall back to a generic message. Kept free of React Native imports so it is unit-testable.
 */
const MESSAGES: Record<string, string> = {
  ASSIGNMENT_CLOSED: 'This assignment is closed and no longer accepts work.',
  ASSIGNMENT_ARCHIVED: 'This assignment has been archived.',
  SUBMISSION_NOT_ALLOWED: 'You can no longer submit to this assignment.',
  SUBMISSION_STALE: 'Your work was changed on another device. Reload to see the latest version.',
  SUBMISSION_INVALID: 'Add your answer or a link that starts with https://.',
  ACADEMIC_YEAR_CLOSED: 'That academic year is closed and read-only.',
  ACADEMIC_YEAR_NOT_ACTIVE: 'That academic year is not open for changes.',
  ATTENDANCE_OUTSIDE_WINDOW:
    'Teachers can record or correct attendance for today and the previous 7 days only.',
  ATTENDANCE_FUTURE_DATE: 'Attendance cannot be recorded for a future date.',
  ATTENDANCE_STALE: 'Someone else saved this attendance first. Reload and review before saving.',
  STALE_VERSION: 'This was changed by someone else. Reload and try again.',
  STUDENT_NOT_ON_ROSTER: 'One of the students is no longer in this class for that date.',
  CLASS_SUBJECT_NOT_ASSIGNED: 'You are not assigned to teach that subject in that class.',
  SUBJECT_NOT_IN_GRADE: 'That subject is not taught in this grade.',
  DUE_BEFORE_ASSIGNED: 'The due date must be on or after the assigned date.',
  INVALID_STATUS_TRANSITION: 'That action is not available right now.',
  NOT_EDITABLE: 'This item can no longer be edited.',
  MOBILE_ROLE_REQUIRED: 'This account cannot use this part of the app.',
  NO_CURRENT_CLASS: 'No current class is set up yet. Please contact the school.',
  TOKEN_EXPIRED: 'Your session expired. Please sign in again.',
  SESSION_REVOKED: 'Your session ended. Please sign in again.',
};

export type ErrorKind = 'offline' | 'session' | 'notFound' | 'forbidden' | 'conflict' | 'other';

export function errorCode(error: unknown): string | null {
  return error instanceof ApiError ? (error.body?.code ?? null) : null;
}

export function errorKind(error: unknown): ErrorKind {
  if (!(error instanceof ApiError)) return 'offline';
  if (error.status === 401) return 'session';
  if (error.status === 404) return 'notFound';
  if (error.status === 403) return 'forbidden';
  if (error.status === 409) return 'conflict';
  return 'other';
}

export function friendlyError(error: unknown): string {
  const code = errorCode(error);
  if (code && MESSAGES[code]) return MESSAGES[code];
  switch (errorKind(error)) {
    case 'offline':
      return 'You appear to be offline. Check your connection and try again.';
    case 'session':
      return 'Your session ended. Please sign in again.';
    case 'notFound':
      return 'This item is not available.';
    case 'forbidden':
      return 'You don’t have access to this.';
    case 'conflict':
      return 'This was changed elsewhere. Reload and try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
