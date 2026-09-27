import { TENANT_KEY_HEADER } from '@acadlyx/tenant-config';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TenantContext } from './tenant-context.js';
import { TenantResolverService } from './tenant-resolver.service.js';

/** Log fields attached to the request for pino (see LoggingModule customProps). */
export interface TenantLogFields {
  tenantId: string;
  tenantKey: string;
}

export type RequestWithTenant = Request & { tenantLog?: TenantLogFields };

/**
 * Resolves the tenant and records it on the request's TenantContext.
 * Never rejects on its own: AccessGuard turns the stored resolution into 404/400/403, so all
 * tenant errors flow through guards and the global exception filter consistently.
 * Applied only to tenant-scoped controllers (TenantApiModule); platform routes never see it.
 */
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(private readonly resolver: TenantResolverService) {}

  async use(req: RequestWithTenant, _res: Response, next: NextFunction): Promise<void> {
    const header = req.headers[TENANT_KEY_HEADER];
    const resolution = await this.resolver.resolve({
      host: req.headers.host,
      tenantKey: typeof header === 'string' ? header.trim() : undefined,
    });
    if (resolution.outcome === 'resolved') {
      req.tenantLog = { tenantId: resolution.tenant.id, tenantKey: resolution.tenant.key };
    }
    // Stored on the per-request context opened by RequestContextMiddleware.
    TenantContext.set(resolution);
    next();
  }
}
