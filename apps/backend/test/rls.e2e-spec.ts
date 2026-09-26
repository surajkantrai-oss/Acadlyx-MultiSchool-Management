import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfigService } from '../src/config/app-config.service.js';
import { PlatformPrismaService } from '../src/database/platform-prisma.service.js';
import { createTestApp } from './helpers/app.js';
import {
  createFixtureTenants,
  type FixtureLetter,
  type FixtureTenant,
  purgeTenants,
} from './helpers/tenant-fixtures.js';

const PREFIX = 'RLS';
const TENANT_TABLES = [
  'tenant_domains',
  'tenant_brandings',
  'tenant_features',
  'tenant_configurations',
];

/**
 * Database-level proof: raw SQL as the restricted role `acadlyx_app`, bypassing all application
 * code. Only PostgreSQL RLS stands between tenants here.
 */
describe('PostgreSQL Row Level Security (direct database tests)', () => {
  let app: NestExpressApplication;
  let platform: PlatformPrismaService;
  let t: Record<FixtureLetter, FixtureTenant>;
  let pool: pg.Pool; // max 1 connection: every query reuses the same pooled session
  let appUrl: string;

  async function inTenant<T>(
    client: pg.PoolClient,
    tenantId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    await client.query('BEGIN');
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await fn();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  beforeAll(async () => {
    app = await createTestApp();
    platform = app.get(PlatformPrismaService);
    appUrl = app.get(AppConfigService).get('DATABASE_APP_URL');
    t = await createFixtureTenants(platform, PREFIX);
    pool = new pg.Pool({ connectionString: appUrl, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
    await purgeTenants(platform, PREFIX);
    await app.close();
  });

  it('runs as a restricted role with FORCE RLS on every tenant table', async () => {
    const role = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const tables = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
       WHERE relname = ANY($1::text[]) ORDER BY relname`,
      [['tenants', ...TENANT_TABLES]],
    );
    expect(tables.rows).toHaveLength(5);
    for (const row of tables.rows) {
      expect(row, row.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    }
  });

  it('fails closed: without tenant context every table returns zero rows', async () => {
    for (const table of ['tenants', ...TENANT_TABLES]) {
      const res = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect(res.rows[0], table).toEqual({ n: 0 });
    }
  });

  const pairs: [FixtureLetter, FixtureLetter][] = [
    ['A', 'B'],
    ['B', 'C'],
    ['C', 'A'],
  ];

  it.each(pairs)('tenant %s cannot SELECT tenant %s rows', async (me, other) => {
    const client = await pool.connect();
    try {
      await inTenant(client, t[me].id, async () => {
        for (const table of TENANT_TABLES) {
          const own = await client.query(`SELECT DISTINCT tenant_id FROM ${table}`);
          expect(own.rows, table).toEqual([{ tenant_id: t[me].id }]);
          const theirs = await client.query(
            `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
            [t[other].id],
          );
          expect(theirs.rows[0], table).toEqual({ n: 0 });
        }
        const tenants = await client.query('SELECT key FROM tenants');
        expect(tenants.rows).toEqual([{ key: t[me].key }]);
      });
    } finally {
      client.release();
    }
  });

  it.each(pairs)('tenant %s cannot UPDATE, DELETE or INSERT for tenant %s', async (me, other) => {
    const client = await pool.connect();
    try {
      await inTenant(client, t[me].id, async () => {
        const updated = await client.query(
          'UPDATE tenant_features SET enabled = false WHERE tenant_id = $1',
          [t[other].id],
        );
        expect(updated.rowCount).toBe(0);
        const deleted = await client.query('DELETE FROM tenant_configurations WHERE id = $1', [
          t[other].configId,
        ]);
        expect(deleted.rowCount).toBe(0);
      });
      await expect(
        inTenant(client, t[me].id, () =>
          client.query(
            "INSERT INTO tenant_features (id, tenant_id, feature_key, enabled, updated_at) VALUES (gen_random_uuid(), $1, 'FEES', true, now())",
            [t[other].id],
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' }); // new row violates row-level security policy
      await expect(
        inTenant(client, t[me].id, () =>
          client.query('UPDATE tenant_configurations SET tenant_id = $1 WHERE id = $2', [
            t[other].id,
            t[me].configId,
          ]),
        ),
      ).rejects.toMatchObject({ code: '42501' }); // cannot move own rows into another tenant
    } finally {
      client.release();
    }
    const other_ = await platform.tenantFeature.findUniqueOrThrow({
      where: { id: t[other].featureId },
    });
    expect(other_.enabled).toBe(true);
  });

  it('cannot modify tenants or disable RLS from the tenant role', async () => {
    const client = await pool.connect();
    try {
      await expect(
        inTenant(client, t.A.id, () => client.query("UPDATE tenants SET display_name = 'x'")),
      ).rejects.toMatchObject({ code: '42501' }); // permission denied (SELECT-only grant)
      await expect(
        inTenant(client, t.A.id, async () => {
          await client.query('SET LOCAL row_security = off');
          return client.query('SELECT count(*) FROM tenant_features');
        }),
      ).rejects.toMatchObject({ code: '42501' }); // query would be affected by row-level security
    } finally {
      client.release();
    }
  });

  it('transaction-local context does not leak to the next use of the pooled connection', async () => {
    const sequence: FixtureLetter[] = ['A', 'B', 'A', 'B', 'C', 'A'];
    for (const letter of sequence) {
      const client = await pool.connect();
      try {
        const keys = await inTenant(client, t[letter].id, async () =>
          (await client.query<{ key: string }>('SELECT key FROM tenants')).rows.map((r) => r.key),
        );
        expect(keys).toEqual([t[letter].key]);
        // Same physical connection, after COMMIT: the setting is gone and nothing is visible.
        const after = await client.query<{ v: string | null }>(
          "SELECT current_setting('app.tenant_id', true) AS v",
        );
        expect(after.rows[0]?.v ?? '').toBe('');
        const visible = await client.query('SELECT count(*)::int AS n FROM tenant_features');
        expect(visible.rows[0]).toEqual({ n: 0 });
      } finally {
        client.release();
      }
    }
  });

  it('concurrent transactions on separate connections each see only their tenant', async () => {
    const wide = new pg.Pool({ connectionString: appUrl, max: 6 });
    try {
      const letters: FixtureLetter[] = Array.from(
        { length: 30 },
        (_, i) => (['A', 'B', 'C'] as const)[i % 3] ?? 'A',
      );
      const results = await Promise.all(
        letters.map(async (letter) => {
          const client = await wide.connect();
          try {
            const keys = await inTenant(client, t[letter].id, async () => {
              await client.query('SELECT pg_sleep(0.01)');
              return (await client.query<{ key: string }>('SELECT key FROM tenants')).rows.map(
                (r) => r.key,
              );
            });
            return { letter, keys };
          } finally {
            client.release();
          }
        }),
      );
      for (const { letter, keys } of results) expect(keys).toEqual([t[letter].key]);
    } finally {
      await wide.end();
    }
  });
});
