import { describe, expect, it } from 'vitest';
import { originListSchema, portSchema } from './index.js';

describe('originListSchema', () => {
  it('parses a comma-separated origin list', () => {
    expect(originListSchema.parse('http://localhost:4001, http://localhost:4002')).toEqual([
      'http://localhost:4001',
      'http://localhost:4002',
    ]);
  });

  it('rejects wildcards, paths and non-http schemes', () => {
    expect(originListSchema.safeParse('*').success).toBe(false);
    expect(originListSchema.safeParse('http://localhost:4001/app').success).toBe(false);
    expect(originListSchema.safeParse('ftp://localhost').success).toBe(false);
  });
});

describe('portSchema', () => {
  it('coerces valid ports and rejects out-of-range values', () => {
    expect(portSchema.parse('4000')).toBe(4000);
    expect(portSchema.safeParse('70000').success).toBe(false);
  });
});
