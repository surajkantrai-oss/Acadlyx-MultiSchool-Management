import { badRequest, conflict, notFound } from '../../common/errors/domain-errors.js';

/**
 * Stable, client-safe codes for academic operations (Phase 7). Out-of-scope or other-tenant ids
 * are simply "not found"; constraint names and SQL never reach clients.
 */
export const OPS_ERRORS = {
  invalidMaxMarks: () => badRequest('MAX_MARKS_INVALID', 'Maximum marks must be greater than 0'),
  sectionNotFound: () => notFound('SECTION_NOT_FOUND', 'Class not found'),
  sessionNotFound: () => notFound('ATTENDANCE_NOT_FOUND', 'Attendance not found'),
  studentNotFound: () => notFound('STUDENT_NOT_FOUND', 'Student not found'),
  classworkNotFound: (kind: string) =>
    notFound(kind === 'homework' ? 'HOMEWORK_NOT_FOUND' : 'ASSIGNMENT_NOT_FOUND', 'Not found'),
  subjectNotFound: () => notFound('SUBJECT_NOT_FOUND', 'Subject not found'),
  teacherNotFound: () => notFound('TEACHER_NOT_FOUND', 'Teacher not found'),
  periodNotFound: () => notFound('PERIOD_NOT_FOUND', 'Period not found'),
  entryNotFound: () => notFound('TIMETABLE_ENTRY_NOT_FOUND', 'Timetable entry not found'),
  contextNotFound: () =>
    notFound('CONTEXT_NOT_FOUND', 'That branch or academic year does not exist in this school'),

  futureDate: () =>
    badRequest('ATTENDANCE_FUTURE_DATE', 'Attendance cannot be recorded for a future date'),
  outsideTeacherWindow: (days: number) =>
    badRequest(
      'ATTENDANCE_OUTSIDE_WINDOW',
      `Teachers can record or correct attendance only for today and the previous ${String(days)} school-local calendar days`,
    ),
  yearNotActive: () =>
    badRequest('ACADEMIC_YEAR_NOT_ACTIVE', 'This academic year is not open for new records'),
  yearClosed: () =>
    badRequest('ACADEMIC_YEAR_CLOSED', 'This academic year is closed and read-only'),
  dateOutsideYear: () =>
    badRequest('DATE_OUTSIDE_ACADEMIC_YEAR', 'The date is outside the academic year of this class'),
  sectionUnavailable: () =>
    badRequest('SECTION_UNAVAILABLE', 'This class, its branch or its grade is inactive'),
  notOnRoster: () =>
    badRequest(
      'STUDENT_NOT_ON_ROSTER',
      'One or more students are not enrolled in this class on that date',
    ),
  duplicateStudent: () => badRequest('DUPLICATE_STUDENT', 'A student appears more than once'),
  expectedVersionRequired: () =>
    conflict(
      'ATTENDANCE_STALE',
      'Attendance was already saved for this class and date. Reload and try again.',
    ),
  staleVersion: (what = 'This record') =>
    conflict('STALE_VERSION', `${what} was changed by someone else. Reload and try again.`),
  sessionExists: () =>
    conflict(
      'ATTENDANCE_STALE',
      'Attendance was just saved by someone else. Reload and try again.',
    ),

  subjectNotInGrade: () =>
    badRequest('SUBJECT_NOT_IN_GRADE', "This subject is not taught in this class's grade"),
  notAssigned: () =>
    notFound(
      'CLASS_SUBJECT_NOT_ASSIGNED',
      'You are not assigned to teach this subject in this class',
    ),
  teacherInactive: () =>
    badRequest('TEACHER_INACTIVE', 'Inactive teachers cannot be scheduled or assigned work'),
  teacherNotAssigned: () =>
    badRequest(
      'TEACHER_NOT_ASSIGNED',
      'This teacher is not assigned to teach this subject in this class',
    ),
  dueBeforeAssigned: () =>
    badRequest('DUE_BEFORE_ASSIGNED', 'Due date must be on or after the assigned date'),
  invalidTransition: (from: string, to: string) =>
    badRequest(
      'INVALID_STATUS_TRANSITION',
      `Cannot change from ${from.toLowerCase()} to ${to.toLowerCase()}`,
    ),
  notEditable: () => badRequest('NOT_EDITABLE', 'Closed or archived work can no longer be edited'),

  nonWorkingDay: () => badRequest('NON_WORKING_DAY', 'The school does not work on that day'),
  periodNotInstructional: () =>
    badRequest(
      'PERIOD_NOT_INSTRUCTIONAL',
      'Lessons can only be scheduled in instructional periods',
    ),
  periodWrongBranch: () =>
    badRequest(
      'PERIOD_NOT_IN_BRANCH',
      "The period does not belong to this class's branch and year",
    ),
  periodTimes: () =>
    badRequest('PERIOD_TIMES_INVALID', 'The end time must be after the start time'),
  periodOverlap: () =>
    conflict('PERIOD_OVERLAP', 'This period overlaps another period of the same bell schedule'),
  periodNameTaken: () =>
    conflict('PERIOD_NAME_TAKEN', 'Another period of this bell schedule has this name'),
  periodInUse: () =>
    conflict('PERIOD_IN_USE', 'Lessons are scheduled in this period; move or remove them first'),
  sectionConflict: () =>
    conflict('SECTION_TIMETABLE_CONFLICT', 'This class already has a lesson in that period'),
  teacherConflict: () =>
    conflict('TEACHER_TIMETABLE_CONFLICT', 'This teacher is already scheduled during this time'),
};

/** True when a database error names the given constraint (unique, check, FK or exclusion). */
export function violates(error: unknown, constraint: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const text = JSON.stringify({
    message: (error as Error).message,
    meta: (error as { meta?: unknown }).meta,
  });
  return text.includes(constraint);
}
