import { randomInt, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type {
  AuthResult,
  AuthTokens,
  MfaEnrollmentComplete,
  MfaEnrollmentStart,
} from '@acadlyx/types';
import request from 'supertest';
import { RedisService } from '../../src/cache/redis.service.js';
import { PasswordHasher } from '../../src/auth/core/crypto/password-hasher.js';
import { totpCode, totpStep } from '../../src/auth/core/crypto/totp.js';
import { RbacService } from '../../src/auth/core/rbac.service.js';
import { PlatformPrismaService } from '../../src/database/platform-prisma.service.js';

/** A random client IP per call so per-IP auth throttles don't couple unrelated test requests. */
export function ip(): string {
  return `10.${String(randomInt(0, 255))}.${String(randomInt(0, 255))}.${String(randomInt(1, 254))}`;
}

/** supertest wrapper: fresh client IP, optional Host and bearer token. */
export function call(
  app: NestExpressApplication,
  opts: { host?: string; token?: string; clientIp?: string } = {},
) {
  const agent = request(app.getHttpServer());
  const decorate = (req: request.Test) => {
    req.set('X-Forwarded-For', opts.clientIp ?? ip());
    if (opts.host) req.set('Host', opts.host);
    if (opts.token) req.set('Authorization', `Bearer ${opts.token}`);
    return req;
  };
  return {
    get: (path: string) => decorate(agent.get(path)),
    post: (path: string) => decorate(agent.post(path)),
    put: (path: string) => decorate(agent.put(path)),
    patch: (path: string) => decorate(agent.patch(path)),
    delete: (path: string) => decorate(agent.delete(path)),
  };
}

/** TEST-ONLY: clears auth rate-limit state so repeated runs start clean. */
export async function resetRateLimits(app: NestExpressApplication): Promise<void> {
  const redis = app.get(RedisService).client;
  for (const pattern of [
    'auth:ident:*',
    'throttle:*',
    'dev:otp-outbox:*',
    'auth:sess:*',
    'auth:grants:*',
  ]) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  }
}

/**
 * Generates TOTP codes without reusing a time-step (the server rejects replays and older steps).
 * The server accepts steps current-1 … current+1, so one 30-second window yields up to three
 * codes. When they are used up, `next()` WAITS for the clock to advance (≤ one step) instead of
 * failing: a real authenticator user would do the same. Tests that reuse one clock many times
 * therefore declare an explicit per-test timeout.
 */
export class TotpClock {
  private lastStep = -1;

  constructor(private readonly secret: string) {}

  async next(): Promise<string> {
    for (;;) {
      const now = Date.now();
      const current = totpStep(now);
      // current-1 is accepted — unless the step rolls over while the request is in flight, which
      // would make it current-2. Near a rollover, start at the current step.
      const nearRollover = 30_000 - (now % 30_000) < 3_000;
      const step = Math.max(nearRollover ? current : current - 1, this.lastStep + 1);
      if (step <= current + 1) {
        this.lastStep = step;
        return totpCode(this.secret, step);
      }
      // Wait until `step` is no longer in the future beyond the +1 window.
      await new Promise((resolve) => setTimeout(resolve, (step - 1) * 30_000 - now + 250));
    }
  }
}

export async function syncRbac(app: NestExpressApplication): Promise<void> {
  await app.get(RbacService).syncRegistry();
}

/** TEST-ONLY hard delete of platform users whose email starts with `prefix`. */
export async function purgePlatformUsers(
  app: NestExpressApplication,
  prefix: string,
): Promise<void> {
  const prisma = app.get(PlatformPrismaService);
  const users = await prisma.platformUser.findMany({
    where: { email: { startsWith: prefix } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.$transaction([
    prisma.platformAuditLog.deleteMany({ where: { actorPlatformUserId: { in: ids } } }),
    prisma.session.deleteMany({ where: { platformUserId: { in: ids } } }),
    prisma.userDevice.deleteMany({ where: { platformUserId: { in: ids } } }),
    prisma.mfaRecoveryCode.deleteMany({ where: { platformUserId: { in: ids } } }),
    prisma.mfaMethod.deleteMany({ where: { platformUserId: { in: ids } } }),
    prisma.platformUserRole.deleteMany({ where: { platformUserId: { in: ids } } }),
    prisma.platformUser.deleteMany({ where: { id: { in: ids } } }),
  ]);
}

export async function createPlatformUser(
  app: NestExpressApplication,
  input: { email: string; password: string; roles?: string[]; status?: 'ACTIVE' | 'SUSPENDED' },
): Promise<string> {
  const prisma = app.get(PlatformPrismaService);
  const roles = await prisma.role.findMany({
    where: { key: { in: input.roles ?? ['PLATFORM_ADMIN'] } },
  });
  const user = await prisma.platformUser.create({
    data: {
      email: input.email,
      displayName: 'Test Platform Admin',
      status: input.status ?? 'ACTIVE',
      passwordHash: await app.get(PasswordHasher).hash(input.password),
      roles: { create: roles.map((r) => ({ roleId: r.id, roleScope: 'PLATFORM' as const })) },
    },
  });
  return user.id;
}

export interface Signed {
  tokens: AuthTokens;
  totp?: TotpClock;
  recoveryCodes?: string[];
}

/** Completes an MFA step (enrolling first when required) and returns tokens. */
export async function finishMfa(
  app: NestExpressApplication,
  base: string,
  result: AuthResult,
  opts: { host?: string; totp?: TotpClock },
): Promise<Signed> {
  if (result.status === 'AUTHENTICATED') return { tokens: result };
  const c = call(app, opts.host ? { host: opts.host } : {});
  if (result.status === 'MFA_ENROLLMENT_REQUIRED') {
    const start = await c
      .post(`${base}/mfa/enroll/start`)
      .send({ mfaToken: result.mfaToken })
      .expect(200);
    const enrollment = start.body as MfaEnrollmentStart;
    const totp = new TotpClock(enrollment.secret);
    const confirm = await call(app, opts.host ? { host: opts.host } : {})
      .post(`${base}/mfa/enroll/confirm`)
      .send({ mfaToken: result.mfaToken, code: await totp.next() })
      .expect(200);
    const done = confirm.body as MfaEnrollmentComplete;
    if (!done.auth) throw new Error('Enrollment did not complete the login');
    return { tokens: done.auth, totp, recoveryCodes: done.recoveryCodes };
  }
  if (!opts.totp) throw new Error('MFA required but no TOTP clock supplied');
  const verify = await c
    .post(`${base}/mfa/verify`)
    .send({ mfaToken: result.mfaToken, code: await opts.totp.next() })
    .expect(200);
  return { tokens: verify.body as AuthTokens, totp: opts.totp };
}

export async function platformLogin(
  app: NestExpressApplication,
  email: string,
  password: string,
  totp?: TotpClock,
): Promise<Signed> {
  const res = await call(app)
    .post('/api/v1/platform/auth/login')
    .send({ email, password })
    .expect(200);
  return finishMfa(app, '/api/v1/platform/auth', res.body as AuthResult, totp ? { totp } : {});
}

export async function tenantLogin(
  app: NestExpressApplication,
  host: string,
  identifier: string,
  secret: string,
  opts: { totp?: TotpClock; installationId?: string } = {},
): Promise<Signed> {
  const res = await call(app, { host })
    .post('/api/v1/auth/login')
    .send({
      identifier,
      secret,
      ...(opts.installationId
        ? { device: { installationId: opts.installationId, platform: 'IOS', label: 'Test iPhone' } }
        : {}),
    })
    .expect(200);
  return finishMfa(app, '/api/v1/auth', res.body as AuthResult, {
    host,
    ...(opts.totp ? { totp: opts.totp } : {}),
  });
}

/** Creates an ACTIVE tenant identity with a credential directly (fixture). */
export async function createTenantUser(
  app: NestExpressApplication,
  input: {
    tenantId: string;
    displayName?: string;
    roles: string[];
    email?: string;
    phone?: string;
    loginId?: string;
    loginIdKind?: 'STUDENT_ID' | 'EMPLOYEE_ID';
    credentialType?: 'PASSWORD' | 'PIN';
    secret?: string;
    status?: 'ACTIVE' | 'PENDING_ACTIVATION' | 'SUSPENDED';
  },
): Promise<string> {
  const prisma = app.get(PlatformPrismaService);
  const roles = await prisma.role.findMany({
    where: { key: { in: input.roles }, scope: 'TENANT' },
  });
  const now = new Date();
  const user = await prisma.user.create({
    data: {
      tenantId: input.tenantId,
      displayName: input.displayName ?? 'Test User',
      email: input.email ?? null,
      phone: input.phone ?? null,
      loginId: input.loginId ?? null,
      loginIdKind: input.loginIdKind ?? null,
      status: input.status ?? (input.secret ? 'ACTIVE' : 'PENDING_ACTIVATION'),
      credentialType: input.secret ? (input.credentialType ?? 'PASSWORD') : null,
      credentialHash: input.secret ? await app.get(PasswordHasher).hash(input.secret) : null,
      emailVerifiedAt: input.secret && input.email ? now : null,
      phoneVerifiedAt: input.secret && input.phone ? now : null,
      roles: { create: roles.map((r) => ({ roleId: r.id, roleScope: 'TENANT' as const })) },
    },
  });
  return user.id;
}

export function installationId(): string {
  return randomUUID();
}

/** Reads the newest development OTP delivered to `target` (dev outbox; test/dev only). */
export async function devOutboxCode(
  app: NestExpressApplication,
  target: string,
): Promise<string | null> {
  const raw = await app.get(RedisService).client.lindex(`dev:otp-outbox:${target}`, 0);
  return raw === null ? null : (JSON.parse(raw) as { code: string }).code;
}
