import { Injectable } from '@nestjs/common';
import { PlatformPrismaService } from '../../database/platform-prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { TenantPrismaService } from '../../tenancy/tenant-prisma.service.js';

/**
 * Routes security persistence to the correct database path for a scope:
 *   TENANT   → TenantPrismaService (acadlyx_app, tenant from TenantContext, scoping + RLS)
 *   PLATFORM → PlatformPrismaService (owner role; platform rows have tenant_id NULL)
 * Tenant-scoped callers can therefore never touch platform rows, and vice versa.
 */
@Injectable()
export class AuthStore {
  constructor(
    private readonly platform: PlatformPrismaService,
    private readonly tenant: TenantPrismaService,
  ) {}

  run<T>(
    scope: 'TENANT' | 'PLATFORM',
    fn: (db: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return scope === 'TENANT' ? this.tenant.runWith(fn) : this.platform.$transaction(fn);
  }
}
