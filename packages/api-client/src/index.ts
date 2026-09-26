/**
 * Typed HTTP client foundation shared by Platform Admin, School Admin and Mobile.
 * Business endpoints are added by the phase that introduces them.
 */
import { HEALTH_PATH } from '@acadlyx/constants';
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

  return {
    request,
    health: (signal?: AbortSignal) =>
      request<HealthResponse>('GET', HEALTH_PATH, signal ? { signal } : {}),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
