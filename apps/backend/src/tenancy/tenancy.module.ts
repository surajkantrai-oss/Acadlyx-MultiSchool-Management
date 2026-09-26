import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { TenantPrismaService } from './tenant-prisma.service.js';
import { TenantResolutionMiddleware } from './tenant-resolution.middleware.js';
import { TenantResolverService } from './tenant-resolver.service.js';
import { TenantGuard } from './tenant.guard.js';

/**
 * Tenancy infrastructure. Exports only what tenant-scoped modules need: the tenant database,
 * the guard and the resolution middleware. PlatformPrismaService stays internal (used by
 * the resolver) and is NOT re-exported.
 */
@Module({
  imports: [DatabaseModule],
  providers: [TenantResolverService, TenantResolutionMiddleware, TenantGuard, TenantPrismaService],
  exports: [TenantResolverService, TenantResolutionMiddleware, TenantGuard, TenantPrismaService],
})
export class TenancyModule {}
