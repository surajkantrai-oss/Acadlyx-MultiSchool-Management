/**
 * Phase 9 — exams, marks, results & report cards; assignment grading. Official numbers travel
 * as decimal STRINGS (e.g. "17.50") so no client ever sees a binary float; percentages are
 * provided both exact (6 dp) and for display (2 dp). Dates are school-local YYYY-MM-DD; times are
 * branch-local HH:MM.
 */
export type ExamStatus =
  'DRAFT' | 'PUBLISHED' | 'MARKS_ENTRY' | 'MARKS_FINALIZED' | 'RESULTS_PUBLISHED' | 'ARCHIVED';
export type MarkSheetStatus = 'DRAFT' | 'SUBMITTED' | 'FINALIZED' | 'REOPENED';
export type MarkState = 'MARKED' | 'ABSENT' | 'EXEMPT';
export type ResultOutcome = 'PASS' | 'FAIL' | 'EXEMPT';
export type OverallResultStatus = ResultOutcome | 'INCOMPLETE';
export type ExamTransition = 'publish' | 'open-marks' | 'finalize-marks' | 'archive';

export interface GradeBandInput {
  label: string;
  minPercentage: string;
  maxPercentage: string;
}
export interface GradeScale {
  id: string;
  academicYearId: string;
  name: string;
  version: number;
  bands: (GradeBandInput & { displayOrder: number })[];
  inUse: boolean;
}

export interface ExamSchedule {
  branchId: string;
  branchName: string;
  examDate: string;
  startTime: string;
  endTime: string;
}
export interface ExamComponent {
  id: string;
  name: string;
  maxMarks: string;
  passMarks: string | null;
  displayOrder: number;
  schedules: ExamSchedule[];
}
export interface ExamSubject {
  id: string;
  gradeId: string;
  gradeName: string;
  subjectId: string;
  subjectName: string;
  passMarks: string | null;
  totalMaxMarks: string;
  displayOrder: number;
  components: ExamComponent[];
}
export interface ExamSummary {
  id: string;
  name: string;
  academicYearId: string;
  academicYearName: string;
  academicYearStatus: 'PLANNED' | 'ACTIVE' | 'CLOSED';
  startDate: string;
  endDate: string;
  status: ExamStatus;
  version: number;
  gradeNames: string[];
  currentPublicationVersion: number | null;
}
export interface ExamDetail extends ExamSummary {
  description: string | null;
  gradeScale: { id: string; name: string } | null;
  subjects: ExamSubject[];
  /** Branches with an active section of each grade (each needs a schedule per component). */
  branchesByGrade: { gradeId: string; branches: { id: string; name: string }[] }[];
  can: {
    edit: boolean;
    transitions: ExamTransition[];
    delete: boolean;
    publishResults: boolean;
  };
}
export interface CreateExamRequest {
  academicYearId: string;
  name: string;
  description?: string | null;
  startDate: string;
  endDate: string;
  gradeScaleId?: string | null;
}
export type UpdateExamRequest = Partial<Omit<CreateExamRequest, 'academicYearId'>> & {
  expectedVersion: number;
};

export interface MarkSheetSummary {
  examSubjectId: string;
  sectionId: string;
  className: string;
  branchName: string;
  subjectName: string;
  status: MarkSheetStatus | 'NOT_STARTED';
  version: number;
  studentCount: number;
  enteredCount: number;
  requiredCount: number;
  /** Server-computed: may the caller act on this sheet? */
  canEdit: boolean;
}
export interface MarkSheetEntry {
  componentId: string;
  status: MarkState | null;
  marks: string | null;
  version: number;
  /** false when the student was not enrolled on this component's paper date. */
  eligible: boolean;
}
export interface MarkSheet {
  examId: string;
  examName: string;
  examStatus: ExamStatus;
  examSubjectId: string;
  subjectName: string;
  sectionId: string;
  className: string;
  status: MarkSheetStatus | 'NOT_STARTED';
  version: number;
  components: {
    id: string;
    name: string;
    maxMarks: string;
    passMarks: string | null;
    examDate: string | null;
  }[];
  students: {
    studentId: string;
    name: string;
    admissionNumber: string;
    entries: MarkSheetEntry[];
  }[];
  can: { edit: boolean; submit: boolean; finalize: boolean; reopen: boolean };
  events: {
    at: string;
    fromStatus: MarkSheetStatus;
    toStatus: MarkSheetStatus;
    reason: string | null;
    actorName: string | null;
  }[];
}
export interface SaveMarksRequest {
  expectedVersion: number;
  entries: { studentId: string; componentId: string; status: MarkState; marks?: string | null }[];
}

export interface ComponentResultView {
  name: string;
  maxMarks: string;
  passMarks: string | null;
  status: MarkState | null;
  marks: string | null;
  passed: boolean | null;
}
export interface SubjectResultView {
  subjectName: string;
  obtained: string | null;
  maxMarks: string | null;
  passMarks: string | null;
  percentage: string | null;
  percentageDisplay: string | null;
  grade: string | null;
  outcome: ResultOutcome | 'INCOMPLETE';
  components: ComponentResultView[];
}
export interface StudentResultRow {
  studentId: string;
  name: string;
  admissionNumber: string;
  className: string;
  obtained: string;
  maxMarks: string;
  percentageDisplay: string | null;
  grade: string | null;
  status: OverallResultStatus;
}
export interface ClassResults {
  examId: string;
  examName: string;
  examStatus: ExamStatus;
  rows: StudentResultRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  incompleteCount: number;
  canPublish: boolean;
}

/** Report card = an immutable published snapshot (or a live preview for staff). */
export interface ReportCard {
  preview: boolean;
  publicationVersion: number | null;
  publishedAt: string | null;
  schoolName: string;
  examName: string;
  academicYearName: string;
  studentName: string;
  admissionNumber: string;
  gradeName: string;
  sectionName: string;
  subjects: SubjectResultView[];
  obtained: string;
  maxMarks: string;
  percentage: string | null;
  percentageDisplay: string | null;
  grade: string | null;
  status: OverallResultStatus;
  remark: string | null;
}
export interface ResultPublicationSummary {
  id: string;
  version: number;
  isCurrent: boolean;
  publishedAt: string;
  publishedByName: string | null;
  studentCount: number;
}
/** Parent/Student list item: one published exam result (current version only). */
export interface PublishedResultSummary {
  examId: string;
  examName: string;
  academicYearName: string;
  publishedAt: string;
  version: number;
  percentageDisplay: string | null;
  grade: string | null;
  status: ResultOutcome;
}

// ---- Assignment grading ------------------------------------------------------------------------

export type GradeReleaseStatus = 'DRAFT' | 'PUBLISHED';
export interface SubmissionGrade {
  id: string;
  status: GradeReleaseStatus;
  marksAwarded: string | null;
  feedback: string | null;
  version: number;
  publishedAt: string | null;
}
export interface GradingSubmissionVersion {
  version: number;
  submittedAt: string;
  textContent: string | null;
  externalUrl: string | null;
  grade: SubmissionGrade | null;
}
export interface GradingRow {
  studentId: string;
  name: string;
  admissionNumber: string;
  submissionId: string;
  latestVersion: number;
  late: boolean;
  versions: GradingSubmissionVersion[];
}
export interface AssignmentGrading {
  assignmentId: string;
  title: string;
  className: string;
  subjectName: string;
  maxMarks: string | null;
  rows: GradingRow[];
}
export interface SaveGradeRequest {
  marksAwarded?: string | null;
  feedback?: string | null;
  /** 0 when no grade exists yet for this version. */
  expectedVersion: number;
}
/** What a student/parent sees: ONLY a published grade of the LATEST submission version. */
export interface VisibleGrade {
  submissionVersion: number;
  marksAwarded: string | null;
  maxMarks: string | null;
  feedback: string | null;
  publishedAt: string;
}
