import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfigService } from '../src/config/app-config.service.js';
import { PlatformPrismaService } from '../src/database/platform-prisma.service.js';
import { createTestApp } from './helpers/app.js';
import {
  createPlatformUser,
  createTenantUser,
  installationId,
  purgePlatformUsers,
  resetRateLimits,
  syncRbac,
  tenantLogin,
} from './helpers/auth.js';
import {
  createFixtureTenants,
  type FixtureLetter,
  type FixtureTenant,
  purgeTenants,
} from './helpers/tenant-fixtures.js';

const PREFIX = 'ARLS';
const PW = 'Arls-pass-2026';

/** Tenant-scoped Phase 3 tables and a representative row id per tenant. */
const AUTH_TABLES = [
  'users',
  'user_roles',
  'sessions',
  'refresh_tokens',
  'user_devices',
  'otp_challenges',
  'mfa_methods',
  'mfa_recovery_codes',
  'audit_logs',
] as const;

/**
 * Raw SQL as the restricted role `acadlyx_app` against the Phase 3 auth tables — no application
 * code involved. Proves RLS, grants, column grants and composite FKs hold at the database.
 */
describe('Row Level Security on Phase 3 auth tables (direct database tests)', () => {
  let app: NestExpressApplication;
  let prisma: PlatformPrismaService;
  let t: Record<FixtureLetter, FixtureTenant>;
  let pool: pg.Pool;
  const userId: Record<string, string> = {};

  async function asTenant<T>(
    tenant: FixtureLetter,
    fn: (c: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [t[tenant].id]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PlatformPrismaService);
    await resetRateLimits(app);
    await syncRbac(app);
    t = await createFixtureTenants(prisma, PREFIX);
    for (const l of ['A', 'B', 'C'] as const) {
      const email = `rls@arls-${l.toLowerCase()}.test`;
      userId[l] = await createTenantUser(app, {
        tenantId: t[l].id,
        roles: ['PRINCIPAL'],
        email,
        secret: PW,
      });
      // Produces sessions, refresh tokens, devices, MFA method + recovery codes, audit rows.
      await tenantLogin(app, t[l].domain, email, PW, { installationId: installationId() });
      const pending = await createTenantUser(app, {
        tenantId: t[l].id,
        roles: ['PARENT'],
        phone: `+9197600000${String(['A', 'B', 'C'].indexOf(l))}0`,
      });
      await prisma.otpChallenge.create({
        data: {
          tenantId: t[l].id,
          userId: pending,
          purpose: 'ACCOUNT_ACTIVATION',
          channel: 'SMS',
          target: 'x',
          codeHmac: 'k:00',
          expiresAt: new Date(Date.now() + 60_000),
          maxAttempts: 5,
        },
      });
    }
    await purgePlatformUsers(app, 'arls-');
    await createPlatformUser(app, {
      email: 'arls-admin@acadlyx.test',
      password: 'Arls-admin-pass-26',
    });
    pool = new pg.Pool({
      connectionString: app.get(AppConfigService).get('DATABASE_APP_URL'),
      max: 2,
    });
  });

  afterAll(async () => {
    await pool.end();
    await purgeTenants(prisma, PREFIX);
    await purgePlatformUsers(app, 'arls-');
    await app.close();
  });

  it('every tenant auth table has ENABLE + FORCE RLS; platform tables are deny-all', async () => {
    const rows = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      'SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1::text[])',
      [[...AUTH_TABLES, 'platform_users', 'platform_user_roles', 'platform_audit_logs']],
    );
    expect(rows.rows).toHaveLength(12);
    for (const r of rows.rows)
      expect(r, r.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('fails closed without tenant context', async () => {
    for (const table of AUTH_TABLES) {
      expect((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0], table).toEqual({
        n: 0,
      });
    }
  });

  it.each([
    ['A', 'B'],
    ['B', 'C'],
    ['C', 'A'],
  ] as const)(
    'tenant %s cannot SELECT, UPDATE or DELETE tenant %s auth rows',
    async (me, other) => {
      await asTenant(me, async (c) => {
        for (const table of AUTH_TABLES) {
          const own = await c.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
            [t[me].id],
          );
          expect(own.rows[0]?.n, `${table} own`).toBeGreaterThan(0);
          const theirs = await c.query(
            `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
            [t[other].id],
          );
          expect(theirs.rows[0], `${table} other`).toEqual({ n: 0 });
        }
        expect(
          (
            await c.query('UPDATE sessions SET revocation_reason = $2 WHERE tenant_id = $1', [
              t[other].id,
              'x',
            ])
          ).rowCount,
        ).toBe(0);
        expect(
          (
            await c.query('UPDATE users SET locked_until = now() WHERE tenant_id = $1', [
              t[other].id,
            ])
          ).rowCount,
        ).toBe(0);
        expect(
          (await c.query('DELETE FROM mfa_recovery_codes WHERE tenant_id = $1', [t[other].id]))
            .rowCount,
        ).toBe(0);
        expect(
          (await c.query('DELETE FROM mfa_methods WHERE tenant_id = $1', [t[other].id])).rowCount,
        ).toBe(0);
      });
      expect(await prisma.mfaRecoveryCode.count({ where: { tenantId: t[other].id } })).toBe(10);
    },
  );

  it('cannot INSERT rows for another tenant (WITH CHECK)', async () => {
    const attempts: [string, unknown[]][] = [
      [
        "INSERT INTO sessions (id, scope, tenant_id, user_id, idle_expires_at, absolute_expires_at) VALUES (gen_random_uuid(), 'TENANT', $1, $2, now() + interval '1 hour', now() + interval '1 day')",
        [t.B.id, userId.B],
      ],
      [
        "INSERT INTO user_devices (id, scope, tenant_id, user_id, installation_hash, platform) VALUES (gen_random_uuid(), 'TENANT', $1, $2, repeat('a', 64), 'IOS')",
        [t.B.id, userId.B],
      ],
      [
        "INSERT INTO audit_logs (id, tenant_id, actor_label, action, resource_type) VALUES (gen_random_uuid(), $1, 'x', 'FORGED', 'x')",
        [t.B.id],
      ],
    ];
    for (const [sql, params] of attempts) {
      await expect(
        asTenant('A', (c) => c.query(sql, params)),
        sql.slice(0, 30),
      ).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('cannot move own rows into another tenant', async () => {
    await expect(
      asTenant('A', (c) =>
        c.query('UPDATE sessions SET tenant_id = $1 WHERE tenant_id = $2', [t.B.id, t.A.id]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('column grants: identity columns and roles are not writable from the tenant role', async () => {
    for (const column of [
      'tenant_id = gen_random_uuid()',
      "login_id = 'X'",
      "display_name = 'X'",
      'id = gen_random_uuid()',
    ]) {
      await expect(
        asTenant('A', (c) => c.query(`UPDATE users SET ${column} WHERE id = $1`, [userId.A])),
        column,
      ).rejects.toMatchObject({ code: '42501' });
    }
    // Allowed login-state columns work (own tenant only).
    expect(
      (
        await asTenant('A', (c) =>
          c.query('UPDATE users SET failed_login_count = 0 WHERE id = $1', [userId.A]),
        )
      ).rowCount,
    ).toBe(1);
    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'SCHOOL_ADMIN' } });
    await expect(
      asTenant('A', (c) =>
        c.query(
          "INSERT INTO user_roles (id, tenant_id, user_id, role_id, role_scope) VALUES (gen_random_uuid(), $1, $2, $3, 'TENANT')",
          [t.A.id, userId.A, role.id],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asTenant('A', (c) => c.query('DELETE FROM user_roles WHERE user_id = $1', [userId.A])),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(asTenant('A', (c) => c.query('DELETE FROM audit_logs'))).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      asTenant('A', (c) => c.query("UPDATE roles SET name = 'x'")),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('cannot read or mutate platform auth tables, or disable RLS', async () => {
    for (const sql of [
      'SELECT * FROM platform_users',
      'SELECT * FROM platform_user_roles',
      'SELECT * FROM platform_audit_logs',
      "UPDATE platform_users SET status = 'ACTIVE'",
    ]) {
      await expect(
        asTenant('A', (c) => c.query(sql)),
        sql,
      ).rejects.toMatchObject({ code: '42501' });
    }
    // Platform rows in shared tables (tenant_id NULL) are invisible.
    const platformSessions = await asTenant('A', (c) =>
      c.query('SELECT count(*)::int AS n FROM sessions WHERE tenant_id IS NULL'),
    );
    expect(platformSessions.rows[0]).toEqual({ n: 0 });
    await expect(
      asTenant('A', async (c) => {
        await c.query('SET LOCAL row_security = off');
        return c.query('SELECT count(*) FROM users');
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('composite FKs block cross-tenant links even for the owner role', async () => {
    const sessionB = await prisma.session.findFirstOrThrow({ where: { tenantId: t.B.id } });
    await expect(
      prisma.refreshToken.create({
        data: { sessionId: sessionB.id, tenantId: t.A.id, tokenHash: 'f'.repeat(64) },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.session.create({
        data: {
          scope: 'TENANT',
          tenantId: t.A.id,
          userId: userId.B ?? '',
          idleExpiresAt: new Date(Date.now() + 60_000),
          absoluteExpiresAt: new Date(Date.now() + 120_000),
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.session.create({
        data: {
          scope: 'TENANT',
          tenantId: null,
          userId: userId.A ?? '',
          idleExpiresAt: new Date(Date.now() + 60_000),
          absoluteExpiresAt: new Date(Date.now() + 120_000),
        },
      }),
    ).rejects.toThrow(); // scope/owner CHECK
  });

  it('negative control: without set_config the same queries see nothing', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const users = await client.query('SELECT count(*)::int AS n FROM users');
      expect(users.rows[0]).toEqual({ n: 0 });
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });
});
