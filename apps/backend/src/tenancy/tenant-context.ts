import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantStatus } from '@acadlyx/tenant-config';
import { InternalServerErrorException } from '@nestjs/common';
import { tenantUnavailable } from '../common/errors/domain-errors.js';

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

interface TenantRequestState {
  resolution: TenantResolution;
}

const storage = new AsyncLocalStorage<TenantRequestState>();

/**
 * Request-scoped tenant context backed by AsyncLocalStorage — one isolated store per request,
 * safe under concurrency (no global mutable state). Established only by
 * TenantResolutionMiddleware; read by TenantGuard and TenantPrismaService.
 */
export const TenantContext = {
  /** Runs `fn` with `resolution` as the current request's tenant state. */
  run<T>(resolution: TenantResolution, fn: () => T): T {
    return storage.run({ resolution }, fn);
  },

  resolution(): TenantResolution | undefined {
    return storage.getStore()?.resolution;
  },

  /** The resolved tenant, if any (regardless of status). */
  getTenant(): ResolvedTenant | undefined {
    const resolution = storage.getStore()?.resolution;
    return resolution?.outcome === 'resolved' ? resolution.tenant : undefined;
  },

  /**
   * The resolved ACTIVE tenant, or an error. Fails closed: calling this outside a tenant-scoped
   * request is a programming error (500), a non-ACTIVE tenant is 403 TENANT_UNAVAILABLE.
   */
  requireActiveTenant(): ResolvedTenant {
    const tenant = TenantContext.getTenant();
    if (!tenant) {
      throw new InternalServerErrorException('Tenant context is not established for this call');
    }
    if (tenant.status !== 'ACTIVE') throw tenantUnavailable();
    return tenant;
  },

  getTenantId(): string {
    return TenantContext.requireActiveTenant().id;
  },
};
