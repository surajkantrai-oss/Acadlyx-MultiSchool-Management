import {
  CONFIGURATION_REGISTRY,
  FEATURE_REGISTRY,
  isConfigurationKey,
  isFeatureKey,
  TENANT_ERROR_CODES,
  validateConfigurationValue,
  type ConfigurationKey,
  type TenantBranding,
  type TenantConfigurationEntry,
  type TenantDomain,
  type TenantFeatureState,
} from '@acadlyx/tenant-config';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  badRequest,
  conflict,
  isUniqueViolation,
  notFound,
} from '../../common/errors/domain-errors.js';
import { PlatformPrismaService } from '../../database/platform-prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { toBrandingDto, toDomainDto } from '../../tenancy/tenant-mappers.js';
import type { AddDomainDto, UpdateBrandingDto, UpdateDomainDto } from './dto/tenant.dto.js';
import { TenantsService } from './tenants.service.js';

/** Platform-scoped management of a tenant's domains, branding, features and configuration. */
@Injectable()
export class TenantSettingsService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- domains

  async listDomains(tenantId: string): Promise<TenantDomain[]> {
    await this.tenants.requireTenant(tenantId);
    const rows = await this.prisma.tenantDomain.findMany({
      where: { tenantId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(toDomainDto);
  }

  async addDomain(tenantId: string, dto: AddDomainDto): Promise<TenantDomain> {
    const tenant = await this.tenants.requireTenant(tenantId);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if (dto.isPrimary) {
          await tx.tenantDomain.updateMany({
            where: { tenantId, type: dto.type, isPrimary: true },
            data: { isPrimary: false },
          });
        }
        return tx.tenantDomain.create({
          data: { tenantId, domain: dto.domain, type: dto.type, isPrimary: dto.isPrimary ?? false },
        });
      });
      this.audit.record({
        action: 'TENANT_DOMAIN_ADDED',
        resourceType: 'tenant_domain',
        resourceId: row.id,
        tenantId,
        tenantKey: tenant.key,
        metadata: { domain: row.domain, type: row.type, isPrimary: row.isPrimary },
      });
      return toDomainDto(row);
    } catch (error) {
      if (isUniqueViolation(error, 'tenant_domains_domain_key')) {
        throw conflict(TENANT_ERROR_CODES.DOMAIN_TAKEN, 'This domain is already assigned');
      }
      throw error;
    }
  }

  async updateDomain(
    tenantId: string,
    domainId: string,
    dto: UpdateDomainDto,
  ): Promise<TenantDomain> {
    const tenant = await this.tenants.requireTenant(tenantId);
    const existing = await this.requireDomain(tenantId, domainId);
    const row = await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary === true && !existing.isPrimary) {
        await tx.tenantDomain.updateMany({
          where: { tenantId, type: existing.type, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      return tx.tenantDomain.update({
        where: { id: domainId, tenantId },
        data: {
          ...(dto.isPrimary !== undefined ? { isPrimary: dto.isPrimary } : {}),
          ...(dto.verified !== undefined
            ? { verifiedAt: dto.verified ? (existing.verifiedAt ?? new Date()) : null }
            : {}),
        },
      });
    });
    const changed = Object.keys(dto);
    if (changed.length > 0) {
      this.audit.record({
        action:
          dto.verified !== undefined
            ? 'TENANT_DOMAIN_VERIFICATION_CHANGED'
            : 'TENANT_DOMAIN_UPDATED',
        resourceType: 'tenant_domain',
        resourceId: domainId,
        tenantId,
        tenantKey: tenant.key,
        changedFields: changed,
        metadata: { domain: row.domain, verification: 'manual' },
      });
    }
    return toDomainDto(row);
  }

  async removeDomain(tenantId: string, domainId: string): Promise<void> {
    const tenant = await this.tenants.requireTenant(tenantId);
    const existing = await this.requireDomain(tenantId, domainId);
    await this.prisma.tenantDomain.delete({ where: { id: domainId, tenantId } });
    this.audit.record({
      action: 'TENANT_DOMAIN_REMOVED',
      resourceType: 'tenant_domain',
      resourceId: domainId,
      tenantId,
      tenantKey: tenant.key,
      metadata: { domain: existing.domain },
    });
  }

  private async requireDomain(tenantId: string, domainId: string) {
    // Scoped by tenantId: a domain id belonging to another tenant is simply "not found".
    const domain = await this.prisma.tenantDomain.findFirst({ where: { id: domainId, tenantId } });
    if (!domain) throw notFound(TENANT_ERROR_CODES.DOMAIN_NOT_FOUND, 'Domain not found');
    return domain;
  }

  // --------------------------------------------------------------- branding

  async getBranding(tenantId: string): Promise<TenantBranding | null> {
    await this.tenants.requireTenant(tenantId);
    const row = await this.prisma.tenantBranding.findUnique({ where: { tenantId } });
    return row ? toBrandingDto(row) : null;
  }

  async updateBranding(tenantId: string, dto: UpdateBrandingDto): Promise<TenantBranding> {
    const tenant = await this.tenants.requireTenant(tenantId);
    const data = {
      schoolName: dto.schoolName,
      shortName: dto.shortName ?? null,
      logoUrl: dto.logoUrl ?? null,
      faviconUrl: dto.faviconUrl ?? null,
      primaryColor: dto.primaryColor.toUpperCase(),
      secondaryColor: dto.secondaryColor?.toUpperCase() ?? null,
      accentColor: dto.accentColor?.toUpperCase() ?? null,
      backgroundImageUrl: dto.backgroundImageUrl ?? null,
      loginImageUrl: dto.loginImageUrl ?? null,
      supportEmail: dto.supportEmail ?? null,
      supportPhone: dto.supportPhone ?? null,
      websiteUrl: dto.websiteUrl ?? null,
      footerText: dto.footerText ?? null,
    };
    const row = await this.prisma.tenantBranding.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
    this.audit.record({
      action: 'TENANT_BRANDING_UPDATED',
      resourceType: 'tenant_branding',
      resourceId: row.id,
      tenantId,
      tenantKey: tenant.key,
      changedFields: Object.keys(dto),
    });
    return toBrandingDto(row);
  }

  // --------------------------------------------------------------- features

  async listFeatures(tenantId: string): Promise<TenantFeatureState[]> {
    await this.tenants.requireTenant(tenantId);
    const rows = await this.prisma.tenantFeature.findMany({ where: { tenantId } });
    const byKey = new Map(rows.map((r) => [r.featureKey, r]));
    return FEATURE_REGISTRY.map((feature) => {
      const row = byKey.get(feature.key);
      return {
        key: feature.key,
        label: feature.label,
        group: feature.group,
        enabled: row?.enabled ?? false,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
  }

  async setFeature(
    tenantId: string,
    featureKey: string,
    enabled: boolean,
  ): Promise<TenantFeatureState> {
    if (!isFeatureKey(featureKey)) {
      throw notFound(TENANT_ERROR_CODES.UNKNOWN_FEATURE, 'Unknown feature');
    }
    const tenant = await this.tenants.requireTenant(tenantId);
    const row = await this.prisma.tenantFeature.upsert({
      where: { tenantId_featureKey: { tenantId, featureKey } },
      create: { tenantId, featureKey, enabled },
      update: { enabled },
    });
    this.audit.record({
      action: enabled ? 'TENANT_FEATURE_ENABLED' : 'TENANT_FEATURE_DISABLED',
      resourceType: 'tenant_feature',
      resourceId: row.id,
      tenantId,
      tenantKey: tenant.key,
      metadata: { featureKey },
    });
    const definition = FEATURE_REGISTRY.find((f) => f.key === featureKey);
    return {
      key: featureKey,
      label: definition?.label ?? featureKey,
      group: definition?.group ?? '',
      enabled: row.enabled,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  // ---------------------------------------------------------- configuration

  async listConfiguration(tenantId: string): Promise<TenantConfigurationEntry[]> {
    await this.tenants.requireTenant(tenantId);
    const rows = await this.prisma.tenantConfiguration.findMany({ where: { tenantId } });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return (Object.keys(CONFIGURATION_REGISTRY) as ConfigurationKey[]).map((key) =>
      this.toEntry(key, byKey.get(key) ?? null),
    );
  }

  async setConfiguration(
    tenantId: string,
    key: string,
    value: unknown,
  ): Promise<TenantConfigurationEntry> {
    if (!isConfigurationKey(key)) {
      throw notFound(TENANT_ERROR_CODES.UNKNOWN_CONFIGURATION_KEY, 'Unknown configuration key');
    }
    const result = validateConfigurationValue(key, value);
    if (!result.success) {
      throw badRequest(TENANT_ERROR_CODES.INVALID_CONFIGURATION_VALUE, result.errors);
    }
    const tenant = await this.tenants.requireTenant(tenantId);
    const json = result.value as Prisma.InputJsonValue;
    const row = await this.prisma.tenantConfiguration.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, value: json },
      update: { value: json },
    });
    this.audit.record({
      action: 'TENANT_CONFIGURATION_UPDATED',
      resourceType: 'tenant_configuration',
      resourceId: row.id,
      tenantId,
      tenantKey: tenant.key,
      changedFields: [key],
    });
    return this.toEntry(key, row);
  }

  async resetConfiguration(tenantId: string, key: string): Promise<TenantConfigurationEntry> {
    if (!isConfigurationKey(key)) {
      throw notFound(TENANT_ERROR_CODES.UNKNOWN_CONFIGURATION_KEY, 'Unknown configuration key');
    }
    const tenant = await this.tenants.requireTenant(tenantId);
    const { count } = await this.prisma.tenantConfiguration.deleteMany({
      where: { tenantId, key },
    });
    if (count > 0) {
      this.audit.record({
        action: 'TENANT_CONFIGURATION_UPDATED',
        resourceType: 'tenant_configuration',
        tenantId,
        tenantKey: tenant.key,
        changedFields: [key],
        metadata: { reset: true },
      });
    }
    return this.toEntry(key, null);
  }

  private toEntry(
    key: ConfigurationKey,
    row: { value: Prisma.JsonValue; updatedAt: Date } | null,
  ): TenantConfigurationEntry {
    const definition = CONFIGURATION_REGISTRY[key];
    const schema: unknown = definition.schema;
    const options =
      definition.input === 'select' &&
      typeof schema === 'object' &&
      schema !== null &&
      'options' in schema
        ? (schema.options as string[])
        : null;
    return {
      key,
      label: definition.label,
      description: definition.description,
      category: definition.category,
      input: definition.input,
      options,
      value: row ? row.value : definition.defaultValue,
      isDefault: row === null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }
}
