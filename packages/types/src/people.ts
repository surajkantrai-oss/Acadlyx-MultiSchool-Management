/**
 * People, enrollment and bulk onboarding contracts (Phase 5).
 *
 * Profiles (Student, Parent, Teacher) are school-domain records — NOT the login identity (User).
 * A profile may exist without an account; `account` summarises the linked User (if any) and is
 * a separate lifecycle from the profile status. Dates are ISO `YYYY-MM-DD` (date-only).
 */
import type { AccountState, StudentQualityFilter, TeacherQualityFilter } from './workspace.js';

export type StudentStatus = 'ACTIVE' | 'INACTIVE' | 'WITHDRAWN' | 'GRADUATED';
export type TeacherStatus = 'ACTIVE' | 'INACTIVE';
export type GuardianRelationship =
  'FATHER' | 'MOTHER' | 'GUARDIAN' | 'GRANDPARENT' | 'SIBLING' | 'OTHER';
export type EnrollmentStatus = 'ACTIVE' | 'TRANSFERRED' | 'WITHDRAWN' | 'COMPLETED';
export type TeacherAssignmentType = 'SUBJECT_TEACHER' | 'CLASS_TEACHER';
export type ImportType = 'STUDENTS' | 'PARENTS' | 'TEACHERS';
export type ImportStatus = 'READY' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type ImportRowStatus = 'INVALID' | 'VALID' | 'SUCCEEDED' | 'FAILED';

/** Linked login account (Phase 3 User) — or none. */
export interface ProfileAccount {
  userId: string;
  status: 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
}

export interface PersonName {
  firstName: string;
  middleName: string | null;
  lastName: string | null;
}

/** Where a student sits (derived from the enrollment's section). */
export interface Placement {
  enrollmentId: string;
  sectionId: string;
  sectionName: string;
  gradeId: string;
  gradeName: string;
  branchId: string;
  branchName: string;
  academicYearId: string;
  academicYearName: string;
}

export interface StudentSummary extends PersonName {
  id: string;
  admissionNumber: string;
  preferredName: string | null;
  status: StudentStatus;
  account: ProfileAccount | null;
  /** ACTIVE enrollment in the current academic year, else the latest ACTIVE one. */
  currentPlacement: Placement | null;
}

export interface Enrollment extends Placement {
  status: EnrollmentStatus;
  startDate: string;
  endDate: string | null;
}

export interface GuardianLink {
  id: string;
  studentId: string;
  parentId: string;
  relationship: GuardianRelationship;
  isPrimary: boolean;
  pickupAuthorized: boolean;
  isEmergencyContact: boolean;
}

export interface StudentDetail extends StudentSummary {
  dateOfBirth: string | null;
  admissionDate: string | null;
  enrollments: Enrollment[];
  guardians: (GuardianLink & {
    parent: PersonName & { id: string; phone: string | null; email: string | null };
  })[];
  statusHistory: {
    fromStatus: StudentStatus | null;
    toStatus: StudentStatus;
    reason: string | null;
    at: string;
    /** Display name of the staff member who made the change (null for imports/seed). */
    actorName: string | null;
  }[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateStudentRequest {
  admissionNumber: string;
  firstName: string;
  middleName?: string | null;
  lastName?: string | null;
  preferredName?: string | null;
  dateOfBirth?: string | null;
  admissionDate?: string | null;
  /** Optional initial placement. */
  enrollment?: { sectionId: string; startDate?: string };
  /** Optional initial guardian links. */
  guardians?: LinkGuardianRequest[];
}
export type UpdateStudentRequest = Partial<Omit<CreateStudentRequest, 'enrollment' | 'guardians'>>;

export interface ChangeStudentStatusRequest {
  status: StudentStatus;
  reason?: string;
}

export interface LinkGuardianRequest {
  parentId: string;
  relationship: GuardianRelationship;
  isPrimary?: boolean;
  pickupAuthorized?: boolean;
  isEmergencyContact?: boolean;
}
export type UpdateGuardianRequest = Partial<Omit<LinkGuardianRequest, 'parentId'>>;

export interface CreateEnrollmentRequest {
  sectionId: string;
  startDate?: string;
}
/** Move within the same academic year: old → TRANSFERRED, new ACTIVE — atomically. */
export interface TransferEnrollmentRequest {
  sectionId: string;
  date?: string;
}
export interface EndEnrollmentRequest {
  status: 'WITHDRAWN' | 'COMPLETED';
  date?: string;
}

export interface ParentSummary extends PersonName {
  id: string;
  parentCode: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  account: ProfileAccount | null;
  childrenCount: number;
}

export interface ParentDetail extends ParentSummary {
  children: (GuardianLink & {
    student: PersonName & { id: string; admissionNumber: string; status: StudentStatus };
  })[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateParentRequest {
  parentCode?: string | null;
  firstName: string;
  middleName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}
export type UpdateParentRequest = Partial<CreateParentRequest>;

export interface TeacherAssignment {
  id: string;
  teacherId: string;
  type: TeacherAssignmentType;
  sectionId: string;
  sectionName: string;
  gradeName: string;
  branchName: string;
  academicYearName: string;
  subjectId: string | null;
  subjectName: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface TeacherSummary extends PersonName {
  id: string;
  employeeId: string;
  email: string | null;
  phone: string | null;
  status: TeacherStatus;
  account: ProfileAccount | null;
  activeAssignments: number;
}

export interface TeacherDetail extends TeacherSummary {
  joiningDate: string | null;
  assignments: TeacherAssignment[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateTeacherRequest {
  employeeId: string;
  firstName: string;
  middleName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  joiningDate?: string | null;
}
export type UpdateTeacherRequest = Partial<CreateTeacherRequest>;

export interface CreateAssignmentRequest {
  type: TeacherAssignmentType;
  sectionId: string;
  /** Required for SUBJECT_TEACHER; must be mapped to the section's grade. */
  subjectId?: string;
}

export type ProfileKind = 'students' | 'parents' | 'teachers';

export interface CreatedAccount {
  account: ProfileAccount;
  /** How the person activates: self-service OTP to their email/phone, or a one-time code. */
  activation: { method: 'OTP' } | { method: 'CODE'; code: string; expiresAt: string };
}

export interface PeopleQuery {
  q?: string;
  page?: number;
  pageSize?: number;
}
export interface StudentListQuery extends PeopleQuery {
  status?: StudentStatus;
  academicYearId?: string;
  branchId?: string;
  gradeId?: string;
  sectionId?: string;
  /** Phase 6: login-account state filter. */
  account?: AccountState;
  /** Phase 6: operational data-quality filter. */
  quality?: StudentQualityFilter;
}
export interface TeacherListQuery extends PeopleQuery {
  status?: TeacherStatus;
  account?: AccountState;
  quality?: TeacherQualityFilter;
}
export interface ParentListQuery extends PeopleQuery {
  account?: AccountState;
}

export interface ImportRowError {
  field: string;
  code: string;
  message: string;
}

export interface ImportJob {
  id: string;
  type: ImportType;
  status: ImportStatus;
  templateVersion: number;
  originalFilename: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  processedRows: number;
  succeededRows: number;
  failedRows: number;
  failureReason: string | null;
  createdBy: { userId: string; displayName: string | null };
  createdAt: string;
  confirmedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ImportRow {
  rowNumber: number;
  status: ImportRowStatus;
  data: Record<string, string | null> | null;
  errors: ImportRowError[];
  entityId: string | null;
}

export interface ImportTemplateColumn {
  name: string;
  required: boolean;
  description: string;
  example: string;
}

export interface ImportTemplate {
  type: ImportType;
  version: number;
  columns: ImportTemplateColumn[];
}

export interface PeopleCounts {
  students: number;
  activeStudents: number;
  parents: number;
  teachers: number;
  activeTeachers: number;
  guardianLinks: number;
  pendingImports: number;
}
