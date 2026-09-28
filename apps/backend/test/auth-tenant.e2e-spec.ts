import { permissionsForRoles } from '@acadlyx/permissions';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AuthResult, AuthTokens, MeResponse, SessionInfo } from '@acadlyx/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlatformPrismaService } from '../src/database/platform-prisma.service.js';
import { createTestApp } from './helpers/app.js';
import {
  call,
  createTenantUser,
  installationId,
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

const PREFIX = 'AUTH';
const PW = 'Teacher-pass-2026';
const PIN = '482913';

describe('Tenant authentication (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PlatformPrismaService;
  let t: Record<FixtureLetter, FixtureTenant>;
  const ids: Record<string, string> = {};

  const host = (letter: FixtureLetter) => t[letter].domain;
  const api = (letter: FixtureLetter, token?: string) =>
    call(app, { host: host(letter), ...(token ? { token } : {}) });

  // Tests that are not about rate limiting use their own identity each: the per-identifier
  // limiter (10 attempts / 15 min) is real production behaviour and must not couple tests.
  let teacherSeq = 0;
  const freshTeacher = async () => {
    teacherSeq += 1;
    const email = `teacher-${String(teacherSeq)}@auth-a.test`;
    await createTenantUser(app, { tenantId: t.A.id, roles: ['TEACHER'], email, secret: PW });
    return (await tenantLogin(app, host('A'), email, PW)).tokens;
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PlatformPrismaService);
    await resetRateLimits(app);
    await syncRbac(app);
    t = await createFixtureTenants(prisma, PREFIX);
    ids.parent = await createTenantUser(app, {
      tenantId: t.A.id,
      roles: ['PARENT'],
      phone: '+919811111111',
      credentialType: 'PIN',
      secret: PIN,
    });
    ids.student = await createTenantUser(app, {
      tenantId: t.A.id,
      roles: ['STUDENT'],
      loginId: 'STU001',
      loginIdKind: 'STUDENT_ID',
      credentialType: 'PIN',
      secret: PIN,
    });
    ids.teacher = await createTenantUser(app, {
      tenantId: t.A.id,
      roles: ['TEACHER'],
      email: 'teacher@auth-a.test',
      loginId: 'TCH001',
      loginIdKind: 'EMPLOYEE_ID',
      secret: PW,
    });
    ids.multi = await createTenantUser(app, {
      tenantId: t.A.id,
      roles: ['TEACHER', 'PARENT'],
      email: 'neha@auth-a.test',
      phone: '+919822222222',
      secret: PW,
    });
    ids.principal = await createTenantUser(app, {
      tenantId: t.A.id,
      roles: ['PRINCIPAL'],
      email: 'principal@auth-a.test',
      secret: 'Principal-pass-2026',
    });
    ids.accountant = await createTenantUser(app, {
      tenantId: t.A.id,
      roles: ['ACCOUNTANT'],
      email: 'accounts@auth-a.test',
      secret: 'Accounts-pass-2026',
    });
    // Same identifiers in another school are independent accounts (approved policy).
    ids.teacherB = await createTenantUser(app, {
      tenantId: t.B.id,
      roles: ['TEACHER'],
      email: 'teacher@auth-a.test',
      loginId: 'TCH001',
      loginIdKind: 'EMPLOYEE_ID',
      secret: 'Other-school-pass',
    });
  });

  afterAll(async () => {
    await purgeTenants(prisma, PREFIX);
    await app.close();
  });

  describe('login by role', () => {
    it('parent: mobile + 6-digit PIN (any common mobile format)', async () => {
      const { tokens } = await tenantLogin(app, host('A'), '98111 11111', PIN);
      expect(tokens.status).toBe('AUTHENTICATED');
      const me = (await api('A', tokens.accessToken).get('/api/v1/auth/me').expect(200))
        .body as MeResponse;
      expect(me).toMatchObject({
        id: ids.parent,
        scope: 'TENANT',
        roles: ['PARENT'],
        credentialType: 'PIN',
        pinAllowed: true,
        tenant: { key: t.A.key },
      });
      expect(me.mfa.required).toBe(false);
    });

    it('student: admission ID + PIN (no phone/email needed)', async () => {
      const { tokens } = await tenantLogin(app, host('A'), 'STU001', PIN);
      const me = (await api('A', tokens.accessToken).get('/api/v1/auth/me').expect(200))
        .body as MeResponse;
      expect(me).toMatchObject({
        id: ids.student,
        roles: ['STUDENT'],
        identifiers: { loginId: 'STU001', email: null, phone: null },
      });
    });

    it('teacher: employee ID or email + password, without MFA', async () => {
      for (const identifier of ['TCH001', 'Teacher@Auth-A.test']) {
        const { tokens } = await tenantLogin(app, host('A'), identifier, PW);
        const me = (await api('A', tokens.accessToken).get('/api/v1/auth/me').expect(200))
          .body as MeResponse;
        expect(me.id).toBe(ids.teacher);
      }
    });

    it('same identifier in school B logs into school B only', async () => {
      const { tokens } = await tenantLogin(app, host('B'), 'TCH001', 'Other-school-pass');
      const me = (await api('B', tokens.accessToken).get('/api/v1/auth/me').expect(200))
        .body as MeResponse;
      expect(me.id).toBe(ids.teacherB);
      await api('A')
        .post('/api/v1/auth/login')
        .send({ identifier: 'TCH001', secret: 'Other-school-pass' })
        .expect(401);
    });

    it('multi-role user: one identity, union of permissions, most restrictive session policy', async () => {
      const { tokens } = await tenantLogin(app, host('A'), 'neha@auth-a.test', PW);
      const me = (await api('A', tokens.accessToken).get('/api/v1/auth/me').expect(200))
        .body as MeResponse;
      expect(me.roles).toEqual(['PARENT', 'TEACHER']);
      // Union of both roles' permissions, resolved server-side from the registry (Phase 4 adds
      // teachers' read-only academic structure); PARENT adds nothing beyond the workspace.
      expect(me.permissions).toEqual(permissionsForRoles(['TEACHER', 'PARENT']));
      expect(me.permissions).toEqual(permissionsForRoles(['TEACHER']));
      // Phase 7: a teacher's only manage permissions are the resource-scoped class operations.
      expect(me.permissions.filter((p) => p.endsWith('.manage')).sort()).toEqual([
        'assignment.manage',
        'attendance.manage',
        'homework.manage',
      ]);
      expect(me.pinAllowed).toBe(false); // TEACHER forbids PIN → most restrictive wins
      const session = await prisma.session.findUniqueOrThrow({ where: { id: tokens.sessionId } });
      const days = (session.absoluteExpiresAt.getTime() - session.createdAt.getTime()) / 86_400_000;
      expect(Math.round(days)).toBe(30); // TEACHER (30 d) not PARENT (90 d)
    });
  });

  describe('privileged roles require MFA', () => {
    let principalTotp: TotpClock;
    let recovery: string[];

    it('first login forces TOTP enrollment before any tokens are issued', async () => {
      const res = await api('A')
        .post('/api/v1/auth/login')
        .send({ identifier: 'principal@auth-a.test', secret: 'Principal-pass-2026' })
        .expect(200);
      const step = res.body as AuthResult;
      expect(step.status).toBe('MFA_ENROLLMENT_REQUIRED');
      expect(step).not.toHaveProperty('accessToken');
      // The pending session cannot be used as a normal session.
      const pending = await prisma.session.findFirstOrThrow({
        where: { userId: ids.principal, mfaPending: true },
      });
      expect(await prisma.refreshToken.count({ where: { sessionId: pending.id } })).toBe(0);
      if (step.status === 'AUTHENTICATED') throw new Error('unexpected');
      const start = await api('A')
        .post('/api/v1/auth/mfa/enroll/start')
        .send({ mfaToken: step.mfaToken })
        .expect(200);
      const secret = (start.body as { secret: string }).secret;
      principalTotp = new TotpClock(secret);
      // MFA is not active until confirmed with a valid code.
      const method = await prisma.mfaMethod.findFirstOrThrow({ where: { userId: ids.principal } });
      expect(method.verifiedAt).toBeNull();
      expect(method.secretEncrypted).not.toContain(secret);
      await api('A')
        .post('/api/v1/auth/mfa/enroll/confirm')
        .send({ mfaToken: step.mfaToken, code: '000000' })
        .expect(401);
      const done = await api('A')
        .post('/api/v1/auth/mfa/enroll/confirm')
        .send({ mfaToken: step.mfaToken, code: await principalTotp.next() })
        .expect(200);
      recovery = (done.body as { recoveryCodes: string[] }).recoveryCodes;
      expect(recovery).toHaveLength(10);
      expect((done.body as { auth: AuthTokens }).auth.status).toBe('AUTHENTICATED');
      const stored = await prisma.mfaRecoveryCode.findMany({ where: { userId: ids.principal } });
      expect(stored.map((c) => c.codeHmac).join()).not.toContain(
        recovery[0]?.replace('-', '') ?? 'x',
      );
    });

    it('later logins require a valid, non-replayed TOTP code', async () => {
      const first = await api('A')
        .post('/api/v1/auth/login')
        .send({ identifier: 'principal@auth-a.test', secret: 'Principal-pass-2026' })
        .expect(200);
      const step = first.body as { status: string; mfaToken: string };
      expect(step.status).toBe('MFA_REQUIRED');
      await api('A')
        .post('/api/v1/auth/mfa/verify')
        .send({ mfaToken: step.mfaToken, code: '123456' })
        .expect(401);
      const code = await principalTotp.next();
      await api('A')
        .post('/api/v1/auth/mfa/verify')
        .send({ mfaToken: step.mfaToken, code })
        .expect(200);
      // Replay of the same code on a new login is rejected.
      const again = (
        await api('A')
          .post('/api/v1/auth/login')
          .send({ identifier: 'principal@auth-a.test', secret: 'Principal-pass-2026' })
          .expect(200)
      ).body as { mfaToken: string };
      const replay = await api('A')
        .post('/api/v1/auth/mfa/verify')
        .send({ mfaToken: again.mfaToken, code })
        .expect(401);
      expect(replay.body.code, JSON.stringify(replay.body)).toBe('INVALID_MFA');
    }, 45_000 /* may wait for the next TOTP step (shared clock) */);

    it('recovery codes work exactly once', async () => {
      const code = recovery[0] ?? '';
      const a = (
        await api('A')
          .post('/api/v1/auth/login')
          .send({ identifier: 'principal@auth-a.test', secret: 'Principal-pass-2026' })
          .expect(200)
      ).body as { mfaToken: string };
      await api('A')
        .post('/api/v1/auth/mfa/verify')
        .send({ mfaToken: a.mfaToken, recoveryCode: code.toLowerCase() })
        .expect(200);
      const b = (
        await api('A')
          .post('/api/v1/auth/login')
          .send({ identifier: 'principal@auth-a.test', secret: 'Principal-pass-2026' })
          .expect(200)
      ).body as { mfaToken: string };
      await api('A')
        .post('/api/v1/auth/mfa/verify')
        .send({ mfaToken: b.mfaToken, recoveryCode: code })
        .expect(401);
    });

    it('five wrong MFA codes kill the pending login', async () => {
      const step = (
        await api('A')
          .post('/api/v1/auth/login')
          .send({ identifier: 'principal@auth-a.test', secret: 'Principal-pass-2026' })
          .expect(200)
      ).body as { mfaToken: string };
      for (let i = 0; i < 5; i += 1) {
        await api('A')
          .post('/api/v1/auth/mfa/verify')
          .send({ mfaToken: step.mfaToken, code: '000001' })
          .expect(401);
      }
      await api('A')
        .post('/api/v1/auth/mfa/verify')
        .send({ mfaToken: step.mfaToken, code: await principalTotp.next() })
        .expect(401);
    }, 45_000 /* may wait for the next TOTP step (shared clock) */);

    it('privileged users cannot remove mandatory MFA', async () => {
      const { tokens } = await tenantLogin(
        app,
        host('A'),
        'accounts@auth-a.test',
        'Accounts-pass-2026',
      );
      const res = await api('A', tokens.accessToken)
        .post('/api/v1/auth/mfa/totp/remove')
        .send({ currentSecret: 'Accounts-pass-2026', code: '123456' })
        .expect(409);
      expect(res.body.code).toBe('MFA_REQUIRED_FOR_ROLE');
    });
  });

  describe('credentials, enumeration and lockout', () => {
    it('unknown account and wrong secret produce the identical public error', async () => {
      const unknown = await api('A')
        .post('/api/v1/auth/login')
        .send({ identifier: 'nobody@auth-a.test', secret: 'whatever-123' })
        .expect(401);
      const wrong = await api('A')
        .post('/api/v1/auth/login')
        .send({ identifier: 'TCH001', secret: 'wrong-password' })
        .expect(401);
      const strip = (b: Record<string, unknown>) => ({ ...b, requestId: null, timestamp: null });
      expect(strip(unknown.body as Record<string, unknown>)).toEqual(
        strip(wrong.body as Record<string, unknown>),
      );
      expect(unknown.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('PIN accounts lock after 5 failures; the correct PIN is then rejected the same way', async () => {
      const id = await createTenantUser(app, {
        tenantId: t.A.id,
        roles: ['PARENT'],
        phone: '+919833333333',
        credentialType: 'PIN',
        secret: PIN,
      });
      for (let i = 0; i < 5; i += 1) {
        await api('A')
          .post('/api/v1/auth/login')
          .send({ identifier: '+919833333333', secret: '000000' })
          .expect(401);
      }
      const locked = await prisma.user.findUniqueOrThrow({ where: { id } });
      expect(locked.lockedUntil?.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
      expect(locked.status).toBe('ACTIVE'); // lockout is not an account status
      const res = await api('A')
        .post('/api/v1/auth/login')
        .send({ identifier: '+919833333333', secret: PIN })
        .expect(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
      expect(
        await prisma.auditLog.count({
          where: {
            tenantId: t.A.id,
            action: 'ACCOUNT_LOCKED',
            metadata: { path: ['subjectUserId'], equals: id },
          },
        }),
      ).toBe(1);
      // Temporary: once locked_until passes, login works again without admin action.
      await prisma.user.update({
        where: { id },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });
      await tenantLogin(app, host('A'), '+919833333333', PIN);
    });

    it('password accounts lock after 10 failures', async () => {
      const id = await createTenantUser(app, {
        tenantId: t.A.id,
        roles: ['TEACHER'],
        email: 'lockme@auth-a.test',
        secret: PW,
      });
      for (let i = 0; i < 10; i += 1) {
        await api('A')
          .post('/api/v1/auth/login')
          .send({ identifier: 'lockme@auth-a.test', secret: `bad-${String(i)}-pw` })
          .expect(401);
      }
      expect((await prisma.user.findUniqueOrThrow({ where: { id } })).lockedUntil).not.toBeNull();
    });

    it('limits attempts per identifier regardless of account existence or IP (429)', async () => {
      for (let i = 0; i < 10; i += 1) {
        await api('A')
          .post('/api/v1/auth/login')
          .send({ identifier: 'ghost@auth-a.test', secret: 'x-1234567' })
          .expect(401);
      }
      const res = await api('A')
        .post('/api/v1/auth/login')
        .send({ identifier: 'ghost@auth-a.test', secret: 'x-1234567' })
        .expect(429);
      expect(res.body.code).toBe('TOO_MANY_ATTEMPTS');
    });

    it('per-IP throttling applies to login from one address', async () => {
      let limited = false;
      for (let i = 0; i < 12; i += 1) {
        const res = await call(app, { host: host('C'), clientIp: '10.99.99.99' })
          .post('/api/v1/auth/login')
          .send({ identifier: `ip-${String(i)}@auth-c.test`, secret: 'x-1234567' });
        if (res.status === 429) limited = true;
      }
      expect(limited).toBe(true);
    });

    it('rehashes outdated hashes on successful login', async () => {
      const weak = '$argon2id$v=19$m=4096,p=1,t=1$';
      const argon2 = await import('argon2');
      const oldHash = await argon2.default.hash(PW, {
        type: argon2.default.argon2id,
        memoryCost: 4096,
        timeCost: 1,
        parallelism: 1,
      });
      expect(oldHash.startsWith(weak)).toBe(true);
      const id = await createTenantUser(app, {
        tenantId: t.A.id,
        roles: ['TEACHER'],
        email: 'rehash@auth-a.test',
        secret: PW,
      });
      await prisma.user.update({ where: { id }, data: { credentialHash: oldHash } });
      await tenantLogin(app, host('A'), 'rehash@auth-a.test', PW);
      const after = await prisma.user.findUniqueOrThrow({ where: { id } });
      expect(after.credentialHash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    });

    it('change password requires the current one, revokes other sessions', async () => {
      const id = await createTenantUser(app, {
        tenantId: t.A.id,
        roles: ['TEACHER'],
        email: 'changer@auth-a.test',
        secret: PW,
      });
      const s1 = (await tenantLogin(app, host('A'), 'changer@auth-a.test', PW)).tokens;
      const s2 = (await tenantLogin(app, host('A'), 'changer@auth-a.test', PW)).tokens;
      await api('A', s1.accessToken)
        .post('/api/v1/auth/credentials/change')
        .send({
          currentSecret: 'nope-nope-1',
          credentialType: 'PASSWORD',
          newSecret: 'New-pass-2026',
        })
        .expect(401);
      await api('A', s1.accessToken)
        .post('/api/v1/auth/credentials/change')
        .send({ currentSecret: PW, credentialType: 'PIN', newSecret: PIN })
        .expect(400);
      await api('A', s1.accessToken)
        .post('/api/v1/auth/credentials/change')
        .send({ currentSecret: PW, credentialType: 'PASSWORD', newSecret: 'New-pass-2026' })
        .expect(204);
      await api('A', s1.accessToken).get('/api/v1/auth/me').expect(200);
      await api('A', s2.accessToken).get('/api/v1/auth/me').expect(401);
      await api('A')
        .post('/api/v1/auth/login')
        .send({ identifier: 'changer@auth-a.test', secret: PW })
        .expect(401);
      await tenantLogin(app, host('A'), 'changer@auth-a.test', 'New-pass-2026');
      expect(
        await prisma.auditLog.count({ where: { action: 'PASSWORD_CHANGED', actorUserId: id } }),
      ).toBe(1);
    });
  });

  describe('sessions, refresh rotation and devices', () => {
    it('rotates refresh tokens; reusing an old one revokes the whole family', async () => {
      const tokens = await freshTeacher();
      const b = (
        await api('A')
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: tokens.refreshToken })
          .expect(200)
      ).body as AuthTokens;
      expect(b.refreshToken).not.toBe(tokens.refreshToken);
      const c = (
        await api('A')
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: b.refreshToken })
          .expect(200)
      ).body as AuthTokens;
      const reuse = await api('A')
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);
      expect(reuse.body.code).toBe('INVALID_REFRESH_TOKEN');
      await api('A')
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: c.refreshToken })
        .expect(401); // family revoked
      await api('A', c.accessToken).get('/api/v1/auth/me').expect(401); // access immediately dead
      const session = await prisma.session.findUniqueOrThrow({ where: { id: tokens.sessionId } });
      expect(session.revocationReason).toBe('refresh_token_reuse');
      expect(
        await prisma.auditLog.count({
          where: { action: 'REFRESH_TOKEN_REUSE', resourceId: tokens.sessionId },
        }),
      ).toBe(1);
      const stored = await prisma.refreshToken.findMany({ where: { sessionId: tokens.sessionId } });
      expect(stored.map((r) => r.tokenHash)).not.toContain(tokens.refreshToken);
    });

    it('rejects expired, revoked and wrong-school refresh tokens', async () => {
      const expired = await freshTeacher();
      await prisma.session.update({
        where: { id: expired.sessionId },
        data: { idleExpiresAt: new Date(Date.now() - 1000) },
      });
      await api('A')
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: expired.refreshToken })
        .expect(401);

      const absolute = await freshTeacher();
      await prisma.session.update({
        where: { id: absolute.sessionId },
        data: {
          absoluteExpiresAt: new Date(Date.now() - 1000),
          idleExpiresAt: new Date(Date.now() - 2000),
        },
      });
      await api('A')
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: absolute.refreshToken })
        .expect(401);

      const other = await freshTeacher();
      await api('B')
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: other.refreshToken })
        .expect(401);
      await api('A')
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: other.refreshToken })
        .expect(200); // still valid in its school
    });

    it('refresh never extends the absolute session lifetime', async () => {
      const tokens = await freshTeacher();
      const before = await prisma.session.findUniqueOrThrow({ where: { id: tokens.sessionId } });
      const next = (
        await api('A')
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: tokens.refreshToken })
          .expect(200)
      ).body as AuthTokens;
      const after = await prisma.session.findUniqueOrThrow({ where: { id: tokens.sessionId } });
      expect(after.absoluteExpiresAt.getTime()).toBe(before.absoluteExpiresAt.getTime());
      expect(after.idleExpiresAt.getTime()).toBeGreaterThanOrEqual(before.idleExpiresAt.getTime());
      expect(next.sessionExpiresAt).toBe(before.absoluteExpiresAt.toISOString());
    });

    it('logout revokes the session and its refresh ability immediately', async () => {
      const tokens = await freshTeacher();
      await api('A', tokens.accessToken).get('/api/v1/auth/me').expect(200); // warm the session cache
      await api('A', tokens.accessToken).post('/api/v1/auth/logout').expect(204);
      const res = await api('A', tokens.accessToken).get('/api/v1/auth/me').expect(401);
      expect(res.body.code).toBe('SESSION_REVOKED');
      await api('A')
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);
    });

    it('logout-all ends every session; sessions can be listed and revoked individually', async () => {
      const id = await createTenantUser(app, {
        tenantId: t.A.id,
        roles: ['TEACHER'],
        email: 'multi-sess@auth-a.test',
        secret: PW,
      });
      const s1 = (await tenantLogin(app, host('A'), 'multi-sess@auth-a.test', PW)).tokens;
      const s2 = (await tenantLogin(app, host('A'), 'multi-sess@auth-a.test', PW)).tokens;
      const s3 = (await tenantLogin(app, host('A'), 'multi-sess@auth-a.test', PW)).tokens;
      const list = (await api('A', s1.accessToken).get('/api/v1/auth/sessions').expect(200))
        .body as SessionInfo[];
      expect(list).toHaveLength(3);
      expect(list.filter((s) => s.current).map((s) => s.id)).toEqual([s1.sessionId]);
      await api('A', s1.accessToken).delete(`/api/v1/auth/sessions/${s2.sessionId}`).expect(204);
      await api('A', s2.accessToken).get('/api/v1/auth/me').expect(401);
      await api('A', s1.accessToken).post('/api/v1/auth/logout-all').expect(204);
      await api('A', s1.accessToken).get('/api/v1/auth/me').expect(401);
      await api('A', s3.accessToken).get('/api/v1/auth/me').expect(401);
      await api('A')
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: s3.refreshToken })
        .expect(401);
      expect(await prisma.session.count({ where: { userId: id, revokedAt: null } })).toBe(0);
    });

    it('registers devices by installation ID without OTP and audits new devices', async () => {
      const id = await createTenantUser(app, {
        tenantId: t.A.id,
        roles: ['PARENT'],
        phone: '+919844444444',
        credentialType: 'PIN',
        secret: PIN,
      });
      const phone1 = installationId();
      const first = (
        await tenantLogin(app, host('A'), '+919844444444', PIN, { installationId: phone1 })
      ).tokens;
      await tenantLogin(app, host('A'), '+919844444444', PIN, { installationId: phone1 });
      const second = (
        await tenantLogin(app, host('A'), '+919844444444', PIN, {
          installationId: installationId(),
        })
      ).tokens;
      const devices = await prisma.userDevice.findMany({ where: { userId: id } });
      expect(devices).toHaveLength(2);
      expect(devices.map((d) => d.installationHash).join()).not.toContain(phone1);
      expect(
        await prisma.auditLog.count({
          where: {
            action: 'NEW_DEVICE_LOGIN',
            tenantId: t.A.id,
            metadata: { path: ['subjectUserId'], equals: id },
          },
        }),
      ).toBe(2);
      const firstDevice =
        (await prisma.session.findUniqueOrThrow({ where: { id: first.sessionId } })).deviceId ?? '';
      await api('A', second.accessToken).delete(`/api/v1/auth/devices/${firstDevice}`).expect(204);
      await api('A', first.accessToken).get('/api/v1/auth/me').expect(401);
      await api('A')
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);
      await api('A', second.accessToken).get('/api/v1/auth/me').expect(200);
    });

    it("cannot see or revoke another user's sessions or devices", async () => {
      const mine = await freshTeacher();
      const theirs = (
        await tenantLogin(app, host('A'), '+919811111111', PIN, {
          installationId: installationId(),
        })
      ).tokens;
      const theirDevice =
        (await prisma.session.findUniqueOrThrow({ where: { id: theirs.sessionId } })).deviceId ??
        '';
      await api('A', mine.accessToken)
        .delete(`/api/v1/auth/sessions/${theirs.sessionId}`)
        .expect(404);
      await api('A', mine.accessToken).delete(`/api/v1/auth/devices/${theirDevice}`).expect(404);
      await api('A', theirs.accessToken).get('/api/v1/auth/me').expect(200);
    });
  });

  describe('authorization', () => {
    it('grants by permission: principal may read settings, teacher may not', async () => {
      const teacher = await freshTeacher();
      await api('A', teacher.accessToken).get('/api/v1/tenant/workspace').expect(200);
      const denied = await api('A', teacher.accessToken).get('/api/v1/tenant/settings').expect(403);
      expect(denied.body.code).toBe('PERMISSION_DENIED');
      await createTenantUser(app, {
        tenantId: t.A.id,
        roles: ['SCHOOL_ADMIN'],
        email: 'admin2@auth-a.test',
        secret: 'Admin2-pass-2026',
      });
      const admin = await tenantLogin(app, host('A'), 'admin2@auth-a.test', 'Admin2-pass-2026'); // enrolls MFA
      const settings = await api('A', admin.tokens.accessToken)
        .get('/api/v1/tenant/settings')
        .expect(200);
      expect(settings.body).toMatchObject({ enabledFeatures: ['ATTENDANCE'] });
    });

    it('requires authentication on protected tenant routes', async () => {
      const res = await api('A').get('/api/v1/auth/me').expect(401);
      expect(res.body.code).toBe('AUTH_REQUIRED');
      await api('A').get('/api/v1/tenant/workspace').expect(401);
    });

    it('never exposes secrets in /me or responses', async () => {
      const { tokens } = await tenantLogin(app, host('A'), 'STU001', PIN);
      const res = await api('A', tokens.accessToken).get('/api/v1/auth/me').expect(200);
      const text = JSON.stringify(res.body);
      for (const forbidden of [
        'argon2',
        'credentialHash',
        'secretEncrypted',
        'tokenHash',
        'codeHmac',
        PIN,
      ]) {
        expect(text).not.toContain(forbidden);
      }
      expect(res.headers['cache-control']).toContain('no-store');
    });
  });
});
