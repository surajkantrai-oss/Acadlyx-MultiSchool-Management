import { type ArgumentsHost, BadRequestException, Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function createHost() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id: 'req-123', originalUrl: '/api/v1/example' }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps HttpExceptions to the standard error body', () => {
    const { host, status, json } = createHost();
    new AllExceptionsFilter().catch(new BadRequestException(['name must be a string']), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        error: 'Bad Request',
        message: ['name must be a string'],
        requestId: 'req-123',
        path: '/api/v1/example',
      }),
    );
  });

  it('hides internal error details behind a generic 500', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, status, json } = createHost();
    new AllExceptionsFilter().catch(
      new Error('relation "secret_table" does not exist at postgresql://user:pw@db'),
      host,
    );

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toMatch(/secret_table|postgresql|stack/);
  });
});
