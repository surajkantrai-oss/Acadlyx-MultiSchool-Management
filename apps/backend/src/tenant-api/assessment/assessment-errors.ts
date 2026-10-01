import { badRequest, conflict, notFound } from '../../common/errors/domain-errors.js';

/** Stable, client-safe Phase 9 error codes. Out-of-scope ids are "not found"; SQL never leaks. */
export const ASSESSMENT_ERRORS = {
  examNotFound: () => notFound('EXAM_NOT_FOUND', 'Exam not found'),
  gradeScaleNotFound: () => notFound('GRADE_SCALE_NOT_FOUND', 'Grade scale not found'),
  examSubjectNotFound: () => notFound('EXAM_SUBJECT_NOT_FOUND', 'Exam subject not found'),
  componentNotFound: () => notFound('EXAM_COMPONENT_NOT_FOUND', 'Exam component not found'),
  sheetNotFound: () => notFound('MARK_SHEET_NOT_FOUND', 'Mark sheet not found'),
  subjectNotAssigned: () =>
    notFound('SUBJECT_NOT_ASSIGNED', 'You are not assigned to this class and subject'),
  resultNotPublished: () => notFound('RESULT_NOT_PUBLISHED', 'No published result is available'),
  studentNotFound: () => notFound('STUDENT_NOT_FOUND', 'Student not found'),
  submissionNotFound: () => notFound('SUBMISSION_NOT_FOUND', 'Submission not found'),
  branchNotFound: () => notFound('BRANCH_NOT_FOUND', 'Branch not found'),

  yearClosed: () =>
    badRequest('ACADEMIC_YEAR_CLOSED', 'This academic year is closed and read-only'),
  examNotEditable: () =>
    conflict('EXAM_NOT_EDITABLE', 'This exam can no longer be changed in its current state'),
  invalidTransition: () =>
    conflict('INVALID_STATUS_TRANSITION', 'That step is not allowed from the current state'),
  examNameTaken: () =>
    conflict('EXAM_NAME_TAKEN', 'An exam with this name already exists in this academic year'),
  gradeScaleNameTaken: () =>
    conflict('GRADE_SCALE_NAME_TAKEN', 'A grade scale with this name already exists this year'),
  datesInvalid: () =>
    badRequest('EXAM_DATES_INVALID', 'Exam dates must be ordered and inside the academic year'),
  subjectNotInGrade: () =>
    badRequest('SUBJECT_NOT_IN_GRADE', 'This subject is not taught in this grade'),
  subjectExists: () => conflict('EXAM_SUBJECT_EXISTS', 'This subject is already in the exam'),
  componentNameTaken: () =>
    conflict('COMPONENT_NAME_TAKEN', 'A component with this name already exists'),
  passMarksInvalid: () =>
    badRequest('PASS_MARKS_INVALID', 'Pass marks must be between 0 and the maximum marks'),
  scheduleInvalid: () =>
    badRequest(
      'SCHEDULE_INVALID',
      'The paper must be inside the exam dates and end after it starts',
    ),
  scheduleConflict: () =>
    conflict('SCHEDULE_CONFLICT', 'Another paper for this grade and branch overlaps this time'),
  structureIncomplete: (what: string) => badRequest('EXAM_STRUCTURE_INCOMPLETE', what),
  gradeScaleInvalid: () =>
    badRequest(
      'GRADE_SCALE_INVALID',
      'Grade bands must cover 0–100 exactly, without gaps or overlaps, with unique labels',
    ),
  gradeScaleInUse: () =>
    conflict('GRADE_SCALE_IN_USE', 'This grade scale is used by an exam that is no longer a draft'),
  examHasData: () =>
    conflict(
      'EXAM_HAS_DATA',
      'Only a draft exam without marks can be deleted — archive it instead',
    ),

  marksNotOpen: () => conflict('MARKS_ENTRY_CLOSED', 'Marks entry is not open for this exam'),
  marksFinalized: () => conflict('MARKS_FINALIZED', 'These marks are finalized and locked'),
  sheetLocked: () =>
    conflict('MARK_SHEET_LOCKED', 'This mark sheet is not editable in its current state'),
  invalidMark: (message = 'Marks must be between 0 and the component maximum (2 decimals)') =>
    badRequest('INVALID_MARK', message),
  studentNotEligible: () =>
    badRequest(
      'STUDENT_NOT_ELIGIBLE',
      'A student was not enrolled in this class on that paper date',
    ),
  marksIncomplete: () => conflict('MARKS_INCOMPLETE', 'Some required marks are still missing'),
  sheetsNotFinalized: () =>
    conflict('MARK_SHEETS_NOT_FINALIZED', 'Every mark sheet must be finalized first'),
  staleVersion: (what = 'This record') =>
    conflict('STALE_VERSION', `${what} was changed by someone else. Reload and try again.`),

  resultsIncomplete: () =>
    conflict('RESULTS_INCOMPLETE', 'Results cannot be published while any result is incomplete'),
  remarkNotAllowed: () =>
    notFound('REMARK_NOT_ALLOWED', 'Only the class teacher can write this remark'),

  gradeNotAllowed: () =>
    badRequest('GRADE_MARKS_NOT_ALLOWED', 'This assignment has no maximum marks — feedback only'),
  gradeInvalid: () =>
    badRequest('GRADE_INVALID', 'Marks must be between 0 and the assignment maximum'),
  gradeEmpty: () => badRequest('GRADE_EMPTY', 'Add marks or feedback before saving'),
  maxMarksLocked: () =>
    conflict('MAX_MARKS_LOCKED', 'Maximum marks cannot change once a grade has been published'),
};
