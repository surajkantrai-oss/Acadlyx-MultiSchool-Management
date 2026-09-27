import {
  CONFIGURATION_REGISTRY,
  isConfigurationKey,
  isFeatureKey,
  type ConfigurationKey,
  type FeatureKey,
  type TenantBootstrap,
} from '@acadlyx/tenant-config';
import { Controller, Get } from '@nestjs/common';
import { toBrandingDto } from '../tenancy/tenant-mappers.js';
import { TenantPrismaService } from '../tenancy/tenant-prisma.service.js';
import { Public, TenantScoped } from '../auth/core/access.decorators.js';

/**
 * Public-safe tenant configuration for white-label clients (School Admin, branded mobile).
 * Returns no internal ids, domains or private configuration. All reads go through the tenant
 * database path (acadlyx_app + RLS); note the queries carry no tenant filters of their own.
 */
@TenantScoped()
@Controller('tenant')
export class TenantBootstrapController {
  constructor(private readonly db: TenantPrismaService) {}

  /** Public: branding must render before login (login screens, mobile start-up). */
  @Public()
  @Get('bootstrap')
  bootstrap(): Promise<TenantBootstrap> {
    return this.db.run(async (tx) => {
      const tenant = await tx.tenant.findFirstOrThrow({
        select: {
          key: true,
          slug: true,
          displayName: true,
          branding: true,
        },
      });
      const features = await tx.tenantFeature.findMany({
        where: { enabled: true },
        select: { featureKey: true },
        orderBy: { featureKey: 'asc' },
      });
      const configurations = await tx.tenantConfiguration.findMany({
        select: { key: true, value: true },
      });

      const settings: Partial<Record<ConfigurationKey, unknown>> = {};
      for (const [key, definition] of Object.entries(CONFIGURATION_REGISTRY)) {
        if (definition.public) settings[key as ConfigurationKey] = definition.defaultValue;
      }
      for (const row of configurations) {
        if (isConfigurationKey(row.key) && CONFIGURATION_REGISTRY[row.key].public) {
          settings[row.key] = row.value;
        }
      }

      return {
        key: tenant.key,
        slug: tenant.slug,
        displayName: tenant.displayName,
        branding: tenant.branding ? toBrandingDto(tenant.branding) : null,
        enabledFeatures: features
          .map((f) => f.featureKey)
          .filter((key): key is FeatureKey => isFeatureKey(key)),
        settings,
      };
    });
  }
}
