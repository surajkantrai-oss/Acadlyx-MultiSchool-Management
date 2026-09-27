/**
 * School & academic configuration API contracts (Phase 4).
 *
 * Tenant = SaaS customer boundary (domains, features, white-label branding).
 * School = academic institution owned by a tenant (V1: exactly one per tenant).
 * Dates are ISO `YYYY-MM-DD` strings (date-only, no time zone); timestamps are ISO-8601 UTC.
 * Runtime value lists live in @acadlyx/validation (WEEKDAYS, SCHOOL_BOARDS, …).
 */

export type Weekday =
  'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

export type SchoolBoard = 'CBSE' | 'ICSE' | 'STATE_BOARD' | 'IB' | 'CAMBRIDGE' | 'OTHER';

/** PLANNED → ACTIVE → CLOSED (one-way). Only an ACTIVE year can be current. */
export type AcademicYearStatus = 'PLANNED' | 'ACTIVE' | 'CLOSED';

export interface PostalAddress {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  /** ISO 3166-1 alpha-2, e.g. IN. */
  country: string | null;
}

export interface School extends PostalAddress {
  id: string;
  name: string;
  shortName: string | null;
  /** Stable internal code (upper-case), unique within the tenant. */
  code: string | null;
  board: SchoolBoard | null;
  /** Custom board name, only when board = OTHER. */
  boardName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  createdAt: string;
  updatedAt: string;
}

export type UpdateSchoolRequest = Partial<
  Omit<School, 'id' | 'createdAt' | 'updatedAt'> & { name: string }
>;

/** School-level academic behaviour (not white-label branding, not tenant-wide settings). */
export interface AcademicSettings {
  /** Default IANA time zone for new branches. */
  timezone: string;
  weekStartDay: Weekday;
  workingDays: Weekday[];
  /** Month (1–12) new academic years usually start in — a default for forms only. */
  academicYearStartMonth: number;
}

export interface Branch extends PostalAddress {
  id: string;
  schoolId: string;
  name: string;
  code: string;
  email: string | null;
  phone: string | null;
  /** IANA time zone, e.g. Asia/Kolkata. */
  timezone: string;
  isPrimary: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CreateBranchRequest = Partial<PostalAddress> & {
  name: string;
  code: string;
  email?: string | null;
  phone?: string | null;
  /** Defaults to the school's academic-settings time zone. */
  timezone?: string;
};
export type UpdateBranchRequest = Partial<Omit<CreateBranchRequest, 'code'>> & { code?: string };

export interface AcademicYear {
  id: string;
  schoolId: string;
  name: string;
  startDate: string;
  endDate: string;
  status: AcademicYearStatus;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAcademicYearRequest {
  name: string;
  startDate: string;
  endDate: string;
}
/** Dates may change only while the year is PLANNED. */
export type UpdateAcademicYearRequest = Partial<CreateAcademicYearRequest>;

export interface Grade {
  id: string;
  schoolId: string;
  name: string;
  code: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGradeRequest {
  name: string;
  code: string;
}
export type UpdateGradeRequest = Partial<CreateGradeRequest>;

/** A section of a grade at one branch for one academic year (e.g. Grade 5-A, Main Campus, 2026–27). */
export interface Section {
  id: string;
  schoolId: string;
  branchId: string;
  academicYearId: string;
  gradeId: string;
  name: string;
  code: string;
  displayOrder: number;
  capacity: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSectionRequest {
  branchId: string;
  academicYearId: string;
  gradeId: string;
  name: string;
  code: string;
  capacity?: number | null;
}
export interface UpdateSectionRequest {
  name?: string;
  code?: string;
  capacity?: number | null;
}

export interface SectionListQuery {
  branchId?: string;
  academicYearId?: string;
  gradeId?: string;
}

export interface Subject {
  id: string;
  schoolId: string;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSubjectRequest {
  name: string;
  code: string;
}
export type UpdateSubjectRequest = Partial<CreateSubjectRequest>;

export interface GradeSubject {
  gradeId: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  subjectIsActive: boolean;
  isRequired: boolean;
  displayOrder: number;
}

export interface AssignGradeSubjectRequest {
  isRequired?: boolean;
}

/** Ordered ids for a reorder operation (the complete list for the scope). */
export interface ReorderRequest {
  ids: string[];
}

export interface SchoolSetupStatus {
  counts: {
    branches: number;
    activeBranches: number;
    academicYears: number;
    grades: number;
    sections: number;
    subjects: number;
    gradeSubjects: number;
  };
  currentAcademicYear: { id: string; name: string } | null;
  checklist: {
    schoolProfile: boolean;
    primaryBranch: boolean;
    currentAcademicYear: boolean;
    grades: boolean;
    sections: boolean;
    subjects: boolean;
  };
}
