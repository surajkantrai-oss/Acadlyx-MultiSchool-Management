import { AsyncLocalStorage } from 'node:async_hooks';
import type { PermissionKey } from '@acadlyx/permissions';
import type { TenantStatus } from '@acadlyx/tenant-config';

/** Tenant identity established by the resolver for the current request. */
export interface ResolvedTenant {
  id: string;
  key: string;
  slug: string;
  status: TenantStatus;
}

export type TenantResolution =
  | { outcome: 'resolved'; tenant: ResolvedTenant; source: 'host' | 'tenant-key' }
  | { outcome: 'not-found' }
  | { outcome: 'conflict' };

/** Authenticated caller for the current request (set by AccessGuard after full validation). */
export type AuthIdentity =
  | {
      scope: 'TENANT';
      userId: string;
      tenantId: string;
      sessionId: string;
      roles: string[];
      permissions: PermissionKey[];
    }
  | {
      scope: 'PLATFORM';
      platformUserId: string;
      sessionId: string;
      roles: string[];
      permissions: PermissionKey[];
    };

export interface RequestMeta {
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
}

interface RequestState {
  meta: RequestMeta;
  tenantResolution?: TenantResolution;
  auth?: AuthIdentity;
}

const storage = new AsyncLocalStorage<RequestState>();

/**
 * One isolated, mutable store per request (AsyncLocalStorage) — safe under concurrency, no global
 * mutable state. Created by RequestContextMiddleware for every request; tenant resolution and
 * authentication fill in their parts as the request passes through middleware and guards.
 */
export const RequestContext = {
  run<T>(meta: RequestMeta, fn: () => T): T {
    return storage.run({ meta }, fn);
  },
  /** Current store, if any (undefined outside a request, e.g. in CLI scripts). */
  state(): RequestState | undefined {
    return storage.getStore();
  },
  meta(): RequestMeta {
    return storage.getStore()?.meta ?? { requestId: null, ip: null, userAgent: null };
  },
};
