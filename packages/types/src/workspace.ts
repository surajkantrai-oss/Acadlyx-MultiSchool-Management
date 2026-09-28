/**
 * School Admin workspace view contracts (Phase 6): dashboard summary, section-based class
 * rosters, global search and the pending-access list. These are read models composed from the
 * Phase 4/5 domain — there is no separate "Class" entity (a class is a Section).
 */
import type {
  ImportJob,
  PersonName,
  ProfileAccount,
  ProfileKind,
  StudentStatus,
  TeacherAssignmentType,
  TeacherStatus,
} from './people.js';

/** Account lifecycle bucket for a profile ("NONE" = no linked login). */
export type AccountState = 'NONE' | ProfileAccount['status'];

/** Operational data-quality checks available as list filters (not errors). */
export type StudentQualityFilter = 'NO_ENROLLMENT' | 'NO_GUARDIAN';
export type TeacherQualityFilter = 'NO_ASSIGNMENT';

export interface WorkspaceContextQuery {
  academicYearId?: string;
  branchId?: string;
}

/**
 * Dashboard summary. Each block is present only if the caller holds its permissions; values are
 * real counts. Enrollment/class numbers respect the (validated) academic-year/branch context.
 */
export interface DashboardSummary {
  context: {
    academicYear: { id: string; name: string; isCurrent: boolean } | null;
    branch: { id: string; name: string } | null;
  };
  students?: {
    byStatus: Record<StudentStatus, number>;
    /** Students with an ACTIVE enrollment in the context year/branch. */
    enrolled: number;
  };
  teachers?: { byStatus: Record<TeacherStatus, number> };
  parents?: { total: number; guardianLinks: number };
  classes?: { sections: number; activeSections: number };
  accounts?: Record<ProfileKind, Record<AccountState, number>>;
  dataQuality?: {
    /** ACTIVE students without an ACTIVE enrollment in the context year. */
    activeStudentsWithoutEnrollment: number;
    activeStudentsWithoutGuardian: number;
    activeTeachersWithoutAssignment: number;
  };
  imports?: { recent: ImportJob[]; pending: number };
  /** Present only with `school_activity.read`: humanised recent events (newest first, ≤ 10). */
  activity?: ActivityItem[];
}

/**
 * One school-facing activity line derived from the existing AuditLog. Contains no raw audit
 * payload, IP address, user agent, secrets or before/after values — only a fixed message, the
 * affected person's display name (when it belongs to this school) and the staff actor's name.
 */
export interface ActivityItem {
  /** Opaque list key (never shown). */
  key: string;
  at: string;
  message: string;
  subject: string | null;
  actorName: string | null;
  /** In-app link to the affected record, when it still exists in this school. */
  href: string | null;
}

export interface ClassSummary {
  sectionId: string;
  sectionName: string;
  sectionCode: string;
  isActive: boolean;
  capacity: number | null;
  gradeId: string;
  gradeName: string;
  branchId: string;
  branchName: string;
  academicYearId: string;
  academicYearName: string;
  studentCount: number;
  teacherAssignmentCount: number;
}

export interface ClassListQuery extends WorkspaceContextQuery {
  gradeId?: string;
}

export interface RosterStudent extends PersonName {
  id: string;
  admissionNumber: string;
  preferredName: string | null;
  status: StudentStatus;
  enrollmentId: string;
  startDate: string;
  account: ProfileAccount | null;
  guardianCount: number;
  primaryGuardian: (PersonName & { relationship: string }) | null;
}

export interface ClassDetail extends ClassSummary {
  roster: RosterStudent[];
  /** Present only with teacher_assignment.read. */
  teachers?: {
    assignmentId: string;
    type: TeacherAssignmentType;
    teacherId: string;
    teacherName: string;
    employeeId: string;
    teacherStatus: TeacherStatus;
    subjectId: string | null;
    subjectName: string | null;
  }[];
  /** Present only with subject.read — the grade's configured subjects. */
  subjects?: { id: string; code: string; name: string; isRequired: boolean }[];
}

/** Minimal identifying information only — no phone, email or date of birth. */
export interface SearchResults {
  query: string;
  students?: { id: string; label: string; admissionNumber: string; status: StudentStatus }[];
  parents?: { id: string; label: string; parentCode: string | null }[];
  teachers?: { id: string; label: string; employeeId: string; status: TeacherStatus }[];
  classes?: { id: string; label: string }[];
}

export interface AccessRow extends PersonName {
  kind: ProfileKind;
  id: string;
  /** Admission number, parent code or employee ID. */
  code: string | null;
  account: ProfileAccount | null;
  hasEmail: boolean;
  hasPhone: boolean;
}
export interface AccessQuery {
  kind: ProfileKind;
  state?: Exclude<AccountState, 'ACTIVE'>;
  q?: string;
  page?: number;
  pageSize?: number;
}
