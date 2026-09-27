/**
 * School Admin HTTP status semantics, against a running API and a running `next start`:
 *   ACTIVE → 200, unknown → 404, DRAFT / SUSPENDED / INACTIVE / ARCHIVED → 403.
 *
 *   pnpm --filter @acadlyx/school-admin test:e2e
 *
 * Note: for notFound()/forbidden() Next.js 16 returns the real status code and delivers the
 * app/not-found.tsx / app/forbidden.tsx UI in the same response's RSC payload (hydrated
 * immediately; no extra request). The assertions therefore check the status, the framework's
 * HTTP-fallback digest and the controlled UI text in the response body.
 *
 * Phase 3: fixtures are inserted directly (platform APIs now require Platform Admin auth); the
 * statuses under test are exactly the Phase 2 lifecycle values.
 */
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchool, db, purge, request } from './helpers';

const PREFIX = 'SAHTTP';
const STATUSES = ['ACTIVE', 'DRAFT', 'SUSPENDED', 'INACTIVE', 'ARCHIVED'] as const;
const hostFor = (status: string) => `${PREFIX.toLowerCase()}-${status.toLowerCase()}.localhost`;
const getPage = (host: string) => request('GET', '/', { host });

describe('School Admin tenant HTTP status codes', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = db();
    await client.connect();
    await purge(client, PREFIX);
    for (const status of STATUSES) {
      await createSchool(client, {
        key: `${PREFIX}_${status}`,
        status,
        domain: hostFor(status),
        name: `Status ${status} School`,
      });
    }
  });

  afterAll(async () => {
    await purge(client, PREFIX);
    await client.end();
  });

  it('ACTIVE school → 200 with its branded page (sign-in when signed out)', async () => {
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

  it.each(['/activate', '/recover', '/security'])(
    '%s keeps the same tenant semantics (404 / 403)',
    async (path) => {
      expect(
        (await request('GET', path, { host: `${PREFIX.toLowerCase()}-nonexistent.localhost` }))
          .status,
      ).toBe(404);
      expect((await request('GET', path, { host: hostFor('SUSPENDED') })).status).toBe(403);
    },
  );
});
