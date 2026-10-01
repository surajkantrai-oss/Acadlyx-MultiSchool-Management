/**
 * Typed HTTP client foundation shared by Platform Admin, School Admin and Mobile.
 * Business endpoints are added by the phase that introduces them.
 */
import { HEALTH_PATH } from '@acadlyx/constants';
import type {
  ConfigurationKey,
  FeatureKey,
  Paginated,
  TenantBootstrap,
  TenantBranding,
  TenantConfigurationEntry,
  TenantDetail,
  TenantDomain,
  TenantDomainType,
  TenantFeatureState,
  TenantLifecycleAction,
  TenantListQuery,
  TenantStats,
  TenantSummary,
} from '@acadlyx/tenant-config';
import { TENANT_KEY_HEADER } from '@acadlyx/tenant-config';
import type {
  ChangeStudentStatusRequest,
  CreateAssignmentRequest,
  CreatedAccount,
  CreateEnrollmentRequest,
  CreateParentRequest,
  CreateStudentRequest,
  CreateTeacherRequest,
  EndEnrollmentRequest,
  Enrollment,
  ImportJob,
  ImportRow,
  ImportRowStatus,
  ImportTemplate,
  ImportType,
  LinkGuardianRequest,
  ParentDetail,
  ParentSummary,
  PeopleCounts,
  ParentListQuery,
  AttendanceClass,
  AttendanceHistoryDay,
  AttendanceRecordChange,
  AttendanceSheet,
  ClassworkItem,
  ClassworkKind,
  ClassworkQuery,
  ClassworkTarget,
  SaveAttendanceRequest,
  SaveClassworkRequest,
  SaveTimetableEntryRequest,
  SaveTimetablePeriodRequest,
  StudentAttendanceSummary,
  TimetableEntry,
  TimetablePeriod,
  TimetableWeek,
  UpdateClassworkRequest,
  UpdateTimetableEntryRequest,
  UpdateTimetablePeriodRequest,
  AccessQuery,
  AccessRow,
  ClassDetail,
  ClassListQuery,
  ClassSummary,
  DashboardSummary,
  SearchResults,
  WorkspaceContextQuery,
  ProfileAccount,
  ProfileKind,
  StudentDetail,
  StudentListQuery,
  StudentSummary,
  TeacherAssignment,
  TeacherDetail,
  TeacherListQuery,
  TeacherSummary,
  TeacherStatus,
  TransferEnrollmentRequest,
  UpdateGuardianRequest,
  UpdateParentRequest,
  UpdateStudentRequest,
  UpdateTeacherRequest,
} from '@acadlyx/types';
import type {
  AssignmentGrading,
  ClassResults,
  CreateExamRequest,
  ExamDetail,
  ExamSummary,
  ExamTransition,
  GradeBandInput,
  GradeScale,
  MarkSheet,
  MarkSheetSummary,
  PublishedResultSummary,
  ReportCard,
  ResultPublicationSummary,
  SaveGradeRequest,
  SaveMarksRequest,
  UpdateExamRequest,
  AssignmentSubmissionList,
  MobileAttendanceDay,
  MobileChild,
  MobileMe,
  MobileStudentHome,
  MobileWorkItem,
  MobileWorkScope,
  SubmitAssignmentRequest,
  AcademicSettings,
  AcademicYear,
  ApiErrorResponse,
  AssignGradeSubjectRequest,
  AuthResult,
  Branch,
  CreateAcademicYearRequest,
  CreateBranchRequest,
  CreateGradeRequest,
  CreateSectionRequest,
  CreateSubjectRequest,
  Grade,
  GradeSubject,
  School,
  SchoolSetupStatus,
  Section,
  SectionListQuery,
  Subject,
  UpdateAcademicYearRequest,
  UpdateBranchRequest,
  UpdateGradeRequest,
  UpdateSchoolRequest,
  UpdateSectionRequest,
  UpdateSubjectRequest,
  AuthTokens,
  DeviceDescriptor,
  DeviceInfo,
  HealthResponse,
  IssuedActivationCode,
  MeResponse,
  MfaEnrollmentComplete,
  MfaEnrollmentStart,
  OtpGrant,
  SessionInfo,
  TenantUserSummary,
} from '@acadlyx/types';

export * from './web-auth.js';
import { joinUrl } from '@acadlyx/utils';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiClientOptions {
  /** Absolute API base URL including the version prefix, e.g. `http://localhost:4000/api/v1`. */
  baseUrl: string;
  /** Extension point for auth/tenant headers added in later phases. */
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  fetch?: typeof fetch;
}

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorResponse | null,
  ) {
    const message = body?.message ?? `Request failed with status ${status}`;
    super(Array.isArray(message) ? message.join('; ') : message);
    this.name = 'ApiError';
  }

  /** Machine-readable domain error code (e.g. TENANT_NOT_FOUND), when provided. */
  get code(): string | undefined {
    return this.body?.code;
  }

  /** All messages as a list (validation errors arrive as an array). */
  get messages(): string[] {
    const message = this.body?.message;
    if (message === undefined) return [this.message];
    return Array.isArray(message) ? message : [message];
  }
}

export interface CreateTenantRequest {
  displayName: string;
  legalName?: string;
  key: string;
  slug: string;
  initialStatus?: 'DRAFT' | 'ACTIVE';
}

export interface UpdateTenantRequest {
  displayName?: string;
  legalName?: string | null;
  slug?: string;
}

export interface AddDomainRequest {
  domain: string;
  type: TenantDomainType;
  isPrimary?: boolean;
}

export interface UpdateDomainRequest {
  isPrimary?: boolean;
  verified?: boolean;
}

export type UpdateBrandingRequest = Omit<Partial<TenantBranding>, 'schoolName' | 'primaryColor'> &
  Pick<TenantBranding, 'schoolName' | 'primaryColor'>;

/** How a tenant-scoped request identifies its tenant (see docs/architecture/MULTI_TENANCY.md). */
export interface TenantRequestContext {
  /** Host to present to the API (server-side callers forwarding the browser's host). */
  host?: string;
  /** Public tenant key for branded mobile builds. Not a secret. */
  tenantKey?: string;
}

export interface CreateTenantUserRequest {
  displayName: string;
  email?: string;
  phone?: string;
  loginId?: string;
  loginIdKind?: 'STUDENT_ID' | 'EMPLOYEE_ID';
  roles: string[];
}

export interface TenantUserListQuery {
  search?: string;
  status?: string;
  role?: string;
  page?: number;
  pageSize?: number;
}

type MfaFactor = { code: string } | { recoveryCode: string };

const enc = encodeURIComponent;

/** Own (student) routes vs a parent's child routes. */
const mobileBase = (studentId: string | null) =>
  studentId === null ? 'mobile/student' : `mobile/parent/children/${enc(studentId)}`;

/** `?a=1&b=x` from defined scalar values (empty string when none). */
function qs(query: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

function toQuery(query: TenantListQuery | TenantUserListQuery): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(name, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return typeof value === 'object' && value !== null && 'statusCode' in value && 'message' in value;
}

export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function request<T>(
    method: HttpMethod,
    path: string,
    init: RequestOptions = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(await options.getHeaders?.()),
      ...init.headers,
    };
    const hasBody = init.body !== undefined;
    if (hasBody) headers['Content-Type'] = 'application/json';

    const response = await fetchImpl(joinUrl(options.baseUrl, path), {
      method,
      headers,
      body: hasBody ? JSON.stringify(init.body) : null,
      signal: init.signal ?? null,
    });

    const text = await response.text();
    const data: unknown = text.length > 0 ? JSON.parse(text) : null;

    if (!response.ok) {
      throw new ApiError(response.status, isApiErrorResponse(data) ? data : null);
    }
    return data as T;
  }

  const t = (id: string) => `platform/tenants/${encodeURIComponent(id)}`;

  return {
    request,
    health: (signal?: AbortSignal) =>
      request<HealthResponse>('GET', HEALTH_PATH, signal ? { signal } : {}),

    /** Platform-scoped tenant management (no tenant context). */
    platform: {
      listTenants: (query: TenantListQuery = {}) =>
        request<Paginated<TenantSummary>>('GET', `platform/tenants${toQuery(query)}`),
      tenantStats: () => request<TenantStats>('GET', 'platform/tenants/stats'),
      createTenant: (body: CreateTenantRequest) =>
        request<TenantDetail>('POST', 'platform/tenants', { body }),
      getTenant: (id: string) => request<TenantDetail>('GET', t(id)),
      updateTenant: (id: string, body: UpdateTenantRequest) =>
        request<TenantDetail>('PATCH', t(id), { body }),
      transitionTenant: (id: string, action: TenantLifecycleAction) =>
        request<TenantDetail>('POST', `${t(id)}/${action}`),

      listDomains: (id: string) => request<TenantDomain[]>('GET', `${t(id)}/domains`),
      addDomain: (id: string, body: AddDomainRequest) =>
        request<TenantDomain>('POST', `${t(id)}/domains`, { body }),
      updateDomain: (id: string, domainId: string, body: UpdateDomainRequest) =>
        request<TenantDomain>('PATCH', `${t(id)}/domains/${encodeURIComponent(domainId)}`, {
          body,
        }),
      removeDomain: (id: string, domainId: string) =>
        request<null>('DELETE', `${t(id)}/domains/${encodeURIComponent(domainId)}`),

      getBranding: (id: string) => request<TenantBranding | null>('GET', `${t(id)}/branding`),
      updateBranding: (id: string, body: UpdateBrandingRequest) =>
        request<TenantBranding>('PUT', `${t(id)}/branding`, { body }),

      listFeatures: (id: string) => request<TenantFeatureState[]>('GET', `${t(id)}/features`),
      setFeature: (id: string, key: FeatureKey, enabled: boolean) =>
        request<TenantFeatureState>('PUT', `${t(id)}/features/${key}`, { body: { enabled } }),

      listConfiguration: (id: string) =>
        request<TenantConfigurationEntry[]>('GET', `${t(id)}/configuration`),
      setConfiguration: (id: string, key: ConfigurationKey, value: unknown) =>
        request<TenantConfigurationEntry>('PUT', `${t(id)}/configuration/${key}`, {
          body: { value },
        }),
      resetConfiguration: (id: string, key: ConfigurationKey) =>
        request<TenantConfigurationEntry>('DELETE', `${t(id)}/configuration/${key}`),

      listUsers: (id: string, query: TenantUserListQuery = {}) =>
        request<Paginated<TenantUserSummary>>('GET', `${t(id)}/users${toQuery(query)}`),
      createUser: (id: string, body: CreateTenantUserRequest) =>
        request<TenantUserSummary>('POST', `${t(id)}/users`, { body }),
      getUser: (id: string, userId: string) =>
        request<TenantUserSummary>('GET', `${t(id)}/users/${encodeURIComponent(userId)}`),
      renameUser: (id: string, userId: string, displayName: string) =>
        request<TenantUserSummary>('PATCH', `${t(id)}/users/${encodeURIComponent(userId)}`, {
          body: { displayName },
        }),
      assignRole: (id: string, userId: string, roleKey: string) =>
        request<TenantUserSummary>('POST', `${t(id)}/users/${encodeURIComponent(userId)}/roles`, {
          body: { roleKey },
        }),
      removeRole: (id: string, userId: string, roleKey: string) =>
        request<TenantUserSummary>(
          'DELETE',
          `${t(id)}/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleKey)}`,
        ),
      userAction: (
        id: string,
        userId: string,
        action: 'suspend' | 'reactivate' | 'disable' | 'reset-activation',
      ) =>
        request<TenantUserSummary>(
          'POST',
          `${t(id)}/users/${encodeURIComponent(userId)}/${action}`,
        ),
      issueActivationCode: (id: string, userId: string) =>
        request<IssuedActivationCode>(
          'POST',
          `${t(id)}/users/${encodeURIComponent(userId)}/activation-code`,
        ),
    },

    /** Authentication endpoints. `base` = 'platform/auth' or 'auth' (tenant, Host-resolved). */
    /**
     * School & academic configuration (Phase 4, tenant-scoped). The school is resolved by the API
     * from the request's tenant (Host / tenant key) and session — never passed by the client.
     */
    academic: {
      school: () => request<School>('GET', 'school'),
      updateSchool: (body: UpdateSchoolRequest) => request<School>('PATCH', 'school', { body }),
      setupStatus: () => request<SchoolSetupStatus>('GET', 'school/setup-status'),
      settings: () => request<AcademicSettings>('GET', 'school/academic-settings'),
      updateSettings: (body: Partial<AcademicSettings>) =>
        request<AcademicSettings>('PATCH', 'school/academic-settings', { body }),

      branches: (query: { q?: string; active?: boolean } = {}) =>
        request<Branch[]>('GET', `branches${qs(query)}`),
      createBranch: (body: CreateBranchRequest) => request<Branch>('POST', 'branches', { body }),
      updateBranch: (id: string, body: UpdateBranchRequest) =>
        request<Branch>('PATCH', `branches/${enc(id)}`, { body }),
      branchAction: (id: string, action: 'activate' | 'deactivate' | 'set-primary') =>
        request<Branch>('POST', `branches/${enc(id)}/${action}`),

      academicYears: () => request<AcademicYear[]>('GET', 'academic-years'),
      createAcademicYear: (body: CreateAcademicYearRequest) =>
        request<AcademicYear>('POST', 'academic-years', { body }),
      updateAcademicYear: (id: string, body: UpdateAcademicYearRequest) =>
        request<AcademicYear>('PATCH', `academic-years/${enc(id)}`, { body }),
      academicYearAction: (id: string, action: 'activate' | 'close' | 'set-current') =>
        request<AcademicYear>('POST', `academic-years/${enc(id)}/${action}`),

      grades: () => request<Grade[]>('GET', 'grades'),
      createGrade: (body: CreateGradeRequest) => request<Grade>('POST', 'grades', { body }),
      updateGrade: (id: string, body: UpdateGradeRequest) =>
        request<Grade>('PATCH', `grades/${enc(id)}`, { body }),
      gradeAction: (id: string, action: 'activate' | 'deactivate') =>
        request<Grade>('POST', `grades/${enc(id)}/${action}`),
      reorderGrades: (ids: string[]) => request<Grade[]>('PUT', 'grades/order', { body: { ids } }),
      gradeSubjects: (gradeId: string) =>
        request<GradeSubject[]>('GET', `grades/${enc(gradeId)}/subjects`),
      assignGradeSubject: (
        gradeId: string,
        subjectId: string,
        body: AssignGradeSubjectRequest = {},
      ) =>
        request<GradeSubject[]>('PUT', `grades/${enc(gradeId)}/subjects/${enc(subjectId)}`, {
          body,
        }),
      removeGradeSubject: (gradeId: string, subjectId: string) =>
        request<GradeSubject[]>('DELETE', `grades/${enc(gradeId)}/subjects/${enc(subjectId)}`),

      sections: (query: SectionListQuery = {}) =>
        request<Section[]>('GET', `sections${qs({ ...query })}`),
      createSection: (body: CreateSectionRequest) => request<Section>('POST', 'sections', { body }),
      updateSection: (id: string, body: UpdateSectionRequest) =>
        request<Section>('PATCH', `sections/${enc(id)}`, { body }),
      sectionAction: (id: string, action: 'activate' | 'deactivate') =>
        request<Section>('POST', `sections/${enc(id)}/${action}`),
      reorderSections: (body: Required<SectionListQuery> & { ids: string[] }) =>
        request<Section[]>('PUT', 'sections/order', { body }),

      subjects: (query: { q?: string; active?: boolean } = {}) =>
        request<Subject[]>('GET', `subjects${qs(query)}`),
      createSubject: (body: CreateSubjectRequest) => request<Subject>('POST', 'subjects', { body }),
      updateSubject: (id: string, body: UpdateSubjectRequest) =>
        request<Subject>('PATCH', `subjects/${enc(id)}`, { body }),
      subjectAction: (id: string, action: 'activate' | 'deactivate') =>
        request<Subject>('POST', `subjects/${enc(id)}/${action}`),
    },

    /**
     * People, enrollment and bulk onboarding (Phase 5, tenant-scoped). Lists are paginated
     * server-side. File upload/download goes through the School Admin BFF (multipart/binary).
     */
    people: {
      summary: () => request<PeopleCounts>('GET', 'people/summary'),

      students: (query: StudentListQuery = {}) =>
        request<Paginated<StudentSummary>>('GET', `students${qs({ ...query })}`),
      student: (id: string) => request<StudentDetail>('GET', `students/${enc(id)}`),
      createStudent: (body: CreateStudentRequest) =>
        request<StudentDetail>('POST', 'students', { body }),
      updateStudent: (id: string, body: UpdateStudentRequest) =>
        request<StudentDetail>('PATCH', `students/${enc(id)}`, { body }),
      changeStudentStatus: (id: string, body: ChangeStudentStatusRequest) =>
        request<StudentDetail>('POST', `students/${enc(id)}/status`, { body }),
      linkGuardian: (id: string, body: LinkGuardianRequest) =>
        request<StudentDetail>('POST', `students/${enc(id)}/guardians`, { body }),
      updateGuardian: (id: string, linkId: string, body: UpdateGuardianRequest) =>
        request<StudentDetail>('PATCH', `students/${enc(id)}/guardians/${enc(linkId)}`, { body }),
      unlinkGuardian: (id: string, linkId: string) =>
        request<StudentDetail>('DELETE', `students/${enc(id)}/guardians/${enc(linkId)}`),
      enrollments: (id: string) => request<Enrollment[]>('GET', `students/${enc(id)}/enrollments`),
      enroll: (id: string, body: CreateEnrollmentRequest) =>
        request<StudentDetail>('POST', `students/${enc(id)}/enrollments`, { body }),
      transferEnrollment: (id: string, enrollmentId: string, body: TransferEnrollmentRequest) =>
        request<StudentDetail>(
          'POST',
          `students/${enc(id)}/enrollments/${enc(enrollmentId)}/transfer`,
          { body },
        ),
      endEnrollment: (id: string, enrollmentId: string, body: EndEnrollmentRequest) =>
        request<StudentDetail>('POST', `students/${enc(id)}/enrollments/${enc(enrollmentId)}/end`, {
          body,
        }),

      parents: (query: ParentListQuery = {}) =>
        request<Paginated<ParentSummary>>('GET', `parents${qs({ ...query })}`),
      parent: (id: string) => request<ParentDetail>('GET', `parents/${enc(id)}`),
      createParent: (body: CreateParentRequest) =>
        request<ParentDetail>('POST', 'parents', { body }),
      updateParent: (id: string, body: UpdateParentRequest) =>
        request<ParentDetail>('PATCH', `parents/${enc(id)}`, { body }),
      setParentActive: (id: string, active: boolean) =>
        request<ParentDetail>('POST', `parents/${enc(id)}/${active ? 'activate' : 'deactivate'}`),

      teachers: (query: TeacherListQuery = {}) =>
        request<Paginated<TeacherSummary>>('GET', `teachers${qs({ ...query })}`),
      teacher: (id: string) => request<TeacherDetail>('GET', `teachers/${enc(id)}`),
      createTeacher: (body: CreateTeacherRequest) =>
        request<TeacherDetail>('POST', 'teachers', { body }),
      updateTeacher: (id: string, body: UpdateTeacherRequest) =>
        request<TeacherDetail>('PATCH', `teachers/${enc(id)}`, { body }),
      setTeacherStatus: (id: string, status: TeacherStatus) =>
        request<TeacherDetail>('POST', `teachers/${enc(id)}/status`, { body: { status } }),
      assignments: (id: string, includeEnded = false) =>
        request<TeacherAssignment[]>(
          'GET',
          `teachers/${enc(id)}/assignments${qs({ includeEnded: includeEnded || undefined })}`,
        ),
      assign: (id: string, body: CreateAssignmentRequest) =>
        request<TeacherDetail>('POST', `teachers/${enc(id)}/assignments`, { body }),
      endAssignment: (id: string, assignmentId: string) =>
        request<TeacherDetail>('POST', `teachers/${enc(id)}/assignments/${enc(assignmentId)}/end`),

      createAccount: (kind: ProfileKind, id: string) =>
        request<CreatedAccount>('POST', `${kind}/${enc(id)}/account`),
      linkAccount: (kind: ProfileKind, id: string, userId: string) =>
        request<ProfileAccount>('POST', `${kind}/${enc(id)}/account/link`, { body: { userId } }),
      issueActivationCode: (kind: ProfileKind, id: string) =>
        request<CreatedAccount>('POST', `${kind}/${enc(id)}/account/activation-code`),

      imports: (query: { page?: number; pageSize?: number } = {}) =>
        request<Paginated<ImportJob>>('GET', `imports${qs(query)}`),
      importJob: (id: string) => request<ImportJob>('GET', `imports/${enc(id)}`),
      importRows: (
        id: string,
        query: { status?: ImportRowStatus; page?: number; pageSize?: number } = {},
      ) => request<Paginated<ImportRow>>('GET', `imports/${enc(id)}/rows${qs(query)}`),
      importTemplate: (type: ImportType) =>
        request<ImportTemplate>('GET', `imports/templates/${type}`),
      confirmImport: (id: string) => request<ImportJob>('POST', `imports/${enc(id)}/confirm`),
      cancelImport: (id: string) => request<ImportJob>('POST', `imports/${enc(id)}/cancel`),
    },

    /** Phase 7 academic operations (tenant-scoped; teachers limited to assigned classes/subjects). */
    ops: {
      attendanceClasses: (query: { academicYearId?: string; branchId?: string } = {}) =>
        request<AttendanceClass[]>('GET', `attendance/classes${qs({ ...query })}`),
      attendanceSheet: (sectionId: string, date?: string) =>
        request<AttendanceSheet>('GET', `attendance/sections/${enc(sectionId)}${qs({ date })}`),
      attendanceHistory: (
        sectionId: string,
        query: { page?: number; pageSize?: number; from?: string; to?: string } = {},
      ) =>
        request<Paginated<AttendanceHistoryDay>>(
          'GET',
          `attendance/sections/${enc(sectionId)}/history${qs({ ...query })}`,
        ),
      attendanceChanges: (sectionId: string, date: string) =>
        request<AttendanceRecordChange[]>(
          'GET',
          `attendance/sections/${enc(sectionId)}/changes${qs({ date })}`,
        ),
      saveAttendance: (body: SaveAttendanceRequest) =>
        request<AttendanceSheet>('PUT', 'attendance', { body }),
      studentAttendance: (studentId: string, academicYearId?: string) =>
        request<StudentAttendanceSummary | null>(
          'GET',
          `attendance/students/${enc(studentId)}${qs({ academicYearId })}`,
        ),

      classwork: (kind: ClassworkKind, query: ClassworkQuery = {}) =>
        request<Paginated<ClassworkItem>>('GET', `${kind}${qs({ ...query })}`),
      classworkItem: (kind: ClassworkKind, id: string) =>
        request<ClassworkItem>('GET', `${kind}/${enc(id)}`),
      classworkTargets: (kind: ClassworkKind) =>
        request<ClassworkTarget[]>('GET', `${kind}/targets`),
      createClasswork: (kind: ClassworkKind, body: SaveClassworkRequest) =>
        request<ClassworkItem>('POST', kind, { body }),
      updateClasswork: (kind: ClassworkKind, id: string, body: UpdateClassworkRequest) =>
        request<ClassworkItem>('PATCH', `${kind}/${enc(id)}`, { body }),
      transitionClasswork: (
        kind: ClassworkKind,
        id: string,
        action: 'publish' | 'close' | 'archive',
        expectedVersion: number,
      ) =>
        request<ClassworkItem>('POST', `${kind}/${enc(id)}/${action}`, {
          body: { expectedVersion },
        }),
      deleteClasswork: (kind: ClassworkKind, id: string) =>
        request<null>('DELETE', `${kind}/${enc(id)}`),

      periods: (branchId: string, academicYearId: string) =>
        request<TimetablePeriod[]>('GET', `timetable/periods${qs({ branchId, academicYearId })}`),
      createPeriod: (body: SaveTimetablePeriodRequest) =>
        request<TimetablePeriod>('POST', 'timetable/periods', { body }),
      updatePeriod: (id: string, body: UpdateTimetablePeriodRequest) =>
        request<TimetablePeriod>('PATCH', `timetable/periods/${enc(id)}`, { body }),
      deletePeriod: (id: string) => request<null>('DELETE', `timetable/periods/${enc(id)}`),
      reorderPeriods: (branchId: string, academicYearId: string, ids: string[]) =>
        request<TimetablePeriod[]>('PUT', 'timetable/periods/order', {
          body: { branchId, academicYearId, ids },
        }),
      createEntry: (body: SaveTimetableEntryRequest) =>
        request<TimetableEntry>('POST', 'timetable/entries', { body }),
      updateEntry: (id: string, body: UpdateTimetableEntryRequest) =>
        request<TimetableEntry>('PATCH', `timetable/entries/${enc(id)}`, { body }),
      deleteEntry: (id: string) => request<null>('DELETE', `timetable/entries/${enc(id)}`),
      sectionWeek: (sectionId: string) =>
        request<TimetableWeek>('GET', `timetable/sections/${enc(sectionId)}`),
      /** `teacherId` may be 'me' for the signed-in teacher's own week. */
      teacherWeek: (teacherId: string, academicYearId?: string) =>
        request<TimetableWeek>(
          'GET',
          `timetable/teachers/${enc(teacherId)}${qs({ academicYearId })}`,
        ),
    },

    /**
     * Phase 8 mobile self-service API. Parent/Student routes are resolved from the signed-in
     * user's own profile/relationships on the server — the client never sends identity.
     */
    mobile: {
      me: () => request<MobileMe>('GET', 'mobile/me'),
      children: () => request<MobileChild[]>('GET', 'mobile/parent/children'),
      /** `studentId` null = the signed-in student (own data); else a parent's linked child. */
      home: (studentId: string | null) =>
        request<MobileStudentHome>('GET', `${mobileBase(studentId)}/home`),
      attendance: (studentId: string | null) =>
        request<StudentAttendanceSummary | null>('GET', `${mobileBase(studentId)}/attendance`),
      attendanceDays: (
        studentId: string | null,
        query: { page?: number; pageSize?: number } = {},
      ) =>
        request<Paginated<MobileAttendanceDay>>(
          'GET',
          `${mobileBase(studentId)}/attendance/days${qs({ ...query })}`,
        ),
      work: (
        studentId: string | null,
        kind: ClassworkKind,
        query: { scope?: MobileWorkScope; page?: number; pageSize?: number } = {},
      ) =>
        request<Paginated<MobileWorkItem>>(
          'GET',
          `${mobileBase(studentId)}/${kind}${qs({ ...query })}`,
        ),
      workItem: (studentId: string | null, kind: ClassworkKind, id: string) =>
        request<MobileWorkItem>('GET', `${mobileBase(studentId)}/${kind}/${enc(id)}`),
      timetable: (studentId: string | null) =>
        request<TimetableWeek>('GET', `${mobileBase(studentId)}/timetable`),
      results: (studentId: string | null) =>
        request<PublishedResultSummary[]>('GET', `${mobileBase(studentId)}/results`),
      reportCard: (studentId: string | null, examId: string) =>
        request<ReportCard>('GET', `${mobileBase(studentId)}/results/${enc(examId)}`),
      submit: (assignmentId: string, body: SubmitAssignmentRequest) =>
        request<MobileWorkItem>(
          'PUT',
          `mobile/student/assignments/${enc(assignmentId)}/submission`,
          {
            body,
          },
        ),
      submissions: (assignmentId: string) =>
        request<AssignmentSubmissionList>(
          'GET',
          `mobile/teacher/assignments/${enc(assignmentId)}/submissions`,
        ),
    },

    /** Phase 9: exams, marks, results, report cards and assignment grading (scoped server-side). */
    assessment: {
      gradeScales: (academicYearId: string) =>
        request<GradeScale[]>('GET', `grade-scales${qs({ academicYearId })}`),
      saveGradeScale: (
        id: string | null,
        body: {
          academicYearId: string;
          name: string;
          bands: GradeBandInput[];
          expectedVersion?: number;
        },
      ) =>
        request<GradeScale[]>(
          id ? 'PUT' : 'POST',
          id ? `grade-scales/${enc(id)}` : 'grade-scales',
          { body },
        ),
      deleteGradeScale: (id: string) => request<null>('DELETE', `grade-scales/${enc(id)}`),
      exams: (
        query: {
          academicYearId?: string;
          status?: string;
          q?: string;
          page?: number;
          pageSize?: number;
        } = {},
      ) => request<Paginated<ExamSummary>>('GET', `exams${qs({ ...query })}`),
      exam: (id: string) => request<ExamDetail>('GET', `exams/${enc(id)}`),
      createExam: (body: CreateExamRequest) => request<ExamDetail>('POST', 'exams', { body }),
      updateExam: (id: string, body: UpdateExamRequest) =>
        request<ExamDetail>('PATCH', `exams/${enc(id)}`, { body }),
      deleteExam: (id: string) => request<null>('DELETE', `exams/${enc(id)}`),
      transition: (id: string, action: ExamTransition, expectedVersion: number) =>
        request<ExamDetail>('POST', `exams/${enc(id)}/transitions/${action}`, {
          body: { expectedVersion },
        }),
      addSubject: (
        id: string,
        body: { gradeId: string; subjectId: string; passMarks?: string | null },
      ) => request<ExamDetail>('POST', `exams/${enc(id)}/subjects`, { body }),
      updateSubject: (
        id: string,
        examSubjectId: string,
        body: { passMarks?: string | null; displayOrder?: number },
      ) =>
        request<ExamDetail>('PATCH', `exams/${enc(id)}/subjects/${enc(examSubjectId)}`, { body }),
      removeSubject: (id: string, examSubjectId: string) =>
        request<ExamDetail>('DELETE', `exams/${enc(id)}/subjects/${enc(examSubjectId)}`),
      addComponent: (
        id: string,
        examSubjectId: string,
        body: { name: string; maxMarks: string; passMarks?: string | null },
      ) =>
        request<ExamDetail>('POST', `exams/${enc(id)}/subjects/${enc(examSubjectId)}/components`, {
          body,
        }),
      updateComponent: (
        id: string,
        componentId: string,
        body: { name?: string; maxMarks?: string; passMarks?: string | null },
      ) =>
        request<ExamDetail>('PATCH', `exams/${enc(id)}/components/${enc(componentId)}`, { body }),
      removeComponent: (id: string, componentId: string) =>
        request<ExamDetail>('DELETE', `exams/${enc(id)}/components/${enc(componentId)}`),
      setSchedule: (
        id: string,
        componentId: string,
        branchId: string,
        body: { examDate: string; startTime: string; endTime: string },
      ) =>
        request<ExamDetail>(
          'PUT',
          `exams/${enc(id)}/components/${enc(componentId)}/schedules/${enc(branchId)}`,
          { body },
        ),
      removeSchedule: (id: string, componentId: string, branchId: string) =>
        request<ExamDetail>(
          'DELETE',
          `exams/${enc(id)}/components/${enc(componentId)}/schedules/${enc(branchId)}`,
        ),
      sheets: (id: string, query: { page?: number; pageSize?: number } = {}) =>
        request<Paginated<MarkSheetSummary>>('GET', `exams/${enc(id)}/sheets${qs({ ...query })}`),
      sheet: (id: string, examSubjectId: string, sectionId: string) =>
        request<MarkSheet>(
          'GET',
          `exams/${enc(id)}/sheets/${enc(examSubjectId)}/${enc(sectionId)}`,
        ),
      saveMarks: (id: string, examSubjectId: string, sectionId: string, body: SaveMarksRequest) =>
        request<MarkSheet>(
          'PUT',
          `exams/${enc(id)}/sheets/${enc(examSubjectId)}/${enc(sectionId)}`,
          { body },
        ),
      sheetAction: (
        id: string,
        examSubjectId: string,
        sectionId: string,
        action: 'submit' | 'finalize' | 'reopen',
        expectedVersion: number,
        reason?: string,
      ) =>
        request<MarkSheet>(
          'POST',
          `exams/${enc(id)}/sheets/${enc(examSubjectId)}/${enc(sectionId)}/${action}`,
          {
            body: { expectedVersion, ...(reason ? { reason } : {}) },
          },
        ),
      results: (id: string, query: { sectionId?: string; page?: number; pageSize?: number } = {}) =>
        request<ClassResults>('GET', `exams/${enc(id)}/results${qs({ ...query })}`),
      preview: (id: string, studentId: string) =>
        request<ReportCard>('GET', `exams/${enc(id)}/results/students/${enc(studentId)}`),
      setRemark: (id: string, studentId: string, remark: string | null) =>
        request<ReportCard>('PUT', `exams/${enc(id)}/remarks/${enc(studentId)}`, {
          body: { remark },
        }),
      publish: (id: string, expectedVersion: number) =>
        request<ResultPublicationSummary[]>('POST', `exams/${enc(id)}/results/publish`, {
          body: { expectedVersion },
        }),
      publications: (id: string) =>
        request<ResultPublicationSummary[]>('GET', `exams/${enc(id)}/publications`),
      publishedCard: (publicationId: string, studentId: string) =>
        request<ReportCard>(
          'GET',
          `result-publications/${enc(publicationId)}/students/${enc(studentId)}`,
        ),
      grading: (assignmentId: string) =>
        request<AssignmentGrading>('GET', `assignments/${enc(assignmentId)}/grading`),
      saveGrade: (
        assignmentId: string,
        submissionId: string,
        version: number,
        body: SaveGradeRequest,
      ) =>
        request<AssignmentGrading>(
          'PUT',
          `assignments/${enc(assignmentId)}/submissions/${enc(submissionId)}/versions/${String(version)}/grade`,
          { body },
        ),
      publishGrade: (
        assignmentId: string,
        submissionId: string,
        version: number,
        expectedVersion: number,
      ) =>
        request<AssignmentGrading>(
          'POST',
          `assignments/${enc(assignmentId)}/submissions/${enc(submissionId)}/versions/${String(version)}/grade/publish`,
          { body: { expectedVersion } },
        ),
    },

    /** Phase 6 School Admin workspace read models (tenant-scoped, permission-aware). */
    admin: {
      dashboard: (query: WorkspaceContextQuery = {}) =>
        request<DashboardSummary>('GET', `workspace/dashboard${qs({ ...query })}`),
      search: (q: string) => request<SearchResults>('GET', `workspace/search${qs({ q })}`),
      access: (query: AccessQuery) =>
        request<Paginated<AccessRow>>('GET', `workspace/access${qs({ ...query })}`),
      classes: (query: ClassListQuery = {}) =>
        request<ClassSummary[]>('GET', `classes${qs({ ...query })}`),
      class: (sectionId: string) => request<ClassDetail>('GET', `classes/${enc(sectionId)}`),
    },

    auth: (base: 'platform/auth' | 'auth', context: TenantRequestContext = {}) => {
      const headers: Record<string, string> = {};
      if (context.host) headers.host = context.host;
      if (context.tenantKey) headers[TENANT_KEY_HEADER] = context.tenantKey;
      const call = <T>(method: HttpMethod, path: string, body?: unknown) =>
        request<T>(method, `${base}/${path}`, { headers, ...(body === undefined ? {} : { body }) });
      return {
        login: (identifier: string, secret: string, device?: DeviceDescriptor) =>
          call<AuthResult>(
            'POST',
            'login',
            base === 'auth'
              ? { identifier, secret, device }
              : { email: identifier, password: secret, device },
          ),
        refresh: (refreshToken: string) => call<AuthTokens>('POST', 'refresh', { refreshToken }),
        verifyMfa: (mfaToken: string, factor: MfaFactor) =>
          call<AuthTokens>('POST', 'mfa/verify', { mfaToken, ...factor }),
        startPendingEnrollment: (mfaToken: string) =>
          call<MfaEnrollmentStart>('POST', 'mfa/enroll/start', { mfaToken }),
        confirmPendingEnrollment: (mfaToken: string, code: string) =>
          call<MfaEnrollmentComplete>('POST', 'mfa/enroll/confirm', { mfaToken, code }),
        me: () => call<MeResponse>('GET', 'me'),
        logout: () => call<null>('POST', 'logout'),
        logoutAll: () => call<null>('POST', 'logout-all'),
        sessions: () => call<SessionInfo[]>('GET', 'sessions'),
        revokeSession: (sessionId: string) =>
          call<null>('DELETE', `sessions/${encodeURIComponent(sessionId)}`),
        devices: () => call<DeviceInfo[]>('GET', 'devices'),
        revokeDevice: (deviceId: string) =>
          call<null>('DELETE', `devices/${encodeURIComponent(deviceId)}`),
        changeCredential: (
          currentSecret: string,
          credentialType: 'PASSWORD' | 'PIN',
          newSecret: string,
        ) => call<null>('POST', 'credentials/change', { currentSecret, credentialType, newSecret }),
        startTotp: () => call<MfaEnrollmentStart>('POST', 'mfa/totp/start'),
        confirmTotp: (code: string) =>
          call<MfaEnrollmentComplete>('POST', 'mfa/totp/confirm', { code }),
        removeTotp: (currentSecret: string, code: string) =>
          call<null>('POST', 'mfa/totp/remove', { currentSecret, code }),
        regenerateRecoveryCodes: (code: string) =>
          call<{ recoveryCodes: string[] }>('POST', 'mfa/recovery-codes/regenerate', { code }),
        startActivation: (identifier: string) =>
          call<{ message: string }>('POST', 'activation/start', { identifier }),
        verifyActivation: (identifier: string, code: string) =>
          call<OtpGrant>('POST', 'activation/verify', { identifier, code }),
        completeActivation: (
          grantToken: string,
          credentialType: 'PASSWORD' | 'PIN',
          secret: string,
          device?: DeviceDescriptor,
        ) =>
          call<AuthResult>('POST', 'activation/complete', {
            grantToken,
            credentialType,
            secret,
            device,
          }),
        startRecovery: (identifier: string) =>
          call<{ message: string }>('POST', 'recovery/start', { identifier }),
        verifyRecovery: (identifier: string, code: string) =>
          call<OtpGrant>('POST', 'recovery/verify', { identifier, code }),
        completeRecovery: (
          grantToken: string,
          credentialType: 'PASSWORD' | 'PIN',
          secret: string,
        ) => call<null>('POST', 'recovery/complete', { grantToken, credentialType, secret }),
      };
    },

    /** Authenticated tenant workspace (Phase 3 shell). */
    workspace: (context: TenantRequestContext = {}) => {
      const headers: Record<string, string> = context.host ? { host: context.host } : {};
      return request<{
        tenant: { key: string; slug: string };
        roles: string[];
        permissions: string[];
      }>('GET', 'tenant/workspace', { headers });
    },

    /** Tenant-scoped endpoints. The tenant is resolved server-side from Host / tenant key. */
    tenant: {
      bootstrap: (context: TenantRequestContext = {}, signal?: AbortSignal) => {
        const headers: Record<string, string> = {};
        if (context.host) headers.host = context.host;
        if (context.tenantKey) headers[TENANT_KEY_HEADER] = context.tenantKey;
        return request<TenantBootstrap>('GET', 'tenant/bootstrap', {
          headers,
          ...(signal ? { signal } : {}),
        });
      },
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
