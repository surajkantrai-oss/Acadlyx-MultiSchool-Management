import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { resolveRequestId } from './logging.module.js';

function call(header: string | undefined) {
  const setHeader = vi.fn();
  const req = { headers: header === undefined ? {} : { 'x-request-id': header } };
  const id = resolveRequestId(
    req as unknown as IncomingMessage,
    { setHeader } as unknown as ServerResponse,
  );
  return { id, setHeader };
}

describe('resolveRequestId', () => {
  it('reuses a well-formed incoming request id and echoes it', () => {
    const { id, setHeader } = call('client-abc_123');
    expect(id).toBe('client-abc_123');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', 'client-abc_123');
  });

  it('generates a UUID when the header is missing or unsafe', () => {
    expect(call(undefined).id).toMatch(/^[0-9a-f-]{36}$/);
    expect(call('bad id\nwith newline').id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
