import { badRequest, conflict, notFound } from '../../common/errors/domain-errors.js';

/**
 * Stable, client-safe error codes for school & academic configuration. Messages never reveal
 * whether an id exists in another tenant (cross-tenant ids are simply "not found").
 */
export const ACADEMIC_ERRORS = {
  schoolNotFound: () => notFound('SCHOOL_NOT_FOUND', 'School not found'),
  branchNotFound: () => notFound('BRANCH_NOT_FOUND', 'Branch not found'),
  academicYearNotFound: () => notFound('ACADEMIC_YEAR_NOT_FOUND', 'Academic year not found'),
  gradeNotFound: () => notFound('GRADE_NOT_FOUND', 'Grade not found'),
  sectionNotFound: () => notFound('SECTION_NOT_FOUND', 'Section not found'),
  subjectNotFound: () => notFound('SUBJECT_NOT_FOUND', 'Subject not found'),
  gradeSubjectNotFound: () =>
    notFound('GRADE_SUBJECT_NOT_FOUND', 'This subject is not assigned to the grade'),

  duplicateSchoolCode: () =>
    conflict('DUPLICATE_SCHOOL_CODE', 'Another school already uses this code'),
  duplicateBranchCode: () =>
    conflict('DUPLICATE_BRANCH_CODE', 'Another branch of this school already uses this code'),
  duplicateAcademicYearName: () =>
    conflict('DUPLICATE_ACADEMIC_YEAR_NAME', 'Another academic year already uses this name'),
  academicYearOverlap: () =>
    conflict('ACADEMIC_YEAR_OVERLAP', 'The dates overlap another academic year of this school'),
  duplicateGradeCode: () =>
    conflict('DUPLICATE_GRADE_CODE', 'Another grade of this school already uses this code'),
  duplicateSectionCode: () =>
    conflict(
      'DUPLICATE_SECTION_CODE',
      'This grade already has a section with this code for the branch and academic year',
    ),
  duplicateSubjectCode: () =>
    conflict('DUPLICATE_SUBJECT_CODE', 'Another subject of this school already uses this code'),

  primaryBranchRequired: () =>
    conflict(
      'PRIMARY_BRANCH_REQUIRED',
      'The primary branch cannot be deactivated. Make another branch primary first.',
    ),
  branchInactive: () => conflict('BRANCH_INACTIVE', 'The branch is inactive'),
  gradeInactive: () => conflict('GRADE_INACTIVE', 'The grade is inactive'),
  subjectInactive: () => conflict('SUBJECT_INACTIVE', 'The subject is inactive'),
  academicYearTransition: (from: string, to: string) =>
    conflict(
      'ACADEMIC_YEAR_TRANSITION_INVALID',
      `An academic year cannot go from ${from} to ${to}`,
    ),
  academicYearNotActive: () =>
    conflict('ACADEMIC_YEAR_NOT_ACTIVE', 'Only an active academic year can be made current'),
  academicYearDatesLocked: () =>
    conflict(
      'ACADEMIC_YEAR_DATES_LOCKED',
      'Dates can only be changed while the academic year is planned',
    ),
  academicYearClosed: () => conflict('ACADEMIC_YEAR_CLOSED', 'The academic year is closed'),
  currentYearCannotClose: () =>
    conflict(
      'CURRENT_ACADEMIC_YEAR_CANNOT_CLOSE',
      'The current academic year cannot be closed. Make another year current first.',
    ),
  invalidDates: () =>
    badRequest('ACADEMIC_YEAR_DATES_INVALID', 'The end date must be after the start date'),
  reorderMismatch: () =>
    badRequest(
      'REORDER_MISMATCH',
      'The order must list every item of the list exactly once (and nothing else)',
    ),
} as const;
