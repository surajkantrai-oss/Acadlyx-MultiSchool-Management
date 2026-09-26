import 'server-only';
import { ApiError, createApiClient } from '@acadlyx/api-client';
import type { TenantBootstrap } from '@acadlyx/tenant-config';
import { headers } from 'next/headers';
import { cache } from 'react';
import { appConfig } from './config';
import { hostForwardingFetch } from './server-fetch';

export type TenantLoadResult =
  | { kind: 'ok'; tenant: TenantBootstrap }
  | { kind: 'not-found' | 'unavailable' | 'conflict' | 'error'; host: string };

const serverApi = createApiClient({ baseUrl: appConfig.apiBaseUrl, fetch: hostForwardingFetch });

/**
 * Resolves the current school from the browser's Host (e.g. school-a.localhost:4002) via the
 * API's tenant bootstrap. One School Admin codebase serves every tenant; no tenant is hard-coded
 * and nothing is cached across requests, so one school's data can never render for another host.
 */
export const loadCurrentTenant = cache(async (): Promise<TenantLoadResult> => {
  const host = (await headers()).get('host') ?? '';
  try {
    const tenant = await serverApi.tenant.bootstrap({ host }, AbortSignal.timeout(3_000));
    return { kind: 'ok', tenant };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === 'TENANT_NOT_FOUND') return { kind: 'not-found', host };
      if (error.code === 'TENANT_UNAVAILABLE') return { kind: 'unavailable', host };
      if (error.code === 'TENANT_CONFLICT') return { kind: 'conflict', host };
    }
    return { kind: 'error', host };
  }
});
