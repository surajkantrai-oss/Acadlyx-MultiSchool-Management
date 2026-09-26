import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { TenantSettingsService } from './tenants/tenant-settings.service.js';
import { TenantsController } from './tenants/tenants.controller.js';
import { TenantsService } from './tenants/tenants.service.js';

/**
 * Platform scope (/api/v1/platform/...): Acadlyx-internal management across all tenants.
 * Uses PlatformPrismaService; no tenant resolution or tenant context applies.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [TenantsController],
  providers: [TenantsService, TenantSettingsService],
})
export class PlatformModule {}
