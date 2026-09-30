import { ApiError } from '@acadlyx/api-client';
import { describe, expect, it } from 'vitest';
import { errorKind, friendlyError } from './errors';

const api = (status: number, code?: string) =>
  new ApiError(
    status,
    code
      ? {
          statusCode: status,
          code,
          message: 'internal detail',
          error: 'x',
          requestId: 'r',
          timestamp: 't',
          path: '/p',
        }
      : null,
  );

describe('friendly error mapping', () => {
  it('maps stable codes to friendly text and never shows server text', () => {
    expect(friendlyError(api(409, 'ASSIGNMENT_CLOSED'))).toMatch(/closed/);
    expect(friendlyError(api(403, 'SUBMISSION_NOT_ALLOWED'))).toMatch(/no longer submit/);
    expect(friendlyError(api(400, 'ATTENDANCE_OUTSIDE_WINDOW'))).toMatch(/previous 7 days/);
    expect(friendlyError(api(404, 'SOMETHING_NEW'))).toBe('This item is not available.');
    expect(friendlyError(api(500))).not.toContain('internal detail');
  });

  it('network failures read as offline; 401 as an ended session', () => {
    expect(errorKind(new TypeError('Network request failed'))).toBe('offline');
    expect(friendlyError(new TypeError('x'))).toMatch(/offline/);
    expect(errorKind(api(401, 'TOKEN_EXPIRED'))).toBe('session');
  });
});
