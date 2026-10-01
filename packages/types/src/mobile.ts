/**
 * Phase 8 mobile read models (Parent / Student / Teacher). Every payload is resolved on the
 * server from the authenticated user's own profile/relationships — the client never supplies
 * identity. Dates are school-local `YYYY-MM-DD`; times are branch-local `HH:MM`.
 */
import type {
  AttendanceStatus,
  AssignmentStatus,
  HomeworkStatus,
  StudentAttendanceSummary,
  TimetableEntry,
} from './operations.js';
import type { VisibleGrade } from './assessment.js';

/** Roles with a mobile experience. Selecting one changes the UI only. */
export type MobileRole = 'PARENT' | 'STUDENT' | 'TEACHER';

/** `GET /mobile/me` — which mobile experiences this user has (server-derived). */
export interface MobileMe {
  userId: string;
  displayName: string;
  schoolName: string;
  /** Mobile roles held AND backed by an active profile (e.g. PARENT needs a Parent profile). */
  roles: MobileRole[];
  /** Other roles (e.g. PRINCIPAL) that use the web School Admin instead. */
  otherRoles: string[];
  parent: { parentId: string; name: string } | null;
  student: { studentId: string; name: string; admissionNumber: string } | null;
  teacher: { teacherId: string; name: string; employeeId: string } | null;
}

/** The class a student is in on the school-local date (current enrollment). */
export interface MobileClassInfo {
  sectionId: string;
  className: string;
  branchName: string;
  /** IANA zone of the branch — all dates/times are interpreted there. */
  timezone: string;
  academicYearName: string;
  /** Branch-local today. */
  today: string;
}

export interface MobileChild {
  studentId: string;
  name: string;
  admissionNumber: string;
  relationship: string;
  class: MobileClassInfo | null;
}

export interface MobileLesson extends Pick<
  TimetableEntry,
  | 'periodName'
  | 'startTime'
  | 'endTime'
  | 'subjectName'
  | 'teacherName'
  | 'sectionName'
  | 'branchName'
> {
  id: string;
}

/** A student's view of their own submission (Parent sees the same, read-only). */
export interface MobileSubmission {
  id: string;
  textContent: string | null;
  externalUrl: string | null;
  version: number;
  firstSubmittedAt: string;
  lastSubmittedAt: string;
  /** Derived: the FIRST submission's branch-local date was after the due date. */
  late: boolean;
}

export type SubmissionBlockedReason =
  | 'ASSIGNMENT_CLOSED'
  | 'ASSIGNMENT_ARCHIVED'
  | 'NOT_IN_CLASS'
  | 'ACADEMIC_YEAR_CLOSED'
  | 'READ_ONLY';

export interface MobileWorkItem {
  id: string;
  kind: 'homework' | 'assignments';
  title: string;
  instructions: string | null;
  subjectName: string;
  className: string;
  /** IANA zone of the class's branch — submission times are shown in it, never the device's. */
  timezone: string;
  teacherName: string | null;
  assignedDate: string;
  dueDate: string;
  status: HomeworkStatus | AssignmentStatus;
  /** Branch-local today is after the due date. */
  overdue: boolean;
  /** Assignments only (null for homework or when nothing was submitted). */
  submission: MobileSubmission | null;
  /** Phase 9: assignment max marks (null = feedback-only / not numerically graded). */
  maxMarks: string | null;
  /** Phase 9: the PUBLISHED grade of the LATEST submission version only (never a draft). */
  grade: VisibleGrade | null;
  /** Phase 9: a submission exists but its latest version has no published grade yet. */
  awaitingGrading: boolean;
  /** Assignments only: whether this caller may submit now, and if not, why. */
  canSubmit: boolean;
  blockedReason: SubmissionBlockedReason | null;
}

export interface MobileAttendanceView {
  summary: StudentAttendanceSummary | null;
}

export interface MobileAttendanceDay {
  date: string;
  className: string;
  status: AttendanceStatus;
  note: string | null;
}

/** Home for a student (own) or a parent's selected child. Bounded lists only. */
export interface MobileStudentHome {
  studentId: string;
  name: string;
  admissionNumber: string;
  class: MobileClassInfo | null;
  todayLessons: MobileLesson[];
  attendance: Pick<
    StudentAttendanceSummary,
    'counts' | 'attendanceRate' | 'academicYearName'
  > | null;
  homework: MobileWorkItem[];
  assignmentsDue: MobileWorkItem[];
}

export type MobileWorkScope = 'current' | 'past';

export interface SubmitAssignmentRequest {
  text?: string | null;
  url?: string | null;
  /** 0 for a first submission, else the version being replaced (stale → 409). */
  expectedVersion: number;
}

/** Teacher view of one assignment's submissions (read-only; no grading in Phase 8). */
export interface AssignmentSubmissionRow {
  studentId: string;
  name: string;
  admissionNumber: string;
  submission: MobileSubmission | null;
}

export interface AssignmentSubmissionList {
  assignmentId: string;
  title: string;
  className: string;
  subjectName: string;
  dueDate: string;
  /** Branch time zone — submission times are shown in it. */
  timezone: string;
  status: AssignmentStatus;
  submittedCount: number;
  recipientCount: number;
  rows: AssignmentSubmissionRow[];
}
