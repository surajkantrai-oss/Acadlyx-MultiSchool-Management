import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema.js';

const valid = {
  DATABASE_URL: 'postgresql://user:s3cret-value@localhost:5432/acadlyx',
  DATABASE_APP_URL: 'postgresql://app_user:other@localhost:5432/acadlyx',
  REDIS_URL: 'redis://localhost:6379/0',
  API_PUBLIC_URL: 'http://localhost:4000',
};

describe('validateEnv', () => {
  it('applies defaults for optional values', () => {
    const env = validateEnv(valid);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      LOG_LEVEL: 'info',
      CORS_ORIGINS: [],
      BODY_LIMIT: '1mb',
    });
  });

  it('parses CORS_ORIGINS and coerces numbers', () => {
    const env = validateEnv({
      ...valid,
      PORT: '4100',
      CORS_ORIGINS: 'http://localhost:4001,http://localhost:4002',
    });
    expect(env.PORT).toBe(4100);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:4001', 'http://localhost:4002']);
  });

  it('fails fast listing every invalid key', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: 'mysql://x', CORS_ORIGINS: '*', NODE_ENV: 'prod' }),
    ).toThrow(/DATABASE_URL[\s\S]*REDIS_URL|REDIS_URL[\s\S]*DATABASE_URL/);
  });

  it('rejects a tenant database URL that reuses the platform role', () => {
    expect(() =>
      validateEnv({ ...valid, DATABASE_APP_URL: 'postgresql://user:x@localhost:5432/acadlyx' }),
    ).toThrow(/DATABASE_APP_URL/);
  });

  it('never echoes configuration values in the error', () => {
    const error = (() => {
      try {
        validateEnv({ ...valid, REDIS_URL: 'not-a-url-with-s3cret-value' });
        return null;
      } catch (e) {
        return e as Error;
      }
    })();
    expect(error?.message).toContain('REDIS_URL');
    expect(error?.message).not.toContain('s3cret-value');
  });
});
