import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AuthResult, AuthTokens, MeResponse, TenantUserSummary } from '@acadlyx/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlatformPrismaService } from '../src/database/platform-prisma.service.js';
import { createTestApp } from './helpers/app.js';
import {
  call,
  createPlatformUser,
  createTenantUser,
  platformLogin,
  purgePlatformUsers,
  resetRateLimits,
  syncRbac,
  tenantLogin,
  type TotpClock,
} from './helpers/auth.js';
import {
  createFixtureTenants,
  type FixtureLetter,
  type FixtureTenant,
  purgeTenants,
} from './helpers/tenant-fixtures.js';

const PREFIX = 'PAU';
const ADMIN = 'pau-admin@acadlyx.test';
const ADMIN_PW = 'Pau-admin-pass-2026';

describe('Platform Admin authentication and tenant-user administration (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PlatformPrismaService;
  let t: Record<FixtureLetter, FixtureTenant>;
  let admin: { tokens: AuthTokens; totp: TotpClock; recoveryCodes: string[] };

  const P = (token?: string) => call(app, token ? { token } : {});
  const users = (tenantId: string) => `/api/v1/platform/tenants/${tenantId}/users`;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PlatformPrismaService);
    await resetRateLimits(app);
    await syncRbac(app);
    t = await createFixtureTenants(prisma, PREFIX);
    await purgePlatformUsers(app, 'pau-');
    await createPlatformUser(app, { email: ADMIN, password: ADMIN_PW });
    const signed = await platformLogin(app, ADMIN, ADMIN_PW);
    if (!signed.totp || !signed.recoveryCodes) throw new Error('expected enrollment');
    admin = { tokens: signed.tokens, totp: signed.totp, recoveryCodes: signed.recoveryCodes };
  });

  afterAll(async () => {
    await purgeTenants(prisma, PREFIX);
    await purgePlatformUsers(app, 'pau-');
    await app.close();
  });

  describe('platform authentication', () => {
    it('always requires TOTP MFA; wrong password and wrong TOTP are generic failures', async () => {
      const step = (
        await P()
          .post('/api/v1/platform/auth/login')
          .send({ email: ADMIN, password: ADMIN_PW })
          .expect(200)
      ).body as AuthResult;
      expect(step.status).toBe('MFA_REQUIRED');
      if (step.status === 'AUTHENTICATED') return;
      await P()
        .post('/api/v1/platform/auth/mfa/verify')
        .send({ mfaToken: step.mfaToken, code: '000000' })
        .expect(401);
      const ok = (
        await P()
          .post('/api/v1/platform/auth/mfa/verify')
          .send({ mfaToken: step.mfaToken, code: await admin.totp.next() })
          .expect(200)
      ).body as AuthTokens;
      const me = (await P(ok.accessToken).get('/api/v1/platform/auth/me').expect(200))
        .body as MeResponse;
      expect(me).toMatchObject({
        scope: 'PLATFORM',
        roles: ['PLATFORM_ADMIN'],
        tenant: null,
        mfa: { required: true, enrolled: true },
      });
      const bad = await P()
        .post('/api/v1/platform/auth/login')
        .send({ email: ADMIN, password: 'wrong-password-1' })
        .expect(401);
      const unknown = await P()
        .post('/api/v1/platform/auth/login')
        .send({ email: 'nobody@acadlyx.test', password: 'wrong-password-1' })
        .expect(401);
      expect(bad.body.code).toBe(unknown.body.code);
      expect(
        await prisma.platformAuditLog.count({
          where: {
            action: 'PLATFORM_LOGIN',
            metadata: { path: ['subjectPlatformUserId'], equals: me.id },
          },
        }),
      ).toBeGreaterThanOrEqual(2);
    }, 45_000 /* may wait for the next TOTP step (shared clock) */);

    it('locks platform accounts after 5 failures for 30 minutes', async () => {
      await createPlatformUser(app, {
        email: 'pau-lock@acadlyx.test',
        password: 'Pau-lock-pass-2026',
      });
      for (let i = 0; i < 5; i += 1) {
        await P()
          .post('/api/v1/platform/auth/login')
          .send({ email: 'pau-lock@acadlyx.test', password: `bad-password-${String(i)}` })
          .expect(401);
      }
      const row = await prisma.platformUser.findUniqueOrThrow({
        where: { email: 'pau-lock@acadlyx.test' },
      });
      expect(row.lockedUntil?.getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);
      await P()
        .post('/api/v1/platform/auth/login')
        .send({ email: 'pau-lock@acadlyx.test', password: 'Pau-lock-pass-2026' })
        .expect(401);
    });

    it('suspended and disabled platform users cannot sign in; suspension kills sessions', async () => {
      const id = await createPlatformUser(app, {
        email: 'pau-susp@acadlyx.test',
        password: 'Pau-susp-pass-2026',
      });
      const s = await platformLogin(app, 'pau-susp@acadlyx.test', 'Pau-susp-pass-2026');
      await prisma.platformUser.update({ where: { id }, data: { status: 'SUSPENDED' } });
      await resetRateLimits(app); // clear ≤30 s session cache; status is re-read from PostgreSQL
      await P(s.tokens.accessToken).get('/api/v1/platform/auth/me').expect(401);
      await P()
        .post('/api/v1/platform/auth/refresh')
        .send({ refreshToken: s.tokens.refreshToken })
        .expect(401);
      await P()
        .post('/api/v1/platform/auth/login')
        .send({ email: 'pau-susp@acadlyx.test', password: 'Pau-susp-pass-2026' })
        .expect(401);
      await prisma.platformUser.update({ where: { id }, data: { status: 'DISABLED' } });
      await P()
        .post('/api/v1/platform/auth/login')
        .send({ email: 'pau-susp@acadlyx.test', password: 'Pau-susp-pass-2026' })
        .expect(401);
    });

    it('rotates platform sessions, detects reuse and supports logout / revocation', async () => {
      // Fresh admin: TOTP time-steps are single use, so extra logins in the same 30 s window use
      // one-time recovery codes (exercising that path too).
      await createPlatformUser(app, {
        email: 'pau-rot@acadlyx.test',
        password: 'Pau-rot-pass-2026',
      });
      const first = await platformLogin(app, 'pau-rot@acadlyx.test', 'Pau-rot-pass-2026');
      const codes = [...(first.recoveryCodes ?? [])];
      const loginWithRecovery = async () => {
        const step = (
          await P()
            .post('/api/v1/platform/auth/login')
            .send({ email: 'pau-rot@acadlyx.test', password: 'Pau-rot-pass-2026' })
            .expect(200)
        ).body as { mfaToken: string };
        return (
          await P()
            .post('/api/v1/platform/auth/mfa/verify')
            .send({ mfaToken: step.mfaToken, recoveryCode: codes.shift() })
            .expect(200)
        ).body as AuthTokens;
      };
      const s = first.tokens;
      const next = (
        await P()
          .post('/api/v1/platform/auth/refresh')
          .send({ refreshToken: s.refreshToken })
          .expect(200)
      ).body as AuthTokens;
      await P()
        .post('/api/v1/platform/auth/refresh')
        .send({ refreshToken: s.refreshToken })
        .expect(401);
      await P(next.accessToken).get('/api/v1/platform/auth/me').expect(401); // family revoked on reuse
      const a = await loginWithRecovery();
      const b = await loginWithRecovery();
      await P(a.accessToken).delete(`/api/v1/platform/auth/sessions/${b.sessionId}`).expect(204);
      await P(b.accessToken).get('/api/v1/platform/auth/me').expect(401);
      await P(a.accessToken).post('/api/v1/platform/auth/logout').expect(204);
      await P(a.accessToken).get('/api/v1/platform/auth/me').expect(401);
    });

    it('a platform user without the permission is denied (403 PERMISSION_DENIED)', async () => {
      await createPlatformUser(app, {
        email: 'pau-norole@acadlyx.test',
        password: 'Pau-norole-pass-26',
        roles: [],
      });
      const s = await platformLogin(app, 'pau-norole@acadlyx.test', 'Pau-norole-pass-26').catch(
        () => null,
      );
      // No roles → no MFA requirement from roles; platform scope still issues a session.
      expect(s).not.toBeNull();
      const res = await P(s?.tokens.accessToken).get('/api/v1/platform/tenants').expect(403);
      expect(res.body.code).toBe('PERMISSION_DENIED');
    });

    it('tenant identities cannot use platform authentication', async () => {
      await createTenantUser(app, {
        tenantId: t.A.id,
        roles: ['SCHOOL_ADMIN'],
        email: 'pau-school@pau-a.test',
        secret: 'School-admin-pass-1',
      });
      await P()
        .post('/api/v1/platform/auth/login')
        .send({ email: 'pau-school@pau-a.test', password: 'School-admin-pass-1' })
        .expect(401);
    });
  });

  describe('tenant user administration', () => {
    let principalId: string;
    const T = () => admin.tokens.accessToken;

    it('creates identities with only the identifiers their roles need', async () => {
      const principal = (
        await P(T())
          .post(users(t.A.id))
          .send({ displayName: 'Asha', email: 'Asha@PAU-A.test', roles: ['PRINCIPAL'] })
          .expect(201)
      ).body as TenantUserSummary;
      principalId = principal.id;
      expect(principal).toMatchObject({
        status: 'PENDING_ACTIVATION',
        email: 'asha@pau-a.test',
        roles: ['PRINCIPAL'],
      });
      const parent = (
        await P(T())
          .post(users(t.A.id))
          .send({ displayName: 'Pooja', phone: '98110 00001', roles: ['PARENT'] })
          .expect(201)
      ).body as TenantUserSummary;
      expect(parent.phone).toBe('+919811000001');
      await P(T())
        .post(users(t.A.id))
        .send({ displayName: 'Student', roles: ['STUDENT'] })
        .expect(400); // needs student ID
      await P(T())
        .post(users(t.A.id))
        .send({
          displayName: 'Stu',
          loginId: 'PAU-STU-1',
          loginIdKind: 'STUDENT_ID',
          roles: ['STUDENT'],
        })
        .expect(201);
      await P(T())
        .post(users(t.A.id))
        .send({
          displayName: 'Teach',
          loginId: 'PAU-T-1',
          loginIdKind: 'EMPLOYEE_ID',
          roles: ['TEACHER'],
        })
        .expect(201);
      const multi = (
        await P(T())
          .post(users(t.A.id))
          .send({
            displayName: 'Neha',
            email: 'neha@pau-a.test',
            phone: '9811000002',
            roles: ['TEACHER', 'PARENT'],
          })
          .expect(201)
      ).body as TenantUserSummary;
      expect(multi.roles).toEqual(['PARENT', 'TEACHER']);
      // Unknown fields (e.g. a password or tenantId) are rejected outright.
      await P(T())
        .post(users(t.A.id))
        .send({
          displayName: 'X',
          email: 'x@pau-a.test',
          roles: ['TEACHER'],
          password: 'Password@123',
        })
        .expect(400);
    });

    it('rejects duplicates in the same school but allows the same email/mobile in another school', async () => {
      const dup = await P(T())
        .post(users(t.A.id))
        .send({ displayName: 'Dup', email: 'asha@pau-a.test', roles: ['TEACHER'] })
        .expect(409);
      expect(dup.body.code).toBe('IDENTIFIER_TAKEN');
      await P(T())
        .post(users(t.A.id))
        .send({ displayName: 'Dup', phone: '+919811000001', roles: ['PARENT'] })
        .expect(409);
      await P(T())
        .post(users(t.B.id))
        .send({ displayName: 'Asha B', email: 'asha@pau-a.test', roles: ['PRINCIPAL'] })
        .expect(201);
      await P(T())
        .post(users(t.B.id))
        .send({ displayName: 'Pooja B', phone: '+919811000001', roles: ['PARENT'] })
        .expect(201);
    });

    it('rejects custom and platform roles', async () => {
      for (const roles of [['LIBRARIAN'], ['PLATFORM_ADMIN'], ['TEACHER', 'PLATFORM_ADMIN']]) {
        await P(T())
          .post(users(t.A.id))
          .send({ displayName: 'R', email: `r${roles.length}@pau-a.test`, roles })
          .expect(400);
      }
      await P(T())
        .post(`${users(t.A.id)}/${principalId}/roles`)
        .send({ roleKey: 'PLATFORM_ADMIN' })
        .expect(400);
      await P(T())
        .post(`${users(t.A.id)}/${principalId}/roles`)
        .send({ roleKey: 'SUPERUSER' })
        .expect(400);
      // Database-level guarantee too: a PLATFORM role row cannot be linked to a tenant user.
      const platformRole = await prisma.role.findUniqueOrThrow({
        where: { key: 'PLATFORM_ADMIN' },
      });
      await expect(
        prisma.userRole.create({
          data: {
            tenantId: t.A.id,
            userId: principalId,
            roleId: platformRole.id,
            roleScope: 'PLATFORM',
          },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.userRole.create({
          data: {
            tenantId: t.A.id,
            userId: principalId,
            roleId: platformRole.id,
            roleScope: 'TENANT',
          },
        }),
      ).rejects.toThrow(); // (role_id, role_scope) FK: PLATFORM_ADMIN has no TENANT variant
    });

    it('lists with search and filters, and gets a single identity', async () => {
      const all = await P(T())
        .get(`${users(t.A.id)}?pageSize=50`)
        .expect(200);
      expect(all.body.total).toBeGreaterThanOrEqual(5);
      const byRole = await P(T())
        .get(`${users(t.A.id)}?role=PARENT`)
        .expect(200);
      expect(
        (byRole.body.items as TenantUserSummary[]).every((u) => u.roles.includes('PARENT')),
      ).toBe(true);
      const bySearch = await P(T())
        .get(`${users(t.A.id)}?search=neha`)
        .expect(200);
      expect(bySearch.body.items).toHaveLength(1);
      const byStatus = await P(T())
        .get(`${users(t.A.id)}?status=PENDING_ACTIVATION&pageSize=100`)
        .expect(200);
      expect(byStatus.body.total).toBeGreaterThanOrEqual(5);
      expect(
        (byStatus.body.items as TenantUserSummary[]).every(
          (u) => u.status === 'PENDING_ACTIVATION',
        ),
      ).toBe(true);
      await P(T())
        .get(`${users(t.A.id)}/${principalId}`)
        .expect(200);
      const text = JSON.stringify(all.body);
      for (const forbidden of ['credentialHash', 'secretEncrypted', 'codeHmac', 'argon2'])
        expect(text).not.toContain(forbidden);
    });

    it('cannot reach a school B identity through a school A route', async () => {
      const bUser = await createTenantUser(app, {
        tenantId: t.B.id,
        roles: ['TEACHER'],
        email: 'victim@pau-b.test',
        secret: 'Victim-pass-2026',
      });
      await P(T())
        .get(`${users(t.A.id)}/${bUser}`)
        .expect(404);
      await P(T())
        .patch(`${users(t.A.id)}/${bUser}`)
        .send({ displayName: 'Hijacked' })
        .expect(404);
      await P(T())
        .post(`${users(t.A.id)}/${bUser}/roles`)
        .send({ roleKey: 'PRINCIPAL' })
        .expect(404);
      await P(T())
        .post(`${users(t.A.id)}/${bUser}/suspend`)
        .expect(404);
      await P(T())
        .post(`${users(t.A.id)}/${bUser}/reset-activation`)
        .expect(404);
      const victim = await prisma.user.findUniqueOrThrow({
        where: { id: bUser },
        include: { roles: true },
      });
      expect(victim).toMatchObject({ displayName: 'Test User', status: 'ACTIVE' });
      expect(victim.roles).toHaveLength(1);
      // DB-level: a role link can never point at a user of another tenant (composite FK).
      const role = await prisma.role.findUniqueOrThrow({ where: { key: 'PRINCIPAL' } });
      await expect(
        prisma.userRole.create({
          data: { tenantId: t.A.id, userId: bUser, roleId: role.id, roleScope: 'TENANT' },
        }),
      ).rejects.toThrow();
    });

    it('assigns/removes roles with immediate effect and revokes sessions on assignment', async () => {
      const id = await createTenantUser(app, {
        tenantId: t.A.id,
        roles: ['TEACHER'],
        email: 'roles@pau-a.test',
        secret: 'Roles-pass-2026',
      });
      const s = (await tenantLogin(app, t.A.domain, 'roles@pau-a.test', 'Roles-pass-2026')).tokens;
      await call(app, { host: t.A.domain, token: s.accessToken })
        .get('/api/v1/tenant/settings')
        .expect(403);
      await P(T())
        .post(`${users(t.A.id)}/${id}/roles`)
        .send({ roleKey: 'TEACHER' })
        .expect(409);
      await P(T())
        .post(`${users(t.A.id)}/${id}/roles`)
        .send({ roleKey: 'PARENT' })
        .expect(201);
      await call(app, { host: t.A.domain, token: s.accessToken })
        .get('/api/v1/auth/me')
        .expect(401); // re-login applies new policy
      const s2 = (await tenantLogin(app, t.A.domain, 'roles@pau-a.test', 'Roles-pass-2026')).tokens;
      expect(
        (
          (await call(app, { host: t.A.domain, token: s2.accessToken }).get('/api/v1/auth/me'))
            .body as MeResponse
        ).roles,
      ).toEqual(['PARENT', 'TEACHER']);
      const removed = (
        await P(T())
          .delete(`${users(t.A.id)}/${id}/roles/PARENT`)
          .expect(200)
      ).body as TenantUserSummary;
      expect(removed.roles).toEqual(['TEACHER']);
      // Permission cache invalidated → same session sees the reduced role set immediately.
      expect(
        (
          (await call(app, { host: t.A.domain, token: s2.accessToken }).get('/api/v1/auth/me'))
            .body as MeResponse
        ).roles,
      ).toEqual(['TEACHER']);
      await P(T())
        .delete(`${users(t.A.id)}/${id}/roles/TEACHER`)
        .expect(409); // last role
      expect(
        await prisma.platformAuditLog.count({ where: { action: 'ROLE_REMOVED', resourceId: id } }),
      ).toBe(1);
      const assigned = await prisma.platformAuditLog.findFirstOrThrow({
        where: { action: 'ROLE_ASSIGNED', resourceId: id },
      });
      expect(assigned.actorPlatformUserId).not.toBeNull(); // real authenticated actor
    });

    it('suspend → reactivate → disable, and reset activation (no default credentials)', async () => {
      const id = await createTenantUser(app, {
        tenantId: t.A.id,
        roles: ['TEACHER'],
        email: 'life@pau-a.test',
        secret: 'Life-pass-2026',
      });
      const s = (await tenantLogin(app, t.A.domain, 'life@pau-a.test', 'Life-pass-2026')).tokens;
      await P(T())
        .post(`${users(t.A.id)}/${id}/suspend`)
        .expect(200);
      await call(app, { host: t.A.domain, token: s.accessToken })
        .get('/api/v1/auth/me')
        .expect(401);
      await call(app, { host: t.A.domain })
        .post('/api/v1/auth/login')
        .send({ identifier: 'life@pau-a.test', secret: 'Life-pass-2026' })
        .expect(401);
      await P(T())
        .post(`${users(t.A.id)}/${id}/suspend`)
        .expect(409);
      await P(T())
        .post(`${users(t.A.id)}/${id}/reactivate`)
        .expect(200);
      await tenantLogin(app, t.A.domain, 'life@pau-a.test', 'Life-pass-2026');
      const reset = (
        await P(T())
          .post(`${users(t.A.id)}/${id}/reset-activation`)
          .expect(200)
      ).body as TenantUserSummary;
      expect(reset.status).toBe('PENDING_ACTIVATION');
      const row = await prisma.user.findUniqueOrThrow({ where: { id } });
      expect(row.credentialHash).toBeNull();
      await call(app, { host: t.A.domain })
        .post('/api/v1/auth/login')
        .send({ identifier: 'life@pau-a.test', secret: 'Life-pass-2026' })
        .expect(401);
      await P(T())
        .post(`${users(t.A.id)}/${id}/disable`)
        .expect(200);
      await P(T())
        .post(`${users(t.A.id)}/${id}/reactivate`)
        .expect(409);
    });

    it('issues one-time activation codes only for channel-less pending accounts', async () => {
      const stu = (
        await P(T())
          .post(users(t.A.id))
          .send({
            displayName: 'Code Stu',
            loginId: 'PAU-STU-2',
            loginIdKind: 'STUDENT_ID',
            roles: ['STUDENT'],
          })
          .expect(201)
      ).body as TenantUserSummary;
      const code = await P(T())
        .post(`${users(t.A.id)}/${stu.id}/activation-code`)
        .expect(200);
      expect(code.body.activationCode).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
      await P(T())
        .post(`${users(t.A.id)}/${principalId}/activation-code`)
        .expect(409); // has email → OTP flow
    });

    it('tenant identities cannot call the administration APIs', async () => {
      await createTenantUser(app, {
        tenantId: t.A.id,
        roles: ['TEACHER'],
        email: 'nosy@pau-a.test',
        secret: 'Nosy-pass-2026',
      });
      const s = (await tenantLogin(app, t.A.domain, 'nosy@pau-a.test', 'Nosy-pass-2026')).tokens;
      const res = await P(s.accessToken)
        .post(users(t.A.id))
        .send({ displayName: 'X', email: 'x2@pau-a.test', roles: ['PRINCIPAL'] })
        .expect(403);
      expect(res.body.code).toBe('SCOPE_MISMATCH');
      await P().get(users(t.A.id)).expect(401);
    });
  });
});
