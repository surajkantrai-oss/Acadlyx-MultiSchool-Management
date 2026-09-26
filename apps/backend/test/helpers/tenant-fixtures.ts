import type { TenantStatus } from '@acadlyx/tenant-config';
import type { PlatformPrismaService } from '../../src/database/platform-prisma.service.js';

/**
 * Deterministic test tenants. Keys are prefixed per spec file so suites never touch each other's
 * (or the development seed's) data. Three tenants catch logic that assumes "one other tenant".
 */
export interface FixtureTenant {
  id: string;
  key: string;
  slug: string;
  domain: string;
  configId: string;
  featureId: string;
  color: string;
}

export const FIXTURE_LETTERS = ['A', 'B', 'C'] as const;
export type FixtureLetter = (typeof FIXTURE_LETTERS)[number];

const COLORS: Record<FixtureLetter, string> = { A: '#1D4ED8', B: '#15803D', C: '#B91C1C' };

/**
 * TEST-ONLY hard delete of every tenant whose key starts with `prefix`.
 * Hard deletion is never exposed through the API; this helper exists solely for test cleanup.
 */
export async function purgeTenants(prisma: PlatformPrismaService, prefix: string): Promise<void> {
  const where = { tenant: { key: { startsWith: prefix } } };
  await prisma.$transaction([
    prisma.tenantConfiguration.deleteMany({ where }),
    prisma.tenantFeature.deleteMany({ where }),
    prisma.tenantBranding.deleteMany({ where }),
    prisma.tenantDomain.deleteMany({ where }),
    prisma.tenant.deleteMany({ where: { key: { startsWith: prefix } } }),
  ]);
}

/** Creates ACTIVE tenants <prefix>_A/B/C, each with a *.localhost domain, branding, a feature and a config row. */
export async function createFixtureTenants(
  prisma: PlatformPrismaService,
  prefix: string,
): Promise<Record<FixtureLetter, FixtureTenant>> {
  await purgeTenants(prisma, prefix);
  const result = {} as Record<FixtureLetter, FixtureTenant>;
  for (const letter of FIXTURE_LETTERS) {
    const key = `${prefix}_${letter}`;
    const slug = key.toLowerCase().replace(/_/g, '-');
    const domain = `${slug}.localhost`;
    const tenant = await prisma.tenant.create({
      data: {
        key,
        slug,
        displayName: `Test School ${letter}`,
        status: 'ACTIVE',
        firstActivatedAt: new Date(),
        domains: { create: { domain, type: 'ADMIN', isPrimary: true } },
        branding: { create: { schoolName: `Test School ${letter}`, primaryColor: COLORS[letter] } },
        features: { create: { featureKey: 'ATTENDANCE', enabled: true } },
        configurations: { create: { key: 'general.locale', value: 'en-IN' } },
      },
      include: { features: true, configurations: true },
    });
    result[letter] = {
      id: tenant.id,
      key,
      slug,
      domain,
      configId: tenant.configurations[0]?.id ?? '',
      featureId: tenant.features[0]?.id ?? '',
      color: COLORS[letter],
    };
  }
  return result;
}

export async function setStatus(
  prisma: PlatformPrismaService,
  tenantId: string,
  status: TenantStatus,
): Promise<void> {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { status, archivedAt: status === 'ARCHIVED' ? new Date() : null },
  });
}
