import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlatformPrismaService } from '../src/database/platform-prisma.service.js';
import { createTestApp } from './helpers/app.js';
import {
  call,
  createPlatformUser,
  platformLogin,
  purgePlatformUsers,
  resetRateLimits,
  syncRbac,
} from './helpers/auth.js';
import {
  createFixtureTenants,
  type FixtureLetter,
  type FixtureTenant,
  purgeTenants,
  setStatus,
} from './helpers/tenant-fixtures.js';

const PREFIX = 'RES';
const BOOTSTRAP = '/api/v1/tenant/bootstrap';

describe('Tenant resolution and status enforcement (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PlatformPrismaService;
  let t: Record<FixtureLetter, FixtureTenant>;

  const bootstrap = (headers: Record<string, string>) => {
    const req = request(app.getHttpServer()).get(BOOTSTRAP);
    for (const [name, value] of Object.entries(headers)) req.set(name, value);
    return req;
  };

  let platformToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PlatformPrismaService);
    await resetRateLimits(app);
    await syncRbac(app);
    t = await createFixtureTenants(prisma, PREFIX);
    await purgePlatformUsers(app, 'res-admin@');
    await createPlatformUser(app, {
      email: 'res-admin@acadlyx.test',
      password: 'Res-admin-pass-2026!',
    });
    platformToken = (await platformLogin(app, 'res-admin@acadlyx.test', 'Res-admin-pass-2026!'))
      .tokens.accessToken;
  });

  afterAll(async () => {
    await purgeTenants(prisma, PREFIX);
    await purgePlatformUsers(app, 'res-admin@');
    await app.close();
  });

  it.each(['A', 'B', 'C'] as const)('Host %s resolves to its own tenant only', async (letter) => {
    const res = await bootstrap({ Host: `${t[letter].domain}:4002` }).expect(200);
    expect(res.body).toMatchObject({
      key: t[letter].key,
      displayName: `Test School ${letter}`,
      branding: { primaryColor: t[letter].color },
      enabledFeatures: ['ATTENDANCE'],
    });
  });

  it('returns only public-safe data (no internal ids, domains or private settings)', async () => {
    const res = await bootstrap({ Host: t.A.domain }).expect(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(t.A.id);
    expect(res.body).not.toHaveProperty('id');
    expect(res.body).not.toHaveProperty('domains');
    expect(res.body.settings).not.toHaveProperty('general.academic_year_start_month');
    expect(res.body.settings).toHaveProperty('general.timezone');
  });

  it('rejects unknown hosts with 404 TENANT_NOT_FOUND', async () => {
    const res = await bootstrap({ Host: 'unknown-school.localhost' }).expect(404);
    expect(res.body).toMatchObject({ code: 'TENANT_NOT_FOUND', statusCode: 404 });
    await bootstrap({ Host: 'localhost:4000' }).expect(404);
  });

  it('falls back to the public tenant-key header when the host matches no tenant', async () => {
    const res = await bootstrap({ Host: 'localhost:4000', 'X-Acadlyx-Tenant-Key': t.B.key }).expect(
      200,
    );
    expect(res.body.key).toBe(t.B.key);
    await bootstrap({ Host: 'localhost', 'X-Acadlyx-Tenant-Key': 'NO_SUCH_KEY' }).expect(404);
    await bootstrap({ Host: 'localhost', 'X-Acadlyx-Tenant-Key': 'bad key!' }).expect(404);
  });

  it('rejects conflicting identifiers with 400 TENANT_CONFLICT', async () => {
    const res = await bootstrap({ Host: t.A.domain, 'X-Acadlyx-Tenant-Key': t.B.key }).expect(400);
    expect(res.body.code).toBe('TENANT_CONFLICT');
    // Host identifies A and the key is unknown: still a conflict, never a silent choice.
    await bootstrap({ Host: t.A.domain, 'X-Acadlyx-Tenant-Key': 'NO_SUCH_KEY' }).expect(400);
    // Agreeing identifiers are fine.
    await bootstrap({ Host: t.A.domain, 'X-Acadlyx-Tenant-Key': t.A.key }).expect(200);
  });

  it.each(['DRAFT', 'SUSPENDED', 'INACTIVE', 'ARCHIVED'] as const)(
    'blocks %s tenants with 403 TENANT_UNAVAILABLE (host and key)',
    async (status) => {
      await setStatus(prisma, t.C.id, status);
      try {
        const byHost = await bootstrap({ Host: t.C.domain }).expect(403);
        expect(byHost.body.code).toBe('TENANT_UNAVAILABLE');
        await bootstrap({ Host: 'localhost', 'X-Acadlyx-Tenant-Key': t.C.key }).expect(403);
        // Platform routes can still inspect the tenant.
        const platform = await call(app, { token: platformToken })
          .get(`/api/v1/platform/tenants/${t.C.id}`)
          .expect(200);
        expect(platform.body.status).toBe(status);
      } finally {
        await setStatus(prisma, t.C.id, 'ACTIVE');
      }
    },
  );

  it('does not trust unverified non-localhost domains', async () => {
    const custom = 'portal.res-custom-school.com';
    await prisma.tenantDomain.create({
      data: { tenantId: t.A.id, domain: custom, type: 'CUSTOM' },
    });
    await bootstrap({ Host: custom }).expect(404);
    await prisma.tenantDomain.update({
      where: { domain: custom },
      data: { verifiedAt: new Date() },
    });
    const res = await bootstrap({ Host: custom }).expect(200);
    expect(res.body.key).toBe(t.A.key);
  });

  it('keeps tenant context isolated across alternating requests (A,B,A,B,…)', async () => {
    for (let i = 0; i < 12; i += 1) {
      const letter: FixtureLetter = i % 2 === 0 ? 'A' : 'B';
      const res = await bootstrap({ Host: t[letter].domain }).expect(200);
      expect(res.body.key).toBe(t[letter].key);
      expect(res.body.branding.primaryColor).toBe(t[letter].color);
    }
  });

  it('keeps tenant context isolated under concurrent A/B/C requests', async () => {
    const letters: FixtureLetter[] = Array.from(
      { length: 60 },
      (_, i) => (['A', 'B', 'C'] as const)[i % 3] ?? 'A',
    );
    const responses = await Promise.all(
      letters.map((letter) =>
        bootstrap({ Host: t[letter].domain }).then((res) => ({ letter, res })),
      ),
    );
    for (const { letter, res } of responses) {
      expect(res.status).toBe(200);
      expect(res.body.key).toBe(t[letter].key);
      expect(res.body.branding.primaryColor).toBe(t[letter].color);
    }
  });

  it('platform routes do not require or use a tenant', async () => {
    await call(app, { token: platformToken, host: 'unknown-school.localhost' })
      .get('/api/v1/platform/tenants?search=RES_')
      .expect(200);
  });
});

describe('Tenant resolution in production mode (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PlatformPrismaService;
  let t: Record<FixtureLetter, FixtureTenant>;

  beforeAll(async () => {
    app = await createTestApp({ production: true });
    prisma = app.get(PlatformPrismaService);
    t = await createFixtureTenants(prisma, 'RESPROD');
  });

  afterAll(async () => {
    await purgeTenants(prisma, 'RESPROD');
    await app.close();
  });

  it('only verified domains resolve — unverified *.localhost is rejected', async () => {
    await request(app.getHttpServer()).get(BOOTSTRAP).set('Host', t.A.domain).expect(404);
    await prisma.tenantDomain.update({
      where: { domain: t.A.domain },
      data: { verifiedAt: new Date() },
    });
    const res = await request(app.getHttpServer())
      .get(BOOTSTRAP)
      .set('Host', t.A.domain)
      .expect(200);
    expect(res.body.key).toBe(t.A.key);
  });
});
