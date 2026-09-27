import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { TenantPrismaService } from './tenant-prisma.service.js';
import { TenantResolutionMiddleware } from './tenant-resolution.middleware.js';
import { TenantResolverService } from './tenant-resolver.service.js';

/**
 * Tenancy infrastructure. Exports only what tenant-scoped modules need: the tenant database and
 * the resolution middleware. PlatformPrismaService stays internal (used by the resolver) and is
 * NOT re-exported. Enforcement of resolution outcomes lives in the global AccessGuard.
 */
@Module({
  imports: [DatabaseModule],
  providers: [TenantResolverService, TenantResolutionMiddleware, TenantPrismaService],
  exports: [TenantResolverService, TenantResolutionMiddleware, TenantPrismaService],
})
export class TenancyModule {}
