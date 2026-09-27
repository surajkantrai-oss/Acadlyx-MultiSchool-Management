import { InternalServerErrorException } from '@nestjs/common';
import { tenantUnavailable } from '../common/errors/domain-errors.js';
import {
  RequestContext,
  type ResolvedTenant,
  type TenantResolution,
} from '../common/request-context.js';

export type { ResolvedTenant, TenantResolution } from '../common/request-context.js';

/**
 * Request-scoped tenant context, stored in the per-request RequestContext (AsyncLocalStorage):
 * one isolated store per request, safe under concurrency, no global mutable state. Set only by
 * TenantResolutionMiddleware; read by AccessGuard and TenantPrismaService.
 */
export const TenantContext = {
  /** Runs `fn` in a fresh request store with `resolution` (used by tests and scripts). */
  run<T>(resolution: TenantResolution, fn: () => T): T {
    return RequestContext.run({ requestId: null, ip: null, userAgent: null }, () => {
      TenantContext.set(resolution);
      return fn();
    });
  },

  /** Records the resolution on the current request store. */
  set(resolution: TenantResolution): void {
    const state = RequestContext.state();
    if (!state) throw new InternalServerErrorException('Request context is not established');
    state.tenantResolution = resolution;
  },

  resolution(): TenantResolution | undefined {
    return RequestContext.state()?.tenantResolution;
  },

  /** The resolved tenant, if any (regardless of status). */
  getTenant(): ResolvedTenant | undefined {
    const resolution = TenantContext.resolution();
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
