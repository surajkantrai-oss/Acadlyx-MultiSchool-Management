import { describe, expect, it } from 'vitest';
import { isNonEmptyString, joinUrl } from './index.js';

describe('joinUrl', () => {
  it('normalises slashes between base and path', () => {
    expect(joinUrl('http://localhost:4000/api/v1/', '/health')).toBe(
      'http://localhost:4000/api/v1/health',
    );
    expect(joinUrl('http://localhost:4000/api/v1', 'health')).toBe(
      'http://localhost:4000/api/v1/health',
    );
  });
});

describe('isNonEmptyString', () => {
  it('rejects blank and non-string values', () => {
    expect(isNonEmptyString('a')).toBe(true);
    expect(isNonEmptyString('  ')).toBe(false);
    expect(isNonEmptyString(1)).toBe(false);
  });
});
