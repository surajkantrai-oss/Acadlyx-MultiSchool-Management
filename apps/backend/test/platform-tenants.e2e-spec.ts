import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlatformPrismaService } from '../src/database/platform-prisma.service.js';
import { createTestApp } from './helpers/app.js';
import { purgeTenants } from './helpers/tenant-fixtures.js';

const PREFIX = 'PLT';
const BASE = '/api/v1/platform/tenants';

describe('Platform tenant management API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PlatformPrismaService;
  let id: string;

  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PlatformPrismaService);
    await purgeTenants(prisma, PREFIX);
  });

  afterAll(async () => {
    await purgeTenants(prisma, PREFIX);
    await app.close();
  });

  describe('create / get / update', () => {
    it('creates a DRAFT tenant', async () => {
      const res = await api()
        .post(BASE)
        .send({ displayName: 'Platform Test School', key: 'PLT_ONE', slug: 'plt-one' })
        .expect(201);
      expect(res.body).toMatchObject({
        key: 'PLT_ONE',
        slug: 'plt-one',
        status: 'DRAFT',
        slugLocked: false,
        availableActions: ['activate', 'archive'],
        domains: [],
        branding: null,
        enabledFeatures: [],
      });
      id = res.body.id as string;
      await api().get(`${BASE}/${id}`).expect(200);
    });

    it('rejects duplicate keys and slugs with 409', async () => {
      const key = await api()
        .post(BASE)
        .send({ displayName: 'X', key: 'PLT_ONE', slug: 'plt-other' })
        .expect(409);
      expect(key.body.code).toBe('TENANT_KEY_TAKEN');
      const slug = await api()
        .post(BASE)
        .send({ displayName: 'X', key: 'PLT_OTHER', slug: 'plt-one' })
        .expect(409);
      expect(slug.body.code).toBe('TENANT_SLUG_TAKEN');
    });

    it('validates input and rejects unknown fields', async () => {
      const res = await api()
        .post(BASE)
        .send({
          displayName: '<b>x</b>',
          key: 'lower',
          slug: 'Bad Slug',
          initialStatus: 'SUSPENDED',
        })
        .expect(400);
      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/key/i), expect.stringMatching(/slug/i)]),
      );
      await api()
        .post(BASE)
        .send({ displayName: 'X', key: 'PLT_X', slug: 'plt-x', tenantId: 'x' })
        .expect(400);
      await api().get(`${BASE}/not-a-uuid`).expect(400);
      await api().get(`${BASE}/0190a0a0-0000-7000-8000-000000000000`).expect(404);
    });

    it('updates names; key is immutable; slug editable only before first activation', async () => {
      const res = await api()
        .patch(`${BASE}/${id}`)
        .send({ displayName: 'Renamed', slug: 'plt-one-b' })
        .expect(200);
      expect(res.body).toMatchObject({ displayName: 'Renamed', slug: 'plt-one-b' });
      await api().patch(`${BASE}/${id}`).send({ key: 'PLT_NEW' }).expect(400);
    });
  });

  describe('lifecycle', () => {
    it('follows the approved transitions and records timestamps', async () => {
      const activated = await api().post(`${BASE}/${id}/activate`).expect(200);
      expect(activated.body).toMatchObject({ status: 'ACTIVE', slugLocked: true });
      expect(activated.body.firstActivatedAt).toEqual(expect.any(String));

      const locked = await api().patch(`${BASE}/${id}`).send({ slug: 'plt-one-c' }).expect(409);
      expect(locked.body.code).toBe('TENANT_SLUG_LOCKED');

      await api().post(`${BASE}/${id}/suspend`).expect(200);
      await api().post(`${BASE}/${id}/activate`).expect(200);
      await api().post(`${BASE}/${id}/deactivate`).expect(200);
      const invalid = await api().post(`${BASE}/${id}/suspend`).expect(409);
      expect(invalid.body.code).toBe('INVALID_STATUS_TRANSITION');
      await api().post(`${BASE}/${id}/activate`).expect(200);
    });

    it('archives only from DRAFT/INACTIVE, and ARCHIVED is terminal', async () => {
      const draft = await api()
        .post(BASE)
        .send({ displayName: 'Arch', key: 'PLT_ARCH', slug: 'plt-arch' })
        .expect(201);
      const archId = draft.body.id as string;
      const archived = await api().post(`${BASE}/${archId}/archive`).expect(200);
      expect(archived.body).toMatchObject({ status: 'ARCHIVED', availableActions: [] });
      expect(archived.body.archivedAt).toEqual(expect.any(String));
      for (const action of ['activate', 'suspend', 'deactivate', 'archive']) {
        await api().post(`${BASE}/${archId}/${action}`).expect(409);
      }
      // ACTIVE cannot be archived directly.
      await api().post(`${BASE}/${id}/archive`).expect(409);
    });

    it('creates ACTIVE tenants directly when requested', async () => {
      const res = await api()
        .post(BASE)
        .send({ displayName: 'Live', key: 'PLT_LIVE', slug: 'plt-live', initialStatus: 'ACTIVE' })
        .expect(201);
      expect(res.body).toMatchObject({ status: 'ACTIVE', slugLocked: true });
    });
  });

  describe('domains', () => {
    let domainId: string;

    it('adds normalised domains and enforces global uniqueness', async () => {
      const res = await api()
        .post(`${BASE}/${id}/domains`)
        .send({ domain: 'Portal.PLT-School.com', type: 'CUSTOM', isPrimary: true })
        .expect(201);
      expect(res.body).toMatchObject({
        domain: 'portal.plt-school.com',
        isPrimary: true,
        verifiedAt: null,
      });
      domainId = res.body.id as string;
      const dup = await api()
        .post(`${BASE}/${id}/domains`)
        .send({ domain: 'portal.plt-school.com', type: 'ADMIN' })
        .expect(409);
      expect(dup.body.code).toBe('DOMAIN_TAKEN');
    });

    it.each([
      'https://portal.plt-school.com',
      'portal.plt-school.com/login',
      'PLT SCHOOL .com',
      'nodot',
    ])('rejects invalid domain %s', async (domain) => {
      await api().post(`${BASE}/${id}/domains`).send({ domain, type: 'CUSTOM' }).expect(400);
    });

    it('keeps one primary per type and supports manual verification', async () => {
      const second = await api()
        .post(`${BASE}/${id}/domains`)
        .send({ domain: 'www.plt-school.com', type: 'CUSTOM', isPrimary: true })
        .expect(201);
      const list = await api().get(`${BASE}/${id}/domains`).expect(200);
      const primaries = (list.body as { isPrimary: boolean; type: string }[]).filter(
        (d) => d.isPrimary && d.type === 'CUSTOM',
      );
      expect(primaries).toHaveLength(1);

      const verified = await api()
        .patch(`${BASE}/${id}/domains/${domainId}`)
        .send({ verified: true, isPrimary: true })
        .expect(200);
      expect(verified.body).toMatchObject({ isPrimary: true, verifiedAt: expect.any(String) });
      await api()
        .delete(`${BASE}/${id}/domains/${second.body.id as string}`)
        .expect(204);
    });

    it('cannot touch another tenant domain through this tenant path', async () => {
      const other = await api()
        .post(BASE)
        .send({ displayName: 'Other', key: 'PLT_OTHER2', slug: 'plt-other2' })
        .expect(201);
      const otherId = other.body.id as string;
      await api()
        .patch(`${BASE}/${otherId}/domains/${domainId}`)
        .send({ isPrimary: false })
        .expect(404);
      await api().delete(`${BASE}/${otherId}/domains/${domainId}`).expect(404);
    });
  });

  describe('branding, features, configuration', () => {
    it('saves valid branding and rejects unsafe values', async () => {
      const res = await api()
        .put(`${BASE}/${id}/branding`)
        .send({
          schoolName: 'Platform School',
          primaryColor: '#1d4ed8',
          supportEmail: 'help@plt.example.com',
          logoUrl: '',
        })
        .expect(200);
      expect(res.body).toMatchObject({ primaryColor: '#1D4ED8', logoUrl: null });
      for (const bad of [
        { primaryColor: 'blue' },
        { logoUrl: 'javascript:alert(1)' },
        { logoUrl: 'http://insecure.example.com/a.png' },
        { footerText: '<script>x</script>' },
        { supportPhone: 'call me' },
        { css: 'body{}' },
      ]) {
        await api()
          .put(`${BASE}/${id}/branding`)
          .send({ schoolName: 'S', primaryColor: '#000000', ...bad })
          .expect(400);
      }
    });

    it('enables/disables registry features only', async () => {
      const list = await api().get(`${BASE}/${id}/features`).expect(200);
      expect(list.body).toHaveLength(20);
      await api().put(`${BASE}/${id}/features/ATTENDANCE`).send({ enabled: true }).expect(200);
      await api().put(`${BASE}/${id}/features/FEES`).send({ enabled: true }).expect(200);
      await api().put(`${BASE}/${id}/features/FEES`).send({ enabled: false }).expect(200);
      const detail = await api().get(`${BASE}/${id}`).expect(200);
      expect(detail.body.enabledFeatures).toEqual(['ATTENDANCE']);
      const unknown = await api()
        .put(`${BASE}/${id}/features/LIBRARY`)
        .send({ enabled: true })
        .expect(404);
      expect(unknown.body.code).toBe('UNKNOWN_FEATURE');
      await api().put(`${BASE}/${id}/features/FEES`).send({ enabled: 'yes' }).expect(400);
    });

    it('validates typed configuration values and supports reset', async () => {
      const list = await api().get(`${BASE}/${id}/configuration`).expect(200);
      expect(list.body.map((e: { key: string }) => e.key)).toContain('general.timezone');
      const set = await api()
        .put(`${BASE}/${id}/configuration/general.timezone`)
        .send({ value: 'Asia/Dubai' })
        .expect(200);
      expect(set.body).toMatchObject({ value: 'Asia/Dubai', isDefault: false });
      const bad = await api()
        .put(`${BASE}/${id}/configuration/general.timezone`)
        .send({ value: 'Mars/Base' })
        .expect(400);
      expect(bad.body.code).toBe('INVALID_CONFIGURATION_VALUE');
      await api()
        .put(`${BASE}/${id}/configuration/general.academic_year_start_month`)
        .send({ value: 13 })
        .expect(400);
      const unknown = await api()
        .put(`${BASE}/${id}/configuration/secrets.api_key`)
        .send({ value: 'x' })
        .expect(404);
      expect(unknown.body.code).toBe('UNKNOWN_CONFIGURATION_KEY');
      const reset = await api().delete(`${BASE}/${id}/configuration/general.timezone`).expect(200);
      expect(reset.body).toMatchObject({ value: 'Asia/Kolkata', isDefault: true });
    });
  });

  describe('list, search, stats', () => {
    it('searches by name, key, slug and domain with status filter and pagination', async () => {
      const byKey = await api().get(`${BASE}?search=plt_one`).expect(200);
      expect(byKey.body.items.map((t: { key: string }) => t.key)).toEqual(['PLT_ONE']);
      const byDomain = await api().get(`${BASE}?search=portal.plt-school`).expect(200);
      expect(byDomain.body.items[0]).toMatchObject({
        key: 'PLT_ONE',
        primaryDomain: 'portal.plt-school.com',
      });
      const byName = await api().get(`${BASE}?search=renamed`).expect(200);
      expect(byName.body.total).toBe(1);
      const archived = await api().get(`${BASE}?search=PLT_&status=ARCHIVED`).expect(200);
      expect(archived.body.items.map((t: { key: string }) => t.key)).toEqual(['PLT_ARCH']);
      const paged = await api().get(`${BASE}?search=PLT_&page=2&pageSize=2`).expect(200);
      expect(paged.body).toMatchObject({ page: 2, pageSize: 2, total: 4, totalPages: 2 });
      expect(paged.body.items).toHaveLength(2);
      await api().get(`${BASE}?pageSize=1000`).expect(400);
      await api().get(`${BASE}?status=DELETED`).expect(400);
    });

    it('reports live counts by status', async () => {
      const res = await api().get(`${BASE}/stats`).expect(200);
      expect(res.body.byStatus.ARCHIVED).toBeGreaterThanOrEqual(1);
      expect(res.body.total).toBe(
        Object.values(res.body.byStatus as Record<string, number>).reduce((a, b) => a + b, 0),
      );
    });
  });
});
