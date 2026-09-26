/**
 * School Admin HTTP status semantics, against a running API and a running `next start`:
 *   ACTIVE → 200, unknown → 404, DRAFT / SUSPENDED / INACTIVE / ARCHIVED → 403.
 *
 *   pnpm --filter @acadlyx/school-admin test:e2e
 *
 * Requires: API on API_BASE_URL (default http://localhost:4000/api/v1), School Admin on
 * SCHOOL_ADMIN_URL (default http://127.0.0.1:4002) and DATABASE_URL (platform role) for
 * test-only cleanup. Fixture tenants are created through the platform API.
 *
 * Note: for notFound()/forbidden() Next.js 16 returns the real status code and delivers the
 * app/not-found.tsx / app/forbidden.tsx UI in the same response's RSC payload (hydrated
 * immediately; no extra request). The assertions therefore check the status, the framework's
 * HTTP-fallback digest and the controlled UI text in the response body.
 */
import http from 'node:http';
import { createApiClient } from '@acadlyx/api-client';
import type { TenantLifecycleAction } from '@acadlyx/tenant-config';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PREFIX = 'SAHTTP';
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000/api/v1';
const SCHOOL_ADMIN_URL = new URL(process.env.SCHOOL_ADMIN_URL ?? 'http://127.0.0.1:4002');
const api = createApiClient({ baseUrl: API_BASE_URL });

type Case = 'ACTIVE' | 'DRAFT' | 'SUSPENDED' | 'INACTIVE' | 'ARCHIVED';

/** Lifecycle path from a DRAFT tenant to each target status (approved transitions only). */
const PATHS: Record<Case, TenantLifecycleAction[]> = {
  ACTIVE: ['activate'],
  DRAFT: [],
  SUSPENDED: ['activate', 'suspend'],
  INACTIVE: ['activate', 'deactivate'],
  ARCHIVED: ['archive'],
};

const hostFor = (status: string) => `${PREFIX.toLowerCase()}-${status.toLowerCase()}.localhost`;

/** GET / on School Admin with an explicit Host header (what a browser on that domain sends). */
function getPage(host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      SCHOOL_ADMIN_URL,
      { method: 'GET', headers: { host: `${host}:${SCHOOL_ADMIN_URL.port}` } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** TEST-ONLY hard delete of fixture tenants (never exposed through the API). */
async function purge(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for fixture cleanup');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const like = `${PREFIX}\\_%`;
    for (const table of [
      'tenant_configurations',
      'tenant_features',
      'tenant_brandings',
      'tenant_domains',
    ]) {
      await client.query(
        `DELETE FROM ${table} WHERE tenant_id IN (SELECT id FROM tenants WHERE key LIKE $1)`,
        [like],
      );
    }
    await client.query('DELETE FROM tenants WHERE key LIKE $1', [like]);
  } finally {
    await client.end();
  }
}

describe('School Admin tenant HTTP status codes', () => {
  beforeAll(async () => {
    await purge();
    for (const status of Object.keys(PATHS) as Case[]) {
      const tenant = await api.platform.createTenant({
        displayName: `Status ${status} School`,
        key: `${PREFIX}_${status}`,
        slug: `${PREFIX.toLowerCase()}-${status.toLowerCase()}`,
      });
      await api.platform.addDomain(tenant.id, {
        domain: hostFor(status),
        type: 'ADMIN',
        isPrimary: true,
      });
      await api.platform.updateBranding(tenant.id, {
        schoolName: `Status ${status} School`,
        primaryColor: '#1D4ED8',
      });
      for (const action of PATHS[status]) await api.platform.transitionTenant(tenant.id, action);
    }
  });

  afterAll(async () => {
    await purge();
  });

  it('ACTIVE school → 200 with its branded dashboard', async () => {
    const res = await getPage(hostFor('ACTIVE'));
    expect(res.status).toBe(200);
    expect(res.body).toContain('Status ACTIVE School');
    expect(res.body).not.toContain('data-testid="tenant-problem"');
  });

  it('unknown host → 404 with the controlled "School not found" page', async () => {
    const res = await getPage(`${PREFIX.toLowerCase()}-nonexistent.localhost`);
    expect(res.status).toBe(404);
    expect(res.body).toContain('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(res.body).toContain('School not found');
  });

  it.each(['DRAFT', 'SUSPENDED', 'INACTIVE', 'ARCHIVED'] as const)(
    '%s school → 403 with the controlled "School unavailable" page',
    async (status) => {
      const res = await getPage(hostFor(status));
      expect(res.status).toBe(403);
      expect(res.body).toContain('NEXT_HTTP_ERROR_FALLBACK;403');
      expect(res.body).toContain('School unavailable');
      // Never leaks the unavailable school's branding or name.
      expect(res.body).not.toContain(`Status ${status} School`);
    },
  );
});
