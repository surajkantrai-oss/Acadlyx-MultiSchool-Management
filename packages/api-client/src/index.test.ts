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
