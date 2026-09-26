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
import type { ApiErrorResponse, HealthResponse } from '@acadlyx/types';
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

function toQuery(query: TenantListQuery): string {
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
