/**
 * Academic operations contracts (Phase 7): daily attendance, homework, assignments and the weekly
 * timetable. Dates are school-local calendar dates `YYYY-MM-DD` (branch timezone); times are
 * local wall-clock `HH:MM`. Classes are Sections.
 */
import type { Weekday } from './academic.js';
import type { PersonName, StudentStatus } from './people.js';

// ---- Attendance ------------------------------------------------------------------------------

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';

/** Section context shared by attendance/classwork/timetable responses. */
export interface OpsSection {
  sectionId: string;
  sectionName: string;
  branchId: string;
  branchName: string;
  academicYearId: string;
  academicYearName: string;
  academicYearStatus: 'PLANNED' | 'ACTIVE' | 'CLOSED';
  timezone: string;
}

export interface AttendanceCounts {
  PRESENT: number;
  ABSENT: number;
  LATE: number;
  EXCUSED: number;
  /** Eligible students with no record yet. */
  UNMARKED: number;
}

/** One class (section) on one school-local date, with its eligible roster. */
export interface AttendanceSheet extends OpsSection {
  date: string;
  /** The branch-local "today" used for date rules. */
  today: string;
  /** Present once the sheet has been saved. */
  session: {
    id: string;
    version: number;
    updatedAt: string;
    updatedByName: string | null;
  } | null;
  /** Whether the caller may save this sheet (date window, year status, scope). */
  editable: boolean;
  /** Why not, when not editable. */
  lockedReason:
    | 'FUTURE_DATE'
    | 'OUTSIDE_TEACHER_WINDOW'
    | 'YEAR_NOT_ACTIVE'
    | 'OUTSIDE_YEAR'
    | 'READ_ONLY'
    | null;
  roster: (PersonName & {
    studentId: string;
    admissionNumber: string;
    studentStatus: StudentStatus;
    status: AttendanceStatus | null;
    note: string | null;
  })[];
  counts: AttendanceCounts;
}

export interface SaveAttendanceRequest {
  sectionId: string;
  date: string;
  /** Required when the sheet already exists (optimistic concurrency). */
  expectedVersion?: number;
  records: { studentId: string; status: AttendanceStatus; note?: string | null }[];
}

export interface AttendanceHistoryDay {
  date: string;
  sessionId: string;
  counts: AttendanceCounts;
  updatedAt: string;
}

export interface AttendanceClass extends OpsSection {
  gradeName: string;
  today: string;
  /** Today's status for the class: saved or not yet. */
  markedToday: boolean;
  studentCount: number;
}

export interface StudentAttendanceSummary {
  academicYearId: string;
  academicYearName: string;
  counts: Omit<AttendanceCounts, 'UNMARKED'>;
  /** (PRESENT + LATE) / (PRESENT + LATE + ABSENT); EXCUSED excluded. Null when nothing counted. */
  attendanceRate: number | null;
  recent: { date: string; sectionName: string; status: AttendanceStatus; note: string | null }[];
}

export interface AttendanceRecordChange {
  at: string;
  studentName: string;
  admissionNumber: string;
  fromStatus: AttendanceStatus | null;
  toStatus: AttendanceStatus;
  fromNote: string | null;
  toNote: string | null;
  changedByName: string | null;
}

// ---- Homework & assignments ------------------------------------------------------------------

export type HomeworkStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type AssignmentStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'ARCHIVED';
export type ClassworkKind = 'homework' | 'assignments';

export interface ClassworkItem<
  S extends string = HomeworkStatus | AssignmentStatus,
> extends OpsSection {
  id: string;
  kind: ClassworkKind;
  gradeName: string;
  subjectId: string;
  subjectName: string;
  teacher: { id: string; name: string } | null;
  title: string;
  instructions: string | null;
  assignedDate: string;
  dueDate: string;
  status: S;
  version: number;
  createdByName: string | null;
  publishedAt: string | null;
  closedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** What the caller may do next (server-computed; the server re-checks on every action). */
  can: { edit: boolean; publish: boolean; close: boolean; archive: boolean; delete: boolean };
}
export type Homework = ClassworkItem<HomeworkStatus>;
export type Assignment = ClassworkItem<AssignmentStatus>;

export interface ClassworkQuery {
  q?: string;
  status?: string;
  sectionId?: string;
  subjectId?: string;
  teacherId?: string;
  academicYearId?: string;
  dueFrom?: string;
  dueTo?: string;
  page?: number;
  pageSize?: number;
}

export interface SaveClassworkRequest {
  sectionId: string;
  subjectId: string;
  title: string;
  instructions?: string | null;
  assignedDate: string;
  dueDate: string;
  /** Leadership may name the responsible teacher; teachers are always themselves. */
  teacherId?: string | null;
}
export type UpdateClassworkRequest = Partial<
  Omit<SaveClassworkRequest, 'sectionId' | 'subjectId'>
> & {
  expectedVersion: number;
};

/** Section + subject pairs the caller may create class work for. */
export interface ClassworkTarget extends OpsSection {
  gradeName: string;
  subjects: { id: string; name: string }[];
}

// ---- Timetable -------------------------------------------------------------------------------

export type TimetablePeriodType = 'INSTRUCTIONAL' | 'BREAK' | 'LUNCH' | 'ASSEMBLY';

export interface TimetablePeriod {
  id: string;
  branchId: string;
  academicYearId: string;
  name: string;
  type: TimetablePeriodType;
  startTime: string;
  endTime: string;
  displayOrder: number;
  entryCount: number;
}

export interface SaveTimetablePeriodRequest {
  branchId: string;
  academicYearId: string;
  name: string;
  type: TimetablePeriodType;
  startTime: string;
  endTime: string;
}
export type UpdateTimetablePeriodRequest = Partial<
  Omit<SaveTimetablePeriodRequest, 'branchId' | 'academicYearId'>
>;

export interface TimetableEntry {
  id: string;
  sectionId: string;
  sectionName: string;
  branchName: string;
  weekday: Weekday;
  periodId: string;
  periodName: string;
  startTime: string;
  endTime: string;
  subjectId: string;
  subjectName: string;
  teacherId: string;
  teacherName: string;
}

export interface SaveTimetableEntryRequest {
  sectionId: string;
  periodId: string;
  weekday: Weekday;
  subjectId: string;
  teacherId: string;
}
export type UpdateTimetableEntryRequest = Partial<Omit<SaveTimetableEntryRequest, 'sectionId'>>;

/** Weekly grid: the working days × the branch's periods, with entries. */
export interface TimetableWeek {
  view: 'section' | 'teacher';
  title: string;
  academicYearId: string;
  academicYearName: string;
  workingDays: Weekday[];
  periods: Omit<TimetablePeriod, 'entryCount'>[];
  entries: TimetableEntry[];
  editable: boolean;
}
