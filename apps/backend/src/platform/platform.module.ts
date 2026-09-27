import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAuthController } from './auth/platform-auth.controller.js';
import { PlatformAuthService } from './auth/platform-auth.service.js';
import { TenantUsersController } from './tenant-users/tenant-users.controller.js';
import { TenantUsersService } from './tenant-users/tenant-users.service.js';
import { TenantSettingsService } from './tenants/tenant-settings.service.js';
import { TenantsController } from './tenants/tenants.controller.js';
import { TenantsService } from './tenants/tenants.service.js';

/**
 * Platform scope (/api/v1/platform/...): Acadlyx-internal management across tenants, protected by
 * Platform Admin authentication + platform permissions. Uses PlatformPrismaService; no tenant
 * resolution or tenant context applies.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [PlatformAuthController, TenantsController, TenantUsersController],
  providers: [PlatformAuthService, TenantsService, TenantSettingsService, TenantUsersService],
})
export class PlatformModule {}
