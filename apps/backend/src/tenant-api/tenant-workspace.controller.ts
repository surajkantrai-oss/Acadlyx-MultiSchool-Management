import {
  CONFIGURATION_REGISTRY,
  type ConfigurationKey,
  type FeatureKey,
  isConfigurationKey,
  isFeatureKey,
} from '@acadlyx/tenant-config';
import { Controller, Get } from '@nestjs/common';
import { currentAuth } from '../auth/core/access.guard.js';
import { RequirePermission, TenantScoped } from '../auth/core/access.decorators.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { TenantPrismaService } from '../tenancy/tenant-prisma.service.js';

/**
 * Authenticated school workspace (Phase 3 shell only — no business modules yet).
 * Access requires tenant resolution + tenant-bound session + the named permission.
 */
@TenantScoped()
@Controller('tenant')
export class TenantWorkspaceController {
  constructor(private readonly db: TenantPrismaService) {}

  @RequirePermission('tenant.workspace.access')
  @Get('workspace')
  workspace(): { tenant: { key: string; slug: string }; roles: string[]; permissions: string[] } {
    const tenant = TenantContext.requireActiveTenant();
    const auth = currentAuth();
    return {
      tenant: { key: tenant.key, slug: tenant.slug },
      roles: auth.roles,
      permissions: auth.permissions,
    };
  }

  /** Read-only view of the school's enabled modules and settings (school leadership). */
  @RequirePermission('tenant.settings.read')
  @Get('settings')
  settings(): Promise<{
    enabledFeatures: FeatureKey[];
    configuration: Partial<Record<ConfigurationKey, unknown>>;
  }> {
    return this.db.run(async (tx) => {
      const features = await tx.tenantFeature.findMany({
        where: { enabled: true },
        orderBy: { featureKey: 'asc' },
      });
      const rows = await tx.tenantConfiguration.findMany();
      const configuration: Partial<Record<ConfigurationKey, unknown>> = {};
      for (const [key, definition] of Object.entries(CONFIGURATION_REGISTRY)) {
        configuration[key as ConfigurationKey] = definition.defaultValue;
      }
      for (const row of rows) if (isConfigurationKey(row.key)) configuration[row.key] = row.value;
      return {
        enabledFeatures: features
          .map((f) => f.featureKey)
          .filter((k): k is FeatureKey => isFeatureKey(k)),
        configuration,
      };
    });
  }
}
