import type { TenantStatus } from '@acadlyx/tenant-config';
import { DOMAIN_PATTERN, normalizeDomain, TENANT_KEY_PATTERN } from '@acadlyx/validation';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';
import { PlatformPrismaService } from '../database/platform-prisma.service.js';
import type { ResolvedTenant, TenantResolution } from './tenant-context.js';

export interface TenantResolutionInput {
  /** Raw Host header (may include a port). */
  host: string | undefined;
  /** Raw X-Acadlyx-Tenant-Key header (public identifier; never authentication). */
  tenantKey: string | undefined;
}

/** Extracts a normalised host name from a Host header; undefined for IPs/bare names/garbage. */
export function hostToDomain(host: string | undefined): string | undefined {
  if (!host) return undefined;
  const withoutPort = host.trim().replace(/:\d+$/, '');
  const domain = normalizeDomain(withoutPort);
  return DOMAIN_PATTERN.test(domain) ? domain : undefined;
}

/**
 * Resolves the tenant for a request (approved precedence):
 *   1. Host → TenantDomain. Production: verified domains only. Non-production: verified
 *      domains, plus unverified *.localhost domains for local development.
 *   2. X-Acadlyx-Tenant-Key → Tenant.key, used when the Host matched no tenant.
 *   If both identify a tenant and they differ → conflict. If neither → not-found.
 * Lifecycle status is NOT checked here; TenantGuard enforces ACTIVE.
 *
 * Runs on the platform client because resolution necessarily looks across tenants.
 */
@Injectable()
export class TenantResolverService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly config: AppConfigService,
  ) {}

  async resolve(input: TenantResolutionInput): Promise<TenantResolution> {
    const [byHost, byKey] = await Promise.all([
      this.byHost(hostToDomain(input.host)),
      input.tenantKey === undefined ? Promise.resolve(undefined) : this.byKey(input.tenantKey),
    ]);

    if (byHost) {
      if (input.tenantKey !== undefined && byKey?.id !== byHost.id) {
        return { outcome: 'conflict' };
      }
      return { outcome: 'resolved', tenant: byHost, source: 'host' };
    }
    if (byKey) return { outcome: 'resolved', tenant: byKey, source: 'tenant-key' };
    return { outcome: 'not-found' };
  }

  private async byHost(domain: string | undefined): Promise<ResolvedTenant | undefined> {
    if (!domain) return undefined;
    const row = await this.prisma.tenantDomain.findUnique({
      where: { domain },
      select: { verifiedAt: true, tenant: { select: TENANT_SELECT } },
    });
    if (!row) return undefined;
    const trusted =
      row.verifiedAt !== null || (!this.config.isProduction && domain.endsWith('.localhost'));
    return trusted ? toResolved(row.tenant) : undefined;
  }

  private async byKey(key: string): Promise<ResolvedTenant | undefined> {
    if (!TENANT_KEY_PATTERN.test(key)) return undefined;
    const tenant = await this.prisma.tenant.findUnique({ where: { key }, select: TENANT_SELECT });
    return tenant ? toResolved(tenant) : undefined;
  }
}

const TENANT_SELECT = { id: true, key: true, slug: true, status: true } as const;

function toResolved(tenant: {
  id: string;
  key: string;
  slug: string;
  status: TenantStatus;
}): ResolvedTenant {
  return { id: tenant.id, key: tenant.key, slug: tenant.slug, status: tenant.status };
}
