/**
 * Platform Admin web authentication end-to-end (live API + `next start`):
 * protected pages, CSRF/origin checks, forced TOTP enrollment, HttpOnly cookies, MFA challenge on
 * later sign-ins, refresh via the proxy, BFF allow-list and logout.
 */
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cookieLine,
  cookieValue,
  createPlatformAdmin,
  db,
  Jar,
  ORIGIN,
  purgePlatformUsers,
  request,
  resetRateLimits,
  totp,
} from './helpers';

const EMAIL_PREFIX = 'e2e-pa-web-';
const EMAIL = `${EMAIL_PREFIX}admin@acadlyx.test`;
const PASSWORD = 'Platform-e2e-pass-2026';
const csrf = { origin: ORIGIN, 'x-acadlyx-csrf': '1' };

describe('Platform Admin web auth', () => {
  let client: pg.Client;
  let secret = '';
  const jar = new Jar();

  beforeAll(async () => {
    client = db();
    await client.connect();
    await purgePlatformUsers(client, EMAIL_PREFIX);
    await createPlatformAdmin(client, EMAIL, PASSWORD);
  });
  beforeEach(resetRateLimits);
  afterAll(async () => {
    await purgePlatformUsers(client, EMAIL_PREFIX);
    await client.end();
  });

  it.each(['/', '/dashboard', '/schools', '/account/security'])(
    '%s redirects to /login when signed out',
    async (path) => {
      const res = await request('GET', path);
      expect([307, 308]).toContain(res.status);
      expect(res.headers.location).toMatch(/\/login$/);
    },
  );

  it('/login renders without the Phase 2 warning banner', async () => {
    const res = await request('GET', '/login');
    expect(res.status).toBe(200);
    expect(res.body).toContain('Platform Admin sign in');
    expect(res.body).not.toMatch(/no authentication|unauthenticated|phase 2/i);
  });

  it('login rejects missing CSRF header and foreign origins', async () => {
    const body = { email: EMAIL, password: PASSWORD };
    expect((await request('POST', '/bff/auth/login', { body })).status).toBe(403);
    expect(
      (
        await request('POST', '/bff/auth/login', {
          body,
          headers: { origin: 'https://evil.example', 'x-acadlyx-csrf': '1' },
        })
      ).status,
    ).toBe(403);
  });

  it('wrong password → generic 401, no cookies', async () => {
    const res = await request('POST', '/bff/auth/login', {
      body: { email: EMAIL, password: 'Wrong-password-123' },
      headers: csrf,
    });
    expect(res.status).toBe(401);
    expect(cookieValue(res.setCookies, 'acx_at')).toBeUndefined();
  });

  it('first sign-in forces TOTP enrollment; completion sets HttpOnly session cookies', async () => {
    const login = await request('POST', '/bff/auth/login', {
      body: { email: EMAIL, password: PASSWORD },
      headers: csrf,
    });
    expect(login.status).toBe(200);
    expect(JSON.parse(login.body)).toEqual({ status: 'MFA_ENROLLMENT_REQUIRED' });
    expect(cookieLine(login.setCookies, 'acx_mfa')).toMatch(
      /HttpOnly.*SameSite=strict|SameSite=strict.*HttpOnly/i,
    );
    expect(cookieValue(login.setCookies, 'acx_at')).toBeFalsy();
    jar.apply(login.setCookies);

    // The pending-MFA cookie is not a session: protected pages still redirect.
    expect((await request('GET', '/dashboard', { headers: { cookie: jar.header() } })).status).toBe(
      307,
    );

    const start = await request('POST', '/bff/auth/enroll/start', {
      headers: { ...csrf, cookie: jar.header() },
    });
    expect(start.status).toBe(200);
    const started = JSON.parse(start.body) as { secret: string; qrSvg: string };
    expect(started.qrSvg).toContain('<svg');
    secret = started.secret;

    expect(
      (
        await request('POST', '/bff/auth/enroll/confirm', {
          body: { code: '000000' },
          headers: { ...csrf, cookie: jar.header() },
        })
      ).status,
    ).toBe(401);
    const confirm = await request('POST', '/bff/auth/enroll/confirm', {
      body: { code: totp(secret) },
      headers: { ...csrf, cookie: jar.header() },
    });
    expect(confirm.status).toBe(200);
    expect((JSON.parse(confirm.body) as { recoveryCodes: string[] }).recoveryCodes).toHaveLength(
      10,
    );
    for (const name of ['acx_at', 'acx_rt']) {
      const line = cookieLine(confirm.setCookies, name) ?? '';
      expect(line).toMatch(new RegExp(`^__Host-${name}=`));
      expect(line).toMatch(/HttpOnly/i);
      expect(line).toMatch(/;\s*Secure/i);
      expect(line).toMatch(/SameSite=lax/i);
    }
    expect(confirm.body).not.toContain(cookieValue(confirm.setCookies, 'acx_at') ?? 'x');
    jar.apply(confirm.setCookies);
  });

  it('authenticated pages render with the signed-in identity', async () => {
    const dash = await request('GET', '/dashboard', { headers: { cookie: jar.header() } });
    expect(dash.status).toBe(200);
    expect(dash.body).toContain('Dashboard');
    expect(dash.body).toContain('E2E Platform Admin');
    const security = await request('GET', '/account/security', {
      headers: { cookie: jar.header() },
    });
    expect(security.status).toBe(200);
  });

  it('BFF API: allow-listed, CSRF on mutations, cookie-only auth', async () => {
    const me = await request('GET', '/bff/api/platform/auth/me', {
      headers: { cookie: jar.header() },
    });
    expect(me.status).toBe(200);
    expect(JSON.parse(me.body)).toMatchObject({
      scope: 'PLATFORM',
      roles: ['PLATFORM_ADMIN'],
      identifiers: { email: EMAIL },
      mfa: { required: true, enrolled: true },
    });
    expect(
      (await request('GET', '/bff/api/health', { headers: { cookie: jar.header() } })).status,
    ).toBe(404);
    expect(
      (
        await request('POST', '/bff/api/platform/tenants', {
          body: {},
          headers: { cookie: jar.header() },
        })
      ).status,
    ).toBe(403);
    expect((await request('GET', '/bff/api/platform/tenants')).status).toBe(401);
  });

  it('proxy refreshes from the refresh cookie alone and rotates it', async () => {
    const before = cookieValue(jar.header().split('; '), 'acx_rt');
    const res = await request('GET', '/dashboard', { headers: { cookie: jar.header(['acx_rt']) } });
    expect(res.status).toBe(200);
    const rotated = cookieValue(res.setCookies, 'acx_rt');
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(before);
    jar.apply(res.setCookies);
  });

  it('later sign-ins require the TOTP challenge', async () => {
    const login = await request('POST', '/bff/auth/login', {
      body: { email: EMAIL, password: PASSWORD },
      headers: csrf,
    });
    expect(JSON.parse(login.body)).toEqual({ status: 'MFA_REQUIRED' });
    const second = new Jar();
    second.apply(login.setCookies);
    // TOTP codes are single-use: the enrollment code's step may still be current — use the next step.
    const code = totp(secret, Date.now() + 30_000);
    const mfa = await request('POST', '/bff/auth/mfa', {
      body: { code },
      headers: { ...csrf, cookie: second.header() },
    });
    expect(mfa.status).toBe(200);
    expect(cookieValue(mfa.setCookies, 'acx_at')).toBeTruthy();
  });

  it('logout clears cookies and revokes the server session', async () => {
    const cookie = jar.header();
    const out = await request('POST', '/bff/auth/logout', { headers: { ...csrf, cookie } });
    expect(out.status).toBe(200);
    expect(cookieLine(out.setCookies, 'acx_at')).toMatch(/Max-Age=0/);
    expect(cookieLine(out.setCookies, 'acx_rt')).toMatch(/Max-Age=0/);
    // Old cookies (replayed) no longer work anywhere.
    expect(
      (await request('GET', '/bff/api/platform/auth/me', { headers: { cookie } })).status,
    ).toBe(401);
    const page = await request('GET', '/dashboard', { headers: { cookie } });
    expect(page.status).toBe(307);
  });
});
