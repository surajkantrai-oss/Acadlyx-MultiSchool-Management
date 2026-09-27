import { generateKeyPairSync, randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AuthTokens, MeResponse } from '@acadlyx/types';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KeysService } from '../src/auth/core/crypto/keys.service.js';
import { AUDIENCES } from '../src/auth/core/crypto/token.service.js';
import { PlatformPrismaService } from '../src/database/platform-prisma.service.js';
import { createTestApp } from './helpers/app.js';
import {
  call,
  createPlatformUser,
  createTenantUser,
  installationId,
  platformLogin,
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

const PREFIX = 'ATK';
const PW = 'Attack-test-pass-1';
const LETTERS: FixtureLetter[] = ['A', 'B', 'C'];
const PAIRS: [FixtureLetter, FixtureLetter][] = [
  ['A', 'B'],
  ['B', 'C'],
  ['C', 'A'],
];

describe('Cross-tenant and scope attacks on authentication (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PlatformPrismaService;
  let keys: KeysService;
  let t: Record<FixtureLetter, FixtureTenant>;
  const user: Record<string, string> = {};
  const tok: Record<string, AuthTokens> = {};
  let platformToken: AuthTokens;

  const api = (letter: FixtureLetter, token?: string) =>
    call(app, { host: t[letter].domain, ...(token ? { token } : {}) });

  /** Signs with the application's REAL active key (a genuine Acadlyx signature). */
  const forge = (
    claims: Record<string, unknown>,
    opts: { aud?: string; iss?: string; sub?: string | null; exp?: number | string } = {},
  ) => {
    let jwt = new SignJWT(claims)
      .setProtectedHeader({ alg: 'EdDSA', kid: keys.jwtActiveKid })
      .setIssuedAt();
    if (opts.sub !== null) jwt = jwt.setSubject(opts.sub ?? user.A ?? '');
    jwt = jwt
      .setIssuer(opts.iss ?? 'acadlyx')
      .setAudience(opts.aud ?? AUDIENCES.tenantAccess)
      .setExpirationTime(opts.exp ?? '5m');
    return jwt.sign(keys.jwtSigningKey());
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PlatformPrismaService);
    keys = app.get(KeysService);
    await resetRateLimits(app);
    await syncRbac(app);
    t = await createFixtureTenants(prisma, PREFIX);
    for (const l of LETTERS) {
      user[l] = await createTenantUser(app, {
        tenantId: t[l].id,
        roles: ['TEACHER'],
        email: `teacher@atk-${l.toLowerCase()}.test`,
        secret: PW,
      });
      tok[l] = (
        await tenantLogin(app, t[l].domain, `teacher@atk-${l.toLowerCase()}.test`, PW, {
          installationId: installationId(),
        })
      ).tokens;
    }
    await purgePlatformUsers(app, 'atk-admin@');
    await createPlatformUser(app, {
      email: 'atk-admin@acadlyx.test',
      password: 'Atk-admin-pass-2026',
    });
    platformToken = (await platformLogin(app, 'atk-admin@acadlyx.test', 'Atk-admin-pass-2026'))
      .tokens;
  });

  afterAll(async () => {
    await purgeTenants(prisma, PREFIX);
    await purgePlatformUsers(app, 'atk-admin@');
    await app.close();
  });

  describe.each(PAIRS)('school %s credentials against school %s', (me, other) => {
    it('access token on the other school host is TENANT_MISMATCH for every protected route', async () => {
      const token = tok[me]?.accessToken ?? '';
      const attempts = [
        api(other, token).get('/api/v1/auth/me'),
        api(other, token).get('/api/v1/tenant/workspace'),
        api(other, token).get('/api/v1/auth/sessions'),
        api(other, token).get('/api/v1/auth/devices'),
        api(other, token).delete(`/api/v1/auth/sessions/${tok[me]?.sessionId ?? ''}`),
        api(other, token)
          .post('/api/v1/auth/credentials/change')
          .send({ currentSecret: PW, credentialType: 'PASSWORD', newSecret: 'Hijack-pass-2026' }),
        api(other, token).post('/api/v1/auth/logout-all'),
        api(other, token).post('/api/v1/auth/mfa/totp/start'),
      ];
      for (const res of await Promise.all(attempts)) {
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('TENANT_MISMATCH');
      }
      // Nothing happened to the victim or the attacker's own session.
      await api(me, token).get('/api/v1/auth/me').expect(200);
    });

    it('access token + other school tenant-key header is denied', async () => {
      const res = await call(app, { host: 'localhost', token: tok[me]?.accessToken ?? '' })
        .get('/api/v1/auth/me')
        .set('X-Acadlyx-Tenant-Key', t[other].key)
        .expect(403);
      expect(res.body.code).toBe('TENANT_MISMATCH');
    });

    it('refresh token cannot be used in the other school', async () => {
      await api(other)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tok[me]?.refreshToken ?? '' })
        .expect(401);
    });

    it("cannot reach the other school's sessions or devices by id, even from its own host", async () => {
      const victimSession = tok[other]?.sessionId ?? '';
      const victimDevice =
        (await prisma.session.findUniqueOrThrow({ where: { id: victimSession } })).deviceId ?? '';
      await api(me, tok[me]?.accessToken)
        .delete(`/api/v1/auth/sessions/${victimSession}`)
        .expect(404);
      await api(me, tok[me]?.accessToken)
        .delete(`/api/v1/auth/devices/${victimDevice}`)
        .expect(404);
      await api(other, tok[other]?.accessToken).get('/api/v1/auth/me').expect(200);
    });

    it('forged token claiming the other school (tid swap) with my session is denied', async () => {
      const forged = await forge(
        { scope: 'TENANT', sid: tok[me]?.sessionId, tid: t[other].id },
        { sub: user[me] ?? '' },
      );
      // Layer 1 — warm session cache: the cached snapshot records the session's real tenant.
      await api(me, tok[me]?.accessToken).get('/api/v1/auth/me').expect(200);
      const cached = await api(other, forged).get('/api/v1/auth/me').expect(403);
      expect(cached.body.code).toBe('TENANT_MISMATCH');
      // Layer 2 — cold cache: the session row is invisible to the other tenant under RLS.
      await resetRateLimits(app);
      const cold = await api(other, forged).get('/api/v1/auth/me').expect(401);
      expect(cold.body.code).toBe('SESSION_REVOKED');
    });
  });

  describe('platform vs tenant scope confusion', () => {
    it('tenant token → platform APIs (incl. user administration) is SCOPE_MISMATCH', async () => {
      const token = tok.A?.accessToken ?? '';
      for (const path of [
        '/api/v1/platform/tenants',
        `/api/v1/platform/tenants/${t.A.id}/users`,
        '/api/v1/platform/auth/me',
      ]) {
        const res = await call(app, { token }).get(path).expect(403);
        expect(res.body.code).toBe('SCOPE_MISMATCH');
      }
      const assign = await call(app, { token })
        .post(`/api/v1/platform/tenants/${t.A.id}/users/${user.A ?? ''}/roles`)
        .send({ roleKey: 'PRINCIPAL' })
        .expect(403);
      expect(assign.body.code).toBe('SCOPE_MISMATCH');
    });

    it('platform token → tenant protected routes is SCOPE_MISMATCH', async () => {
      for (const path of [
        '/api/v1/auth/me',
        '/api/v1/tenant/workspace',
        '/api/v1/tenant/settings',
      ]) {
        const res = await api('A', platformToken.accessToken).get(path).expect(403);
        expect(res.body.code).toBe('SCOPE_MISMATCH');
      }
    });

    it('rejects scope/issuer/audience/type confusion even with a genuine signature', async () => {
      const sid = tok.A?.sessionId;
      const cases: { token: Promise<string>; status: number }[] = [
        {
          token: forge({ scope: 'TENANT', sid, tid: t.A.id }, { iss: 'evil-issuer' }),
          status: 401,
        }, // wrong issuer
        {
          token: forge({ scope: 'TENANT', sid, tid: t.A.id }, { aud: 'someone-else' }),
          status: 401,
        }, // unknown audience
        {
          token: forge({ scope: 'TENANT', sid, tid: t.A.id }, { aud: AUDIENCES.mfa }),
          status: 403,
        }, // MFA-step token as access
        {
          token: forge(
            { scope: 'TENANT', sid, tid: t.A.id, cid: 'x', purpose: 'ACCOUNT_RECOVERY' },
            { aud: AUDIENCES.otpGrant },
          ),
          status: 403,
        }, // OTP grant as access
        { token: forge({ scope: 'PLATFORM', sid, tid: t.A.id }), status: 403 }, // tenant audience, platform scope claim
        { token: forge({ scope: 'TENANT', sid }), status: 403 }, // tenant token missing tid
        {
          token: forge({ scope: 'TENANT', sid, tid: t.A.id }, { aud: AUDIENCES.platformAccess }),
          status: 403,
        }, // platform audience on tenant route
      ];
      for (const c of cases) {
        const res = await api('A', await c.token).get('/api/v1/auth/me');
        expect(res.status, JSON.stringify(res.body)).toBe(c.status);
      }
      expect(
        (await api('A', await forge({ scope: 'TENANT', sid })).get('/api/v1/auth/me')).body.code,
      ).toBe('TENANT_MISMATCH');
    });

    it('a platform token with an injected tenant id is still only a platform token', async () => {
      const injected = await forge(
        { scope: 'PLATFORM', sid: platformToken.sessionId, tid: t.A.id },
        {
          aud: AUDIENCES.platformAccess,
          sub:
            (await prisma.session.findUniqueOrThrow({ where: { id: platformToken.sessionId } }))
              .platformUserId ?? '',
        },
      );
      await call(app, { token: injected }).get('/api/v1/platform/tenants').expect(200); // tid ignored on platform
      await api('A', injected).get('/api/v1/auth/me').expect(403); // never a tenant credential
    });
  });

  describe('JWT validation', () => {
    const me = () => api('A').get('/api/v1/auth/me');

    it('accepts the genuine token and rejects every tampering', async () => {
      const good = tok.A?.accessToken ?? '';
      await api('A', good).get('/api/v1/auth/me').expect(200);
      const [h, p, s] = good.split('.');
      const payload = JSON.parse(Buffer.from(p ?? '', 'base64url').toString()) as Record<
        string,
        unknown
      >;
      const modified = `${h ?? ''}.${Buffer.from(JSON.stringify({ ...payload, sub: user.B })).toString('base64url')}.${s ?? ''}`;
      // Flip one bit of the decoded signature (a string-level edit such as "…AA" can be a no-op
      // when the signature already ends that way).
      const sigBytes = Buffer.from(s ?? '', 'base64url');
      sigBytes[0] = (sigBytes[0] ?? 0) ^ 0x01;
      const flippedSig = `${h ?? ''}.${p ?? ''}.${sigBytes.toString('base64url')}`;
      const noneAlg = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT', kid: keys.jwtActiveKid })).toString('base64url')}.${p ?? ''}.`;
      const hs256 = await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256', kid: keys.jwtActiveKid })
        .sign(randomBytes(32));
      const foreignKey = generateKeyPairSync('ed25519').privateKey;
      const wrongKey = await new SignJWT(payload)
        .setProtectedHeader({ alg: 'EdDSA', kid: keys.jwtActiveKid })
        .sign(foreignKey);
      const unknownKid = await new SignJWT(payload)
        .setProtectedHeader({ alg: 'EdDSA', kid: 'not-a-kid' })
        .sign(keys.jwtSigningKey());
      const expired = await forge(
        { scope: 'TENANT', sid: tok.A?.sessionId, tid: t.A.id },
        { exp: Math.floor(Date.now() / 1000) - 5 },
      );
      const missingSub = await forge(
        { scope: 'TENANT', sid: tok.A?.sessionId, tid: t.A.id },
        { sub: null },
      );
      const missingSid = await forge({ scope: 'TENANT', tid: t.A.id });
      const bad: [string, string][] = [
        ['modified payload', modified],
        ['wrong signature', flippedSig],
        ['alg=none', noneAlg],
        ['HS256 substitution', hs256],
        ['wrong signing key', wrongKey],
        ['unknown kid', unknownKid],
        ['missing sub', missingSub],
        ['missing sessionId', missingSid],
        ['malformed', 'not.a.jwt'],
        ['garbage', 'abc'],
      ];
      for (const [label, token] of bad) {
        const res = await api('A', token).get('/api/v1/auth/me');
        expect(res.status, label).toBe(401);
      }
      const exp = await api('A', expired).get('/api/v1/auth/me').expect(401);
      expect(exp.body.code).toBe('TOKEN_EXPIRED');
      await me().set('Authorization', 'Basic dXNlcjpwYXNz').expect(401);
    });

    it('revoked session makes a still-valid JWT useless', async () => {
      const fresh = (await tenantLogin(app, t.A.domain, 'teacher@atk-a.test', PW)).tokens;
      await api('A', fresh.accessToken).get('/api/v1/auth/me').expect(200);
      await prisma.session.update({
        where: { id: fresh.sessionId },
        data: { revokedAt: new Date(), revocationReason: 'test' },
      });
      await resetRateLimits(app); // drop the ≤30 s cache so the DB revocation is seen (explicit revocations clear it)
      await api('A', fresh.accessToken).get('/api/v1/auth/me').expect(401);
    });
  });

  describe('JWT key rotation', () => {
    it('accepts tokens signed with a previous key id and rejects removed ids', async () => {
      const oldKey = generateKeyPairSync('ed25519').privateKey;
      const newKey = generateKeyPairSync('ed25519').privateKey;
      const der = (k: typeof oldKey) =>
        k.export({ format: 'der', type: 'pkcs8' }).toString('base64');
      const rotated = await createTestApp({
        overrides: {
          AUTH_JWT_PRIVATE_KEYS: { old: der(oldKey), cur: der(newKey) },
          AUTH_JWT_ACTIVE_KID: 'cur',
        },
      });
      try {
        const session = (await tenantLogin(rotated, t.A.domain, 'teacher@atk-a.test', PW)).tokens;
        const withOld = await new SignJWT({ scope: 'TENANT', sid: session.sessionId, tid: t.A.id })
          .setProtectedHeader({ alg: 'EdDSA', kid: 'old' })
          .setSubject(user.A ?? '')
          .setIssuer('acadlyx')
          .setAudience(AUDIENCES.tenantAccess)
          .setExpirationTime('5m')
          .sign(oldKey);
        await call(rotated, { host: t.A.domain, token: session.accessToken })
          .get('/api/v1/auth/me')
          .expect(200);
        await call(rotated, { host: t.A.domain, token: withOld })
          .get('/api/v1/auth/me')
          .expect(200);
        // The original app (only its own key) does not know kid "old".
        await api('A', withOld).get('/api/v1/auth/me').expect(401);
      } finally {
        await rotated.close();
      }
    });
  });

  describe('concurrency', () => {
    it('keeps tenant, auth and database context isolated across 90 mixed concurrent requests', async () => {
      const jobs = Array.from({ length: 90 }, (_, i) => {
        const l = LETTERS[i % 3] ?? 'A';
        const wrong = LETTERS[(i + 1) % 3] ?? 'B';
        switch (i % 5) {
          case 0:
            return api(l, tok[l]?.accessToken)
              .get('/api/v1/auth/me')
              .then((r) => ({ kind: 'me', l, r }));
          case 1:
            return api(l, tok[l]?.accessToken)
              .get('/api/v1/tenant/workspace')
              .then((r) => ({ kind: 'ws', l, r }));
          case 2:
            return api(l, tok[l]?.accessToken)
              .get('/api/v1/auth/sessions')
              .then((r) => ({ kind: 'sess', l, r }));
          case 3:
            return api(wrong, tok[l]?.accessToken)
              .get('/api/v1/auth/me')
              .then((r) => ({ kind: 'cross', l, r }));
          default:
            return api(l)
              .get('/api/v1/tenant/bootstrap')
              .then((r) => ({ kind: 'boot', l, r }));
        }
      });
      for (const { kind, l, r } of await Promise.all(jobs)) {
        if (kind === 'cross') {
          expect(r.status).toBe(403);
          continue;
        }
        expect(r.status, `${kind} ${l}`).toBe(200);
        if (kind === 'me')
          expect(r.body as MeResponse).toMatchObject({ id: user[l], tenant: { key: t[l].key } });
        if (kind === 'ws') expect(r.body.tenant.key).toBe(t[l].key);
        if (kind === 'sess')
          expect((r.body as { id: string }[]).map((s) => s.id)).toContain(tok[l]?.sessionId);
        if (kind === 'boot') expect(r.body.key).toBe(t[l].key);
      }
    });

    it('concurrent logins in three schools produce correctly bound sessions', async () => {
      const results = await Promise.all(
        Array.from({ length: 15 }, (_, i) => {
          const l = LETTERS[i % 3] ?? 'A';
          return call(app, { host: t[l].domain })
            .post('/api/v1/auth/login')
            .send({ identifier: `teacher@atk-${l.toLowerCase()}.test`, secret: PW })
            .then((r) => ({ l, r }));
        }),
      );
      for (const { l, r } of results) {
        expect(r.status).toBe(200);
        const session = await prisma.session.findUniqueOrThrow({
          where: { id: (r.body as AuthTokens).sessionId },
        });
        expect(session).toMatchObject({ tenantId: t[l].id, userId: user[l] });
      }
    });
  });
});
