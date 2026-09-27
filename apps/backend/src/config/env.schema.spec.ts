import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema.js';

// Throwaway key material generated per test run (never real secrets).
const jwtKey = generateKeyPairSync('ed25519')
  .privateKey.export({ format: 'der', type: 'pkcs8' })
  .toString('base64');
const authKeys = {
  AUTH_JWT_PRIVATE_KEYS: JSON.stringify({ k1: jwtKey }),
  AUTH_JWT_ACTIVE_KID: 'k1',
  AUTH_ENCRYPTION_KEYS: JSON.stringify({ e1: randomBytes(32).toString('base64') }),
  AUTH_ENCRYPTION_ACTIVE_KID: 'e1',
  AUTH_HMAC_KEYS: JSON.stringify({ h1: randomBytes(32).toString('base64') }),
  AUTH_HMAC_ACTIVE_KID: 'h1',
};

const valid = {
  ...authKeys,
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

  it('validates auth key rings and active key ids', () => {
    expect(() => validateEnv({ ...valid, AUTH_JWT_ACTIVE_KID: 'missing' })).toThrow(
      /AUTH_JWT_ACTIVE_KID/,
    );
    expect(() =>
      validateEnv({
        ...valid,
        AUTH_ENCRYPTION_KEYS: JSON.stringify({ e1: randomBytes(16).toString('base64') }),
      }),
    ).toThrow(/AUTH_ENCRYPTION_KEYS/);
    expect(() => validateEnv({ ...valid, AUTH_HMAC_KEYS: 'not-json' })).toThrow(/AUTH_HMAC_KEYS/);
  });

  it('refuses the development OTP outbox in production', () => {
    expect(() => validateEnv({ ...valid, NODE_ENV: 'production', OTP_DELIVERY: 'dev' })).toThrow(
      /OTP_DELIVERY/,
    );
    expect(validateEnv({ ...valid, NODE_ENV: 'production' }).OTP_DELIVERY).toBe('none');
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
