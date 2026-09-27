import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AuthResult, AuthTokens, OtpGrant } from '@acadlyx/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KeysService } from '../src/auth/core/crypto/keys.service.js';
import { PlatformPrismaService } from '../src/database/platform-prisma.service.js';
import { createTestApp } from './helpers/app.js';
import {
  call,
  createTenantUser,
  devOutboxCode,
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

const PREFIX = 'OTP';
const PIN = '582914';

describe('OTP activation, recovery and identifier change (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PlatformPrismaService;
  let t: Record<FixtureLetter, FixtureTenant>;
  let phoneSeq = 0;

  const api = (letter: FixtureLetter, opts: { token?: string; clientIp?: string } = {}) =>
    call(app, { host: t[letter].domain, ...opts });
  const nextPhone = () => {
    phoneSeq += 1;
    return `+91977${String(phoneSeq).padStart(7, '0')}`;
  };
  /** A pending parent with a phone (no credential yet). */
  const pendingParent = async (letter: FixtureLetter = 'A', phone = nextPhone()) => {
    const id = await createTenantUser(app, { tenantId: t[letter].id, roles: ['PARENT'], phone });
    return { id, phone };
  };
  const start = (
    letter: FixtureLetter,
    identifier: string,
    flow = 'activation',
    clientIp?: string,
  ) =>
    api(letter, clientIp ? { clientIp } : {})
      .post(`/api/v1/auth/${flow}/start`)
      .send({ identifier });
  const verify = (letter: FixtureLetter, identifier: string, code: string, flow = 'activation') =>
    api(letter).post(`/api/v1/auth/${flow}/verify`).send({ identifier, code });

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

  it('parent activation: OTP → verify → set PIN → ACTIVE, phone verified, signed in', async () => {
    const { id, phone } = await pendingParent();
    const started = await start('A', phone.replace('+91', '')).expect(202);
    expect(started.body.message).toMatch(/If the account can be activated/);
    const code = await devOutboxCode(app, phone);
    expect(code).toMatch(/^\d{6}$/);
    const grant = (await verify('A', phone, code ?? '').expect(200)).body as OtpGrant;
    const done = await api('A')
      .post('/api/v1/auth/activation/complete')
      .send({ grantToken: grant.grantToken, credentialType: 'PIN', secret: PIN })
      .expect(200);
    expect((done.body as AuthResult).status).toBe('AUTHENTICATED');
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user).toMatchObject({ status: 'ACTIVE', credentialType: 'PIN' });
    expect(user.phoneVerifiedAt).not.toBeNull();
    // The grant is single use.
    await api('A')
      .post('/api/v1/auth/activation/complete')
      .send({ grantToken: grant.grantToken, credentialType: 'PIN', secret: PIN })
      .expect(400);
    // Normal login thereafter: mobile + PIN, no OTP.
    await tenantLogin(app, t.A.domain, phone, PIN);
  });

  it('stores only an HMAC of the code, bound to purpose and user', async () => {
    const { id, phone } = await pendingParent();
    await start('A', phone).expect(202);
    const code = (await devOutboxCode(app, phone)) ?? '';
    const challenge = await prisma.otpChallenge.findFirstOrThrow({ where: { userId: id } });
    expect(challenge.codeHmac).not.toContain(code);
    expect(JSON.stringify(challenge)).not.toContain(`"${code}"`);
    const keys = app.get(KeysService);
    expect(keys.hmacMatches(challenge.codeHmac, `ACCOUNT_ACTIVATION:${id}:${code}`)).toBe(true);
    expect(keys.hmacMatches(challenge.codeHmac, `ACCOUNT_RECOVERY:${id}:${code}`)).toBe(false);
  });

  it('wrong code, expired code and consumed code are rejected', async () => {
    const { phone } = await pendingParent();
    await start('A', phone).expect(202);
    const code = (await devOutboxCode(app, phone)) ?? '';
    const wrong = await verify('A', phone, code === '000000' ? '111111' : '000000').expect(400);
    expect(wrong.body.code).toBe('INVALID_CODE');
    await verify('A', phone, code).expect(200);
    await verify('A', phone, code).expect(400); // consumed

    const second = await pendingParent();
    await start('A', second.phone).expect(202);
    const expiring = (await devOutboxCode(app, second.phone)) ?? '';
    await prisma.otpChallenge.updateMany({
      where: { userId: second.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await verify('A', second.phone, expiring).expect(400);
  });

  it('five wrong attempts exhaust the challenge; the right code then fails', async () => {
    const { id, phone } = await pendingParent();
    await start('A', phone).expect(202);
    const code = (await devOutboxCode(app, phone)) ?? '';
    const bad = code === '999999' ? '888888' : '999999';
    for (let i = 0; i < 5; i += 1) await verify('A', phone, bad).expect(400);
    await verify('A', phone, code).expect(400); // 6th attempt
    expect((await prisma.otpChallenge.findFirstOrThrow({ where: { userId: id } })).attempts).toBe(
      5,
    );
  });

  it('is bound to tenant, purpose and target', async () => {
    const { phone } = await pendingParent('A');
    await pendingParent('B', phone); // same phone, independent account in school B
    await start('A', phone).expect(202);
    const code = (await devOutboxCode(app, phone)) ?? '';
    await verify('B', phone, code).expect(400); // wrong tenant
    await verify('A', phone, code, 'recovery').expect(400); // wrong purpose
    const other = await pendingParent('A');
    await verify('A', other.phone, code).expect(400); // wrong target
    await verify('A', phone, code).expect(200); // still valid for its own target/purpose/tenant
  });

  it('enforces the 60 s cooldown, supersedes older challenges and caps 5 sends per hour', async () => {
    const { id, phone } = await pendingParent();
    await start('A', phone).expect(202);
    const first = await devOutboxCode(app, phone);
    await start('A', phone).expect(202); // within cooldown: generic answer, nothing sent
    expect(await devOutboxCode(app, phone)).toBe(first);
    expect(await prisma.otpChallenge.count({ where: { userId: id } })).toBe(1);

    // Age existing challenges past the cooldown and send again → supersedes.
    await prisma.otpChallenge.updateMany({
      where: { userId: id },
      data: { createdAt: new Date(Date.now() - 61_000) },
    });
    await start('A', phone).expect(202);
    const second = await devOutboxCode(app, phone);
    await verify('A', phone, first ?? '').expect(400); // superseded
    expect(second).toMatch(/^\d{6}$/);

    // Hourly cap: 5 sends within the rolling hour, then silence.
    for (let i = 0; i < 3; i += 1) {
      await prisma.otpChallenge.updateMany({
        where: { userId: id },
        data: { createdAt: new Date(Date.now() - 61_000 - i * 1000) },
      });
      await start('A', phone).expect(202);
    }
    expect(await prisma.otpChallenge.count({ where: { userId: id } })).toBe(5);
    await prisma.otpChallenge.updateMany({
      where: { userId: id },
      data: { createdAt: new Date(Date.now() - 120_000) },
    });
    await start('A', phone).expect(202); // 6th in the hour
    expect(await prisma.otpChallenge.count({ where: { userId: id } })).toBe(5);
  });

  it('limits OTP sends per IP (10 per hour, 11th → 429)', async () => {
    const ip = '10.77.77.77';
    for (let i = 0; i < 10; i += 1) await start('C', nextPhone(), 'activation', ip).expect(202);
    await start('C', nextPhone(), 'activation', ip).expect(429);
  });

  it('answers identically for unknown and ineligible identifiers (no enumeration, nothing sent)', async () => {
    const unknown = nextPhone();
    const a = await start('A', unknown).expect(202);
    const active = nextPhone();
    await createTenantUser(app, {
      tenantId: t.A.id,
      roles: ['PARENT'],
      phone: active,
      credentialType: 'PIN',
      secret: PIN,
    });
    const b = await start('A', active).expect(202); // already active: not eligible for activation
    expect(a.body).toEqual(b.body);
    expect(await devOutboxCode(app, unknown)).toBeNull();
    expect(await devOutboxCode(app, active)).toBeNull();
    const res = await verify('A', unknown, '123456').expect(400);
    expect(res.body.code).toBe('INVALID_CODE');
  });

  it('concurrent verification cannot consume one challenge twice', async () => {
    const { phone } = await pendingParent();
    await start('A', phone).expect(202);
    const code = (await devOutboxCode(app, phone)) ?? '';
    const results = await Promise.all(Array.from({ length: 6 }, () => verify('A', phone, code)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it('student activation with a school-issued one-time code', async () => {
    const id = await createTenantUser(app, {
      tenantId: t.A.id,
      roles: ['STUDENT'],
      loginId: 'OTP-STU-1',
      loginIdKind: 'STUDENT_ID',
    });
    // Issued through the same service the platform API uses (the API itself is covered in the platform suite).
    const { TenantUsersService } =
      await import('../src/platform/tenant-users/tenant-users.service.js');
    const code = (await app.get(TenantUsersService).issueActivationCode(t.A.id, id)).activationCode;
    expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    const grant = (await verify('A', 'OTP-STU-1', code.toLowerCase()).expect(200)).body as OtpGrant;
    const weak = await api('A')
      .post('/api/v1/auth/activation/complete')
      .send({ grantToken: grant.grantToken, credentialType: 'PIN', secret: '123456' })
      .expect(400);
    expect(weak.body.code).toBe('WEAK_CREDENTIAL'); // a rejected weak PIN does not burn the grant
    await api('A')
      .post('/api/v1/auth/activation/complete')
      .send({ grantToken: grant.grantToken, credentialType: 'PIN', secret: PIN })
      .expect(200);
    await tenantLogin(app, t.A.domain, 'OTP-STU-1', PIN);
  });

  it('recovery: verified phone → new PIN, every session revoked, PIN_RESET audited', async () => {
    const phone = nextPhone();
    const id = await createTenantUser(app, {
      tenantId: t.A.id,
      roles: ['PARENT'],
      phone,
      credentialType: 'PIN',
      secret: PIN,
    });
    const before = (await tenantLogin(app, t.A.domain, phone, PIN)).tokens;
    await start('A', phone, 'recovery').expect(202);
    const code = (await devOutboxCode(app, phone)) ?? '';
    await verify('A', phone, code, 'activation').expect(400); // wrong purpose
    const grant = (await verify('A', phone, code, 'recovery').expect(200)).body as OtpGrant;
    await api('A')
      .post('/api/v1/auth/recovery/complete')
      .send({ grantToken: grant.grantToken, credentialType: 'PIN', secret: '739182' })
      .expect(204);
    await api('A', { token: before.accessToken }).get('/api/v1/auth/me').expect(401);
    await api('A')
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: before.refreshToken })
      .expect(401);
    await api('A').post('/api/v1/auth/login').send({ identifier: phone, secret: PIN }).expect(401);
    await tenantLogin(app, t.A.domain, phone, '739182');
    expect(
      await prisma.auditLog.count({
        where: { action: 'PIN_RESET', metadata: { path: ['subjectUserId'], equals: id } },
      }),
    ).toBe(1);
  });

  it('phone change requires re-authentication and verification of the NEW number', async () => {
    const phone = nextPhone();
    const id = await createTenantUser(app, {
      tenantId: t.A.id,
      roles: ['PARENT'],
      phone,
      credentialType: 'PIN',
      secret: PIN,
    });
    const session = (await tenantLogin(app, t.A.domain, phone, PIN)).tokens;
    const other = (await tenantLogin(app, t.A.domain, phone, PIN)).tokens;
    const next = nextPhone();
    await api('A', { token: session.accessToken })
      .post('/api/v1/auth/identifiers/change/start')
      .send({ kind: 'phone', value: next, currentSecret: '000000' })
      .expect(401);
    await api('A', { token: session.accessToken })
      .post('/api/v1/auth/identifiers/change/start')
      .send({ kind: 'phone', value: next, currentSecret: PIN })
      .expect(202);
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).phone).toBe(phone); // unchanged until verified
    const code = (await devOutboxCode(app, next)) ?? '';
    await api('A', { token: session.accessToken })
      .post('/api/v1/auth/identifiers/change/verify')
      .send({ kind: 'phone', code })
      .expect(204);
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).phone).toBe(next);
    await api('A', { token: other.accessToken }).get('/api/v1/auth/me').expect(401); // other sessions revoked
    await tenantLogin(app, t.A.domain, next, PIN);
    expect(
      await prisma.auditLog.count({ where: { action: 'PHONE_CHANGED', actorUserId: id } }),
    ).toBe(1);
  });

  it('refresh after concurrent use: only one rotation wins', async () => {
    const phone = nextPhone();
    await createTenantUser(app, {
      tenantId: t.A.id,
      roles: ['PARENT'],
      phone,
      credentialType: 'PIN',
      secret: PIN,
    });
    const { tokens } = await tenantLogin(app, t.A.domain, phone, PIN);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        api('A').post('/api/v1/auth/refresh').send({ refreshToken: tokens.refreshToken }),
      ),
    );
    const ok = results.filter((r) => r.status === 200);
    expect(ok.length).toBeLessThanOrEqual(1);
    // Any loser is treated as reuse → the family is revoked, so even the winner's token is dead.
    for (const r of ok)
      await api('A')
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: (r.body as AuthTokens).refreshToken })
        .expect(401);
  });
});
