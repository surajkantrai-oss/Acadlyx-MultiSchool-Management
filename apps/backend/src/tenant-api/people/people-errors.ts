import { badRequest, conflict, notFound } from '../../common/errors/domain-errors.js';

/**
 * Stable, client-safe error codes for people/enrollment/onboarding. Ids of other tenants or
 * schools are simply "not found" — responses never confirm their existence.
 */
export const PEOPLE_ERRORS = {
  studentNotFound: () => notFound('STUDENT_NOT_FOUND', 'Student not found'),
  parentNotFound: () => notFound('PARENT_NOT_FOUND', 'Parent not found'),
  teacherNotFound: () => notFound('TEACHER_NOT_FOUND', 'Teacher not found'),
  guardianNotFound: () => notFound('GUARDIAN_LINK_NOT_FOUND', 'Guardian link not found'),
  enrollmentNotFound: () => notFound('ENROLLMENT_NOT_FOUND', 'Enrollment not found'),
  assignmentNotFound: () => notFound('ASSIGNMENT_NOT_FOUND', 'Assignment not found'),
  sectionNotFound: () => notFound('SECTION_NOT_FOUND', 'Section not found'),
  subjectNotFound: () => notFound('SUBJECT_NOT_FOUND', 'Subject not found'),
  userNotFound: () => notFound('USER_NOT_FOUND', 'Account not found'),
  importNotFound: () => notFound('IMPORT_NOT_FOUND', 'Import not found'),

  duplicateAdmissionNumber: () =>
    conflict(
      'DUPLICATE_ADMISSION_NUMBER',
      'Another student of this school has this admission number',
    ),
  duplicateEmployeeId: () =>
    conflict('DUPLICATE_EMPLOYEE_ID', 'Another teacher of this school has this employee ID'),
  duplicateParentCode: () =>
    conflict('DUPLICATE_PARENT_CODE', 'Another parent of this school has this parent code'),
  guardianAlreadyLinked: () =>
    conflict('GUARDIAN_ALREADY_LINKED', 'This parent is already linked to the student'),
  primaryGuardianConflict: () =>
    conflict(
      'PRIMARY_GUARDIAN_CONFLICT',
      'The primary guardian changed at the same time — try again',
    ),
  parentInactive: () => conflict('PARENT_INACTIVE', 'The parent profile is inactive'),
  studentTransition: (from: string, to: string) =>
    conflict('STUDENT_STATUS_TRANSITION_INVALID', `A student cannot go from ${from} to ${to}`),
  studentNotActive: () => conflict('STUDENT_NOT_ACTIVE', 'Only an active student can be enrolled'),
  activeEnrollmentExists: () =>
    conflict(
      'ACTIVE_ENROLLMENT_EXISTS',
      'The student already has an active enrollment in this academic year — transfer it instead',
    ),
  enrollmentNotActive: () => conflict('ENROLLMENT_NOT_ACTIVE', 'The enrollment is not active'),
  transferYearMismatch: () =>
    badRequest('TRANSFER_YEAR_MISMATCH', 'A transfer must stay within the same academic year'),
  sameSection: () => badRequest('SAME_SECTION', 'The student is already in this section'),
  sectionUnavailable: () =>
    conflict(
      'SECTION_UNAVAILABLE',
      'The section, its branch or grade is inactive, or its academic year is closed',
    ),
  dateOutsideYear: () =>
    badRequest('DATE_OUTSIDE_ACADEMIC_YEAR', 'The date must fall within the academic year'),
  endBeforeStart: () =>
    badRequest('END_BEFORE_START', 'The end date cannot be before the enrollment start date'),
  teacherInactive: () => conflict('TEACHER_INACTIVE', 'The teacher is inactive'),
  subjectNotInGrade: () =>
    conflict('SUBJECT_NOT_IN_GRADE', "This subject is not configured for the section's grade"),
  subjectRequired: () =>
    badRequest('SUBJECT_REQUIRED', 'A subject is required for a subject-teacher assignment'),
  subjectNotAllowed: () =>
    badRequest('SUBJECT_NOT_ALLOWED', 'A class-teacher assignment has no subject'),
  classTeacherExists: () =>
    conflict('CLASS_TEACHER_EXISTS', 'This section already has a class teacher'),
  duplicateAssignment: () =>
    conflict('DUPLICATE_ASSIGNMENT', 'The teacher already teaches this subject in this section'),
  assignmentEnded: () => conflict('ASSIGNMENT_ENDED', 'The assignment has already ended'),

  profileAlreadyLinked: () =>
    conflict('PROFILE_ALREADY_LINKED', 'This profile already has a login account'),
  userAlreadyLinked: () =>
    conflict(
      'USER_ALREADY_LINKED',
      'That account is already linked to another profile of this kind',
    ),
  roleRequired: (role: string) =>
    conflict('ROLE_REQUIRED', `That account does not have the ${role} role`),
  identifierRequired: (message: string) => badRequest('IDENTIFIER_REQUIRED', message),
  identifierTaken: (field: string) =>
    conflict(
      'IDENTIFIER_TAKEN',
      `Another account in this school already uses this ${field} — link that account instead`,
    ),
  accountNotPending: () => conflict('ACCOUNT_NOT_PENDING', 'The account is not pending activation'),
  noAccount: () => conflict('NO_ACCOUNT', 'This profile has no login account'),
  useOtpActivation: () =>
    conflict('USE_OTP_ACTIVATION', 'This account activates with a code sent to its email/phone'),
  tryLater: () => conflict('TRY_LATER', 'Please try again later'),
} as const;
