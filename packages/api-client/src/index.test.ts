import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './index.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createApiClient', () => {
  it('calls the health endpoint under the configured base URL', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200, { status: 'ok', timestamp: 't', checks: {} }));
    const client = createApiClient({ baseUrl: 'http://localhost:4000/api/v1/', fetch: fetchMock });

    await expect(client.health()).resolves.toMatchObject({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/api/v1/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('throws ApiError carrying the standard error body', async () => {
    const body = {
      statusCode: 404,
      error: 'Not Found',
      message: 'Route not found',
      requestId: 'req-1',
      timestamp: 't',
      path: '/api/v1/x',
    };
    const client = createApiClient({
      baseUrl: 'http://api',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(404, body)),
    });

    const error = await client.request('GET', 'x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, body, message: 'Route not found' });
  });
});

describe('platform and tenant helpers', () => {
  it('encodes list queries and exposes error codes', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 }),
      )
      .mockResolvedValueOnce(
        jsonResponse(404, {
          statusCode: 404,
          error: 'Not Found',
          code: 'TENANT_NOT_FOUND',
          message: 'Tenant not found',
          requestId: null,
          timestamp: 't',
          path: '/api/v1/tenant/bootstrap',
        }),
      );
    const client = createApiClient({ baseUrl: 'http://api/api/v1', fetch: fetchMock });

    await client.platform.listTenants({ search: 'a b', status: 'ACTIVE', page: 2 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://api/api/v1/platform/tenants?search=a+b&status=ACTIVE&page=2',
    );

    const error = await client.tenant.bootstrap({ tenantKey: 'SCHOOL_A' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('TENANT_NOT_FOUND');
    const init = fetchMock.mock.calls[1]?.[1];
    expect(init?.headers).toMatchObject({ 'x-acadlyx-tenant-key': 'SCHOOL_A' });
  });
});

describe('web BFF helpers', () => {
  it('accepts only same-origin mutations carrying the CSRF header', async () => {
    const { isTrustedMutation } = await import('./web-auth.js');
    const base = {
      method: 'POST',
      host: 'school-a.localhost:4002',
      protocol: 'http' as const,
      referer: null,
    };
    expect(
      isTrustedMutation({ ...base, origin: 'http://school-a.localhost:4002', csrfHeader: '1' }),
    ).toBe(true);
    expect(
      isTrustedMutation({ ...base, origin: 'http://school-b.localhost:4002', csrfHeader: '1' }),
    ).toBe(false);
    expect(isTrustedMutation({ ...base, origin: 'https://evil.example', csrfHeader: '1' })).toBe(
      false,
    );
    expect(
      isTrustedMutation({ ...base, origin: 'http://school-a.localhost:4002', csrfHeader: null }),
    ).toBe(false);
    expect(isTrustedMutation({ ...base, origin: null, csrfHeader: '1' })).toBe(false);
    expect(
      isTrustedMutation({
        ...base,
        origin: null,
        referer: 'http://school-a.localhost:4002/x',
        csrfHeader: '1',
      }),
    ).toBe(true);
    expect(isTrustedMutation({ ...base, method: 'GET', origin: null, csrfHeader: null })).toBe(
      true,
    );
  });

  it('peeks at JWT expiry and applies __Host- names only when secure', async () => {
    const { cookieName, jwtExpiresAt } = await import('./web-auth.js');
    const payload = btoa(JSON.stringify({ exp: 1_900_000_000 }))
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const token = `x.${payload}.y`;
    expect(jwtExpiresAt(token)).toBe(1_900_000_000_000);
    expect(jwtExpiresAt('garbage')).toBeNull();
    expect(cookieName('acx_rt', true)).toBe('__Host-acx_rt');
    expect(cookieName('acx_rt', false)).toBe('acx_rt');
  });
});

describe('academic client (Phase 4)', () => {
  it('builds tenant-scoped paths with encoded ids and query strings, never a tenant id', async () => {
    const calls: { method: string; url: string; body: string | null }[] = [];
    const fake = ((url: string, init: RequestInit) => {
      calls.push({ method: init.method ?? 'GET', url, body: (init.body as string | null) ?? null });
      return Promise.resolve(new Response('[]', { status: 200 }));
    }) as typeof fetch;
    const api = createApiClient({ baseUrl: 'http://api.test/api/v1', fetch: fake });
    await api.academic.branches({ q: 'north campus', active: true });
    await api.academic.sections({ gradeId: 'g/1' });
    await api.academic.assignGradeSubject('g1', 's1', { isRequired: false });
    await api.academic.reorderGrades(['a', 'b']);
    await api.academic.academicYearAction('y1', 'set-current');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET http://api.test/api/v1/branches?q=north+campus&active=true',
      'GET http://api.test/api/v1/sections?gradeId=g%2F1',
      'PUT http://api.test/api/v1/grades/g1/subjects/s1',
      'PUT http://api.test/api/v1/grades/order',
      'POST http://api.test/api/v1/academic-years/y1/set-current',
    ]);
    expect(calls[2]?.body).toBe('{"isRequired":false}');
    expect(calls.some((c) => c.url.includes('tenant') || (c.body ?? '').includes('tenant'))).toBe(
      false,
    );
  });
});

describe('people client (Phase 5)', () => {
  it('builds paginated, filtered, encoded tenant paths', async () => {
    const urls: string[] = [];
    const fake = ((url: string, init: RequestInit) => {
      urls.push(`${init.method ?? 'GET'} ${url}`);
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as typeof fetch;
    const api = createApiClient({ baseUrl: 'http://api.test/api/v1', fetch: fake });
    await api.people.students({ q: 'asha rao', gradeId: 'g1', page: 2, pageSize: 25 });
    await api.people.createAccount('teachers', 't/1');
    await api.people.assignments('t1', true);
    await api.people.importRows('j1', { status: 'INVALID' });
    expect(urls).toEqual([
      'GET http://api.test/api/v1/students?q=asha+rao&gradeId=g1&page=2&pageSize=25',
      'POST http://api.test/api/v1/teachers/t%2F1/account',
      'GET http://api.test/api/v1/teachers/t1/assignments?includeEnded=true',
      'GET http://api.test/api/v1/imports/j1/rows?status=INVALID',
    ]);
  });
});

describe('workspace client (Phase 6)', () => {
  it('builds dashboard/search/access/class paths with encoded context', async () => {
    const urls: string[] = [];
    const fake = ((url: string, init: RequestInit) => {
      urls.push(`${init.method ?? 'GET'} ${url}`);
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as typeof fetch;
    const api = createApiClient({ baseUrl: 'http://api.test/api/v1', fetch: fake });
    await api.admin.dashboard({ academicYearId: 'y1', branchId: 'b1' });
    await api.admin.search('asha & co');
    await api.admin.access({ kind: 'parents', state: 'NONE', page: 2 });
    await api.admin.classes({ gradeId: 'g1' });
    await api.admin.class('s/1');
    await api.people.students({ quality: 'NO_GUARDIAN', account: 'NONE' });
    expect(urls).toEqual([
      'GET http://api.test/api/v1/workspace/dashboard?academicYearId=y1&branchId=b1',
      'GET http://api.test/api/v1/workspace/search?q=asha+%26+co',
      'GET http://api.test/api/v1/workspace/access?kind=parents&state=NONE&page=2',
      'GET http://api.test/api/v1/classes?gradeId=g1',
      'GET http://api.test/api/v1/classes/s%2F1',
      'GET http://api.test/api/v1/students?quality=NO_GUARDIAN&account=NONE',
    ]);
  });
});
