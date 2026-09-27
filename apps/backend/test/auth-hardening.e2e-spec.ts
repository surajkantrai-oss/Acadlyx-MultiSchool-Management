import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AuthResult, MfaEnrollmentStart } from '@acadlyx/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisService } from '../src/cache/redis.service.js';
import { PlatformPrismaService } from '../src/database/platform-prisma.service.js';
import { createTestApp } from './helpers/app.js';
import {
  call,
  createTenantUser,
  resetRateLimits,
  syncRbac,
  tenantLogin,
  TotpClock,
} from './helpers/auth.js';
import {
  createFixtureTenants,
  type FixtureLetter,
  type FixtureTenant,
  purgeTenants,
} from './helpers/tenant-fixtures.js';

const PREFIX = 'HRD';
const PIN = '482913';
const PW = 'Hardening-pass-1';

describe('Auth hardening: lockout, MFA policy, audit, rate limiting (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PlatformPrismaService;
  let t: Record<FixtureLetter, FixtureTenant>;
  let seq = 0;

  const api = (letter: FixtureLetter, token?: string) =>
    call(app, { host: t[letter].domain, ...(token ? { token } : {}) });
  const phone = () => {
    seq += 1;
    return `+91966${String(seq).padStart(7, '0')}`;
  };
  const login = (letter: FixtureLetter, identifier: string, secret: string) =>
    api(letter).post('/api/v1/auth/login').send({ identifier, secret });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PlatformPrismaService);
    await resetRateLimits(app);
    await syncRbac(app);
    t = await createFixtureTenants(prisma, PREFIX);
  });

  afterAll(async () => {
    await purgeTenants(prisma, PREFIX);
    await app.close();
  });

  describe('lockout (PostgreSQL authoritative)', () => {
    it('concurrent wrong PINs cannot exceed the 5-attempt threshold', async () => {
      const p = phone();
      const id = await createTenantUser(app, {
        tenantId: t.A.id,
        roles: ['PARENT'],
        phone: p,
        credentialType: 'PIN',
        secret: PIN,
      });
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => login('A', p, String(100000 + i))),
      );
      expect(results.every((r) => r.status === 401 || r.status === 429)).toBe(true);
      const checked = await prisma.auditLog.count({
        where: {
          action: 'LOGIN_FAILED',
          metadata: { path: ['reason'], equals: 'bad_credential' },
          AND: [{ metadata: { path: ['subjectUserId'], equals: id } }],
        },
      });
      expect(checked).toBeLessThanOrEqual(5); // at most 5 secrets actually tested
      const row = await prisma.user.findUniqueOrThrow({ where: { id } });
      expect(row.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
      await resetRateLimits(app);
      expect((await login('A', p, PIN)).status).toBe(401); // locked even with the right PIN
    });

    it('success resets the counter; the 3rd lockout within 24 h lasts 24 hours', async () => {
      const p = phone();
      const id = await createTenantUser(app, {
        tenantId: t.A.id,
        roles: ['PARENT'],
        phone: p,
        credentialType: 'PIN',
        secret: PIN,
      });
      for (let i = 0; i < 4; i += 1) await login('A', p, '000000').expect(401);
      await login('A', p, PIN).expect(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id } })).failedLoginCount).toBe(0);
      for (let round = 1; round <= 3; round += 1) {
        await resetRateLimits(app);
        for (let i = 0; i < 5; i += 1) await login('A', p, '000000');
        const row = await prisma.user.findUniqueOrThrow({ where: { id } });
        expect(row.lockoutCount).toBe(round);
        const minutes = ((row.lockedUntil?.getTime() ?? 0) - Date.now()) / 60_000;
        if (round < 3) {
          expect(minutes).toBeGreaterThan(14);
          expect(minutes).toBeLessThanOrEqual(15);
          await prisma.user.update({
            where: { id },
            data: { lockedUntil: new Date(Date.now() - 1000) },
          }); // let it expire
        } else {
          expect(minutes).toBeGreaterThan(23 * 60);
        }
      }
      expect((await prisma.user.findUniqueOrThrow({ where: { id } })).status).toBe('ACTIVE'); // never a status change
    });

    it('lockout is per tenant: the same mobile in another school is unaffected', async () => {
      const p = phone();
      await createTenantUser(app, {
        tenantId: t.A.id,
        roles: ['PARENT'],
        phone: p,
        credentialType: 'PIN',
        secret: PIN,
      });
      await createTenantUser(app, {
        tenantId: t.B.id,
        roles: ['PARENT'],
        phone: p,
        credentialType: 'PIN',
        secret: PIN,
      });
      for (let i = 0; i < 5; i += 1) await login('A', p, '000000');
      await login('A', p, PIN).expect(401);
      await login('B', p, PIN).expect(200);
    });

    it('lock state survives a Redis flush (PostgreSQL is authoritative)', async () => {
      const p = phone();
      await createTenantUser(app, {
        tenantId: t.A.id,
        roles: ['PARENT'],
        phone: p,
        credentialType: 'PIN',
        secret: PIN,
      });
      for (let i = 0; i < 5; i += 1) await login('A', p, '000000');
      await app.get(RedisService).client.flushdb();
      await login('A', p, PIN).expect(401);
    });

    it('suspended and disabled identities cannot log in', async () => {
      for (const status of ['SUSPENDED', 'PENDING_ACTIVATION'] as const) {
        const p = phone();
        await createTenantUser(app, {
          tenantId: t.A.id,
          roles: ['PARENT'],
          phone: p,
          credentialType: 'PIN',
          secret: PIN,
          status,
        });
        await login('A', p, PIN).expect(401);
      }
      const p = phone();
      const id = await createTenantUser(app, {
        tenantId: t.A.id,
        roles: ['PARENT'],
        phone: p,
        credentialType: 'PIN',
        secret: PIN,
      });
      await prisma.user.update({ where: { id }, data: { status: 'DISABLED' } });
      await login('A', p, PIN).expect(401);
    });
  });

  describe('MFA policy', () => {
    it.each(['PRINCIPAL', 'SCHOOL_ADMIN', 'ACCOUNTANT'])(
      '%s must enroll MFA before receiving tokens',
      async (role) => {
        const email = `${role.toLowerCase()}@hrd-a.test`;
        await createTenantUser(app, { tenantId: t.A.id, roles: [role], email, secret: PW });
        const res = (await login('A', email, PW).expect(200)).body as AuthResult;
        expect(res.status).toBe('MFA_ENROLLMENT_REQUIRED');
        expect(res).not.toHaveProperty('refreshToken');
      },
    );

    it('teachers may enroll optional MFA; removal needs password + code and revokes other sessions', async () => {
      const id = await createTenantUser(app, {
        tenantId: t.A.id,
        roles: ['TEACHER'],
        email: 'opt-mfa@hrd-a.test',
        secret: PW,
      });
      const s1 = (await tenantLogin(app, t.A.domain, 'opt-mfa@hrd-a.test', PW)).tokens;
      const enroll = (
        await api('A', s1.accessToken).post('/api/v1/auth/mfa/totp/start').expect(200)
      ).body as MfaEnrollmentStart;
      expect(enroll.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
      expect(enroll.otpauthUri).not.toContain('opt-mfa'); // no personal data in the URI
      const totp = new TotpClock(enroll.secret);
      await api('A', s1.accessToken)
        .post('/api/v1/auth/mfa/totp/confirm')
        .send({ code: await totp.next() })
        .expect(200);
      // Starting again once active is refused; the secret is never re-exposed.
      await api('A', s1.accessToken).post('/api/v1/auth/mfa/totp/start').expect(409);
      const me = await api('A', s1.accessToken).get('/api/v1/auth/me').expect(200);
      expect(JSON.stringify(me.body)).not.toContain(enroll.secret);
      // Next login now asks for MFA.
      const step = (await login('A', 'opt-mfa@hrd-a.test', PW).expect(200)).body as {
        status: string;
        mfaToken: string;
      };
      expect(step.status).toBe('MFA_REQUIRED');
      const s2 = (
        await api('A')
          .post('/api/v1/auth/mfa/verify')
          .send({ mfaToken: step.mfaToken, code: await totp.next() })
          .expect(200)
      ).body as { accessToken: string };
      await api('A', s1.accessToken)
        .post('/api/v1/auth/mfa/totp/remove')
        .send({ currentSecret: 'wrong-pass-1', code: await totp.next() })
        .expect(401);
      await api('A', s1.accessToken)
        .post('/api/v1/auth/mfa/totp/remove')
        .send({ currentSecret: PW, code: '000000' })
        .expect(401);
      await api('A', s1.accessToken)
        .post('/api/v1/auth/mfa/totp/remove')
        .send({ currentSecret: PW, code: await totp.next() })
        .expect(204);
      await api('A', s2.accessToken).get('/api/v1/auth/me').expect(401); // other session revoked
      expect(await prisma.mfaMethod.count({ where: { userId: id } })).toBe(0);
      expect(
        await prisma.auditLog.count({ where: { action: 'MFA_REMOVED', actorUserId: id } }),
      ).toBe(1);
    }, 60_000);
  });

  describe('audit trail', () => {
    it('records the real actor and never stores secrets', async () => {
      const p = phone();
      const id = await createTenantUser(app, {
        tenantId: t.C.id,
        roles: ['PARENT'],
        phone: p,
        credentialType: 'PIN',
        secret: PIN,
      });
      await call(app, { host: t.C.domain })
        .post('/api/v1/auth/login')
        .send({ identifier: p, secret: '000000' })
        .expect(401);
      const s = (
        await tenantLogin(app, t.C.domain, p, PIN, { installationId: 'hrd-install-0000000001' })
      ).tokens;
      await call(app, { host: t.C.domain, token: s.accessToken })
        .post('/api/v1/auth/credentials/change')
        .send({ currentSecret: PIN, credentialType: 'PIN', newSecret: '739182' })
        .expect(204);
      await call(app, { host: t.C.domain, token: s.accessToken })
        .post('/api/v1/auth/logout')
        .expect(204);
      const rows = await prisma.auditLog.findMany({
        where: {
          tenantId: t.C.id,
          OR: [{ actorUserId: id }, { metadata: { path: ['subjectUserId'], equals: id } }],
        },
      });
      const actions = rows.map((r) => r.action);
      for (const a of [
        'LOGIN_FAILED',
        'LOGIN_SUCCESS',
        'NEW_DEVICE_LOGIN',
        'PIN_CHANGED',
        'LOGOUT',
      ])
        expect(actions, a).toContain(a);
      const actorRow = rows.find((r) => r.action === 'PIN_CHANGED');
      expect(actorRow).toMatchObject({ actorUserId: id, actorLabel: `user:${id}` });
      expect(actorRow?.requestId).toBeTruthy();
      expect(actorRow?.ipAddress).toBeTruthy();
      const text = JSON.stringify(rows);
      for (const secret of [
        PIN,
        '739182',
        '000000',
        'hrd-install-0000000001',
        s.refreshToken,
        s.accessToken,
      ])
        expect(text).not.toContain(secret);
    });
  });

  describe('Redis-backed rate limiting', () => {
    it('uses Redis for route throttling and identifier limits, with no raw PII in keys', async () => {
      const p = phone();
      await login('A', p, '000000');
      const keys = await app.get(RedisService).client.keys('*');
      expect(keys.some((k) => k.startsWith('throttle:'))).toBe(true);
      expect(keys.some((k) => k.startsWith('auth:ident:'))).toBe(true);
      const nonOutbox = keys.filter((k) => !k.startsWith('dev:otp-outbox:')).join('\n');
      expect(nonOutbox).not.toContain(p);
      expect(nonOutbox).not.toContain(p.slice(3));
      expect(nonOutbox).not.toMatch(/@|10\.\d+\.\d+\.\d+/);
    });

    it('falls back to per-instance limits (never unlimited) when Redis is unavailable', async () => {
      const outage = await createTestApp({ overrides: { REDIS_URL: 'redis://127.0.0.1:1/0' } });
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 13; i += 1) {
          const res = await call(outage, { host: t.A.domain, clientIp: '10.55.55.55' })
            .post('/api/v1/auth/login')
            .send({ identifier: `nobody-${String(i)}@hrd-a.test`, secret: 'x-1234567' });
          statuses.push(res.status);
        }
        expect(statuses).toContain(429); // per-IP login limit still enforced
        let identifierLimited = false;
        for (let i = 0; i < 12; i += 1) {
          const res = await call(outage, { host: t.A.domain })
            .post('/api/v1/auth/login')
            .send({ identifier: 'same-ghost@hrd-a.test', secret: 'x-1234567' });
          if (res.status === 429) identifierLimited = true;
        }
        expect(identifierLimited).toBe(true);
        const health = await call(outage).get('/api/v1/health').expect(503);
        expect(health.body.checks.redis).toBe('down');
      } finally {
        await outage.close();
      }
    }, 60_000);
  });
});
