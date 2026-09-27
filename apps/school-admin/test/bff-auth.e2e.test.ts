/**
 * School Admin BFF authentication: HttpOnly cookie sessions, CSRF/origin protection, refresh via
 * the proxy, tenant-bound cookies and logout. Runs against a live API + `next start`.
 */
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cookieHeader,
  cookieLine,
  cookieValue,
  createSchool,
  createUser,
  db,
  purge,
  request,
  resetRateLimits,
} from './helpers';

const PREFIX = 'SABFF';
const A = 'sabff-a.localhost';
const B = 'sabff-b.localhost';
const PW = 'Bff-teacher-pass-1';
const csrf = (host: string) => ({ origin: `http://${host}:4002`, 'x-acadlyx-csrf': '1' });
const login = (host: string, headers: Record<string, string>) =>
  request('POST', '/bff/auth/login', {
    host,
    headers,
    body: { identifier: 'teacher@sabff-a.test', secret: PW },
  });

describe('School Admin BFF session security', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = db();
    await client.connect();
    await purge(client, PREFIX);
    const a = await createSchool(client, {
      key: `${PREFIX}_A`,
      status: 'ACTIVE',
      domain: A,
      name: 'BFF School A',
    });
    await createSchool(client, {
      key: `${PREFIX}_B`,
      status: 'ACTIVE',
      domain: B,
      name: 'BFF School B',
      color: '#15803D',
    });
    await createUser(client, {
      tenantId: a,
      name: 'Ravi Teacher',
      email: 'teacher@sabff-a.test',
      password: PW,
      role: 'TEACHER',
    });
  });

  beforeEach(resetRateLimits);

  afterAll(async () => {
    await purge(client, PREFIX);
    await client.end();
  });

  it('shows the branded sign-in (no school picker) when signed out', async () => {
    const res = await request('GET', '/', { host: A });
    expect(res.status).toBe(200);
    expect(res.body).toContain('Sign in to BFF School A');
    expect(res.body).not.toMatch(/choose (your )?school/i);
  });

  it('rejects login without CSRF header or from a foreign origin', async () => {
    expect((await login(A, {})).status).toBe(403);
    expect((await login(A, { origin: 'https://evil.example', 'x-acadlyx-csrf': '1' })).status).toBe(
      403,
    );
    expect((await login(A, { origin: `http://${B}:4002`, 'x-acadlyx-csrf': '1' })).status).toBe(
      403,
    );
    expect((await login(A, { origin: `http://${A}:4002` })).status).toBe(403);
  });

  it('signs in with HttpOnly, SameSite cookies; tokens never appear in the response body', async () => {
    const res = await login(A, csrf(A));
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'AUTHENTICATED' });
    for (const name of ['acx_at', 'acx_rt', 'acx_did']) {
      const line = cookieLine(res.setCookies, name) ?? '';
      expect(line, name).toMatch(/HttpOnly/i);
      expect(line, name).toMatch(/SameSite=lax/i);
      expect(line, name).toMatch(/Path=\//);
      expect(line, name).not.toMatch(/Domain=/i);
      // `next start` = production: __Host- prefix requires Secure, Path=/ and no Domain.
      expect(line, name).toMatch(new RegExp(`^__Host-${name}=`));
      expect(line, name).toMatch(/;\s*Secure/i);
    }
    expect(res.body).not.toContain(cookieValue(res.setCookies, 'acx_at') ?? 'x');
  });

  it('renders the authenticated shell with identity and roles', async () => {
    const res = await login(A, csrf(A));
    const cookie = cookieHeader(res.setCookies, ['acx_at', 'acx_rt']);
    const page = await request('GET', '/', { host: A, headers: { cookie } });
    expect(page.status).toBe(200);
    expect(page.body).toContain('Welcome, Ravi Teacher');
    expect(page.body).toContain('TEACHER');
  });

  it('cookies from school A are useless on school B', async () => {
    const res = await login(A, csrf(A));
    const cookie = cookieHeader(res.setCookies, ['acx_at', 'acx_rt']);
    const page = await request('GET', '/', { host: B, headers: { cookie } });
    expect(page.body).toContain('Sign in to BFF School B');
    expect(page.body).not.toContain('Ravi Teacher');
    const me = await request('GET', '/bff/api/auth/me', { host: B, headers: { cookie } });
    expect([401, 403]).toContain(me.status);
  });

  it('refreshes an expired access token server-side (proxy) and rotates the refresh cookie', async () => {
    const res = await login(A, csrf(A));
    const refresh = cookieValue(res.setCookies, 'acx_rt');
    const page = await request('GET', '/', {
      host: A,
      headers: { cookie: cookieHeader(res.setCookies, ['acx_rt']) },
    });
    expect(page.status).toBe(200);
    expect(page.body).toContain('Ravi Teacher');
    const rotated = cookieValue(page.setCookies, 'acx_rt');
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(refresh);
    expect(cookieValue(page.setCookies, 'acx_at')).toBeTruthy();
  });

  it('BFF API proxy: allow-listed paths only, CSRF on mutations', async () => {
    const res = await login(A, csrf(A));
    const cookie = cookieHeader(res.setCookies, ['acx_at']);
    const me = await request('GET', '/bff/api/auth/me', { host: A, headers: { cookie } });
    expect(me.status).toBe(200);
    expect(JSON.parse(me.body)).toMatchObject({ displayName: 'Ravi Teacher' });
    expect(
      (await request('GET', '/bff/api/platform/tenants', { host: A, headers: { cookie } })).status,
    ).toBe(404);
    expect(
      (
        await request('POST', '/bff/api/auth/login', {
          host: A,
          headers: { cookie, ...csrf(A) },
          body: {},
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request('POST', '/bff/api/auth/credentials/change', {
          host: A,
          headers: { cookie },
          body: {},
        })
      ).status,
    ).toBe(403);
  });

  it('logout clears cookies and kills the session at the API', async () => {
    const res = await login(A, csrf(A));
    const cookie = cookieHeader(res.setCookies, ['acx_at', 'acx_rt']);
    const out = await request('POST', '/bff/auth/logout', {
      host: A,
      headers: { cookie, ...csrf(A) },
    });
    expect(out.status).toBe(200);
    for (const name of ['acx_at', 'acx_rt']) {
      expect(cookieLine(out.setCookies, name), name).toMatch(/Max-Age=0/);
    }
    const reuse = await request('GET', '/bff/api/auth/me', { host: A, headers: { cookie } });
    expect(reuse.status).toBe(401);
  });
});
