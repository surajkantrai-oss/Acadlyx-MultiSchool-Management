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
