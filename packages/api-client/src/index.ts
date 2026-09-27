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
