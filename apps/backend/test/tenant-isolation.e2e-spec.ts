import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlatformPrismaService } from '../src/database/platform-prisma.service.js';
import { TenantContext, type TenantResolution } from '../src/tenancy/tenant-context.js';
import { TenantPrismaService } from '../src/tenancy/tenant-prisma.service.js';
import { TenantScopeViolationError } from '../src/tenancy/tenant-scope.js';
import { createTestApp } from './helpers/app.js';
import {
  createFixtureTenants,
  type FixtureLetter,
  type FixtureTenant,
  purgeTenants,
} from './helpers/tenant-fixtures.js';

const PREFIX = 'ISO';

/**
 * Application-path isolation: TenantPrismaService (acadlyx_app role + set_config + scoping
 * extension + RLS) exactly as tenant-scoped request handlers use it.
 */
describe('Tenant data isolation through TenantPrismaService (e2e)', () => {
  let app: NestExpressApplication;
  let platform: PlatformPrismaService;
  let db: TenantPrismaService;
  let t: Record<FixtureLetter, FixtureTenant>;

  const as = <T>(letter: FixtureLetter, fn: () => Promise<T>): Promise<T> => {
    const tenant = t[letter];
    const resolution: TenantResolution = {
      outcome: 'resolved',
      source: 'host',
      tenant: { id: tenant.id, key: tenant.key, slug: tenant.slug, status: 'ACTIVE' },
    };
    return TenantContext.run(resolution, fn);
  };

  beforeAll(async () => {
    app = await createTestApp();
    platform = app.get(PlatformPrismaService);
    db = app.get(TenantPrismaService);
    t = await createFixtureTenants(platform, PREFIX);
  });

  afterAll(async () => {
    await purgeTenants(platform, PREFIX);
    await app.close();
  });

  // A→B, B→C, C→A: every tenant attacks a different neighbour.
  const pairs: [FixtureLetter, FixtureLetter][] = [
    ['A', 'B'],
    ['B', 'C'],
    ['C', 'A'],
  ];

  describe.each(pairs)('tenant %s vs tenant %s', (me, other) => {
    it('reads see only own rows, and other rows are not found even by id', async () => {
      await as(me, () =>
        db.run(async (tx) => {
          const tenants = await tx.tenant.findMany();
          expect(tenants.map((row) => row.key)).toEqual([t[me].key]);
          const configs = await tx.tenantConfiguration.findMany();
          expect(configs.map((row) => row.id)).toEqual([t[me].configId]);
          const domains = await tx.tenantDomain.findMany();
          expect(domains.map((row) => row.domain)).toEqual([t[me].domain]);
          expect(
            await tx.tenantConfiguration.findFirst({ where: { id: t[other].configId } }),
          ).toBeNull();
          expect(await tx.tenantFeature.count({ where: { id: t[other].featureId } })).toBe(0);
        }),
      );
    });

    it('cannot update the other tenant', async () => {
      await as(me, () =>
        db.run(async (tx) => {
          const result = await tx.tenantFeature.updateMany({
            where: { id: t[other].featureId },
            data: { enabled: false },
          });
          expect(result.count).toBe(0);
          await expect(
            tx.tenantConfiguration.update({
              where: { id: t[other].configId },
              data: { value: 'en-US' },
            }),
          ).rejects.toMatchObject({ code: 'P2025' });
        }),
      );
      const untouched = await platform.tenantFeature.findUniqueOrThrow({
        where: { id: t[other].featureId },
      });
      expect(untouched.enabled).toBe(true);
    });

    it('cannot delete the other tenant', async () => {
      await as(me, () =>
        db.run(async (tx) => {
          const result = await tx.tenantConfiguration.deleteMany({
            where: { id: t[other].configId },
          });
          expect(result.count).toBe(0);
        }),
      );
      await expect(
        platform.tenantConfiguration.count({ where: { id: t[other].configId } }),
      ).resolves.toBe(1);
    });

    it('cannot write rows into the other tenant or query it explicitly', async () => {
      await expect(
        as(me, () =>
          db.run((tx) =>
            tx.tenantFeature.create({
              data: { tenantId: t[other].id, featureKey: 'FEES', enabled: true },
            }),
          ),
        ),
      ).rejects.toBeInstanceOf(TenantScopeViolationError);
      await expect(
        as(me, () =>
          db.run((tx) => tx.tenantDomain.findMany({ where: { tenantId: t[other].id } })),
        ),
      ).rejects.toBeInstanceOf(TenantScopeViolationError);
    });
  });

  it('creates rows for the current tenant using the server-resolved context', async () => {
    const row = await as('A', () =>
      db.run((tx) =>
        tx.tenantFeature.create({
          data: { tenantId: TenantContext.getTenantId(), featureKey: 'FEES', enabled: true },
        }),
      ),
    );
    expect(row.tenantId).toBe(t.A.id);
    await platform.tenantFeature.delete({ where: { id: row.id } });
  });

  it('refuses to run without a tenant context or for a non-active tenant', async () => {
    await expect(db.run((tx) => tx.tenant.findMany())).rejects.toThrow(/Tenant context/);
    const suspended: TenantResolution = {
      outcome: 'resolved',
      source: 'host',
      tenant: { id: t.A.id, key: t.A.key, slug: t.A.slug, status: 'SUSPENDED' },
    };
    await expect(
      TenantContext.run(suspended, () => db.run((tx) => tx.tenant.findMany())),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('does not leak context across alternating and concurrent tenant transactions', async () => {
    const sequence: FixtureLetter[] = ['A', 'B', 'A', 'B', 'C', 'A', 'C', 'B'];
    for (const letter of sequence) {
      const keys = await as(letter, () =>
        db.run(async (tx) => (await tx.tenant.findMany()).map((r) => r.key)),
      );
      expect(keys).toEqual([t[letter].key]);
    }
    const concurrent = await Promise.all(
      Array.from({ length: 45 }, (_, i) => (['A', 'B', 'C'] as const)[i % 3] ?? 'A').map((letter) =>
        as(letter, () =>
          db.run(async (tx) => ({ letter, keys: (await tx.tenant.findMany()).map((r) => r.key) })),
        ),
      ),
    );
    for (const { letter, keys } of concurrent) expect(keys).toEqual([t[letter].key]);
  });
});
