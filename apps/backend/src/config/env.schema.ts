import {
  appEnvironmentSchema,
  logLevelSchema,
  originListSchema,
  portSchema,
  z,
} from '@acadlyx/validation';

const booleanishInt = z.coerce.number().int().min(0).max(10);

/**
 * Key ring: JSON object of key-id → base64 key material, e.g. {"k2026a":"base64..."}.
 * Several keys may be listed so old keys keep verifying/decrypting after rotation; the
 * matching *_ACTIVE_KID selects the key used for new signatures/ciphertexts.
 */
const keyRing = (minBytes: number) =>
  z
    .string()
    .transform((value, ctx) => {
      try {
        const parsed: unknown = JSON.parse(value);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
          throw new Error();
        return parsed as Record<string, unknown>;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'must be a JSON object of keyId → base64 key' });
        return z.NEVER;
      }
    })
    .pipe(
      z
        .record(
          z.string().regex(/^[A-Za-z0-9_-]{1,32}$/, 'key ids must be 1–32 chars [A-Za-z0-9_-]'),
          z.string().refine((b64) => Buffer.from(b64, 'base64').length >= minBytes, {
            message: `each key must decode to at least ${String(minBytes)} bytes`,
          }),
        )
        .refine((ring) => Object.keys(ring).length > 0, {
          message: 'at least one key is required',
        }),
    );

export const envSchema = z
  .object({
    NODE_ENV: appEnvironmentSchema.default('development'),
    PORT: portSchema.default(4000),
    DATABASE_URL: z
      .string()
      .min(1)
      .refine((value) => /^postgres(ql)?:\/\//.test(value), {
        message: 'DATABASE_URL must be a postgresql:// connection string',
      }),
    /** Restricted role for tenant-scoped queries (RLS enforced). Must differ from DATABASE_URL's role. */
    DATABASE_APP_URL: z
      .string()
      .min(1)
      .refine((value) => /^postgres(ql)?:\/\//.test(value), {
        message: 'DATABASE_APP_URL must be a postgresql:// connection string',
      }),
    REDIS_URL: z
      .string()
      .min(1)
      .refine((value) => /^rediss?:\/\//.test(value), {
        message: 'REDIS_URL must be a redis:// or rediss:// URL',
      }),
    CORS_ORIGINS: originListSchema.default([]),
    API_PUBLIC_URL: z.url({ protocol: /^https?$/ }),
    LOG_LEVEL: logLevelSchema.default('info'),
    BODY_LIMIT: z
      .string()
      .regex(/^\d+(b|kb|mb)$/i, 'BODY_LIMIT must look like 100kb or 1mb')
      .default('1mb'),
    RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    TRUST_PROXY: booleanishInt.default(0),

    // ---- Phase 3: authentication secrets (never commit real values; Secrets Manager later)
    AUTH_JWT_ISSUER: z.string().min(1).max(100).default('acadlyx'),
    /** Ed25519 private keys, base64 PKCS#8 DER (generate with `pnpm auth:keys`). */
    AUTH_JWT_PRIVATE_KEYS: keyRing(32),
    AUTH_JWT_ACTIVE_KID: z.string().min(1),
    /** AES-256-GCM keys (exactly 32 bytes) for MFA secrets at rest. */
    AUTH_ENCRYPTION_KEYS: keyRing(32),
    AUTH_ENCRYPTION_ACTIVE_KID: z.string().min(1),
    /** HMAC-SHA256 keys for OTP and MFA recovery codes. */
    AUTH_HMAC_KEYS: keyRing(32),
    AUTH_HMAC_ACTIVE_KID: z.string().min(1),
    /** OTP delivery: `dev` = development outbox (never in production); `none` = fail closed. */
    OTP_DELIVERY: z.enum(['dev', 'none']).default('none'),
  })
  .refine((env) => env.AUTH_JWT_ACTIVE_KID in env.AUTH_JWT_PRIVATE_KEYS, {
    path: ['AUTH_JWT_ACTIVE_KID'],
    message: 'AUTH_JWT_ACTIVE_KID must be a key id in AUTH_JWT_PRIVATE_KEYS',
  })
  .refine((env) => env.AUTH_ENCRYPTION_ACTIVE_KID in env.AUTH_ENCRYPTION_KEYS, {
    path: ['AUTH_ENCRYPTION_ACTIVE_KID'],
    message: 'AUTH_ENCRYPTION_ACTIVE_KID must be a key id in AUTH_ENCRYPTION_KEYS',
  })
  .refine(
    (env) =>
      Object.values(env.AUTH_ENCRYPTION_KEYS).every((k) => Buffer.from(k, 'base64').length === 32),
    { path: ['AUTH_ENCRYPTION_KEYS'], message: 'AES-256-GCM keys must be exactly 32 bytes' },
  )
  .refine((env) => env.AUTH_HMAC_ACTIVE_KID in env.AUTH_HMAC_KEYS, {
    path: ['AUTH_HMAC_ACTIVE_KID'],
    message: 'AUTH_HMAC_ACTIVE_KID must be a key id in AUTH_HMAC_KEYS',
  })
  .refine((env) => !(env.NODE_ENV === 'production' && env.OTP_DELIVERY === 'dev'), {
    path: ['OTP_DELIVERY'],
    message: 'The development OTP outbox cannot be used in production',
  })
  .refine(
    // The tenant path must never run as the platform/owner role, or RLS would be bypassed.
    (env) => URL.parse(env.DATABASE_URL)?.username !== URL.parse(env.DATABASE_APP_URL)?.username,
    {
      path: ['DATABASE_APP_URL'],
      message: 'DATABASE_APP_URL must use a different (restricted) role than DATABASE_URL',
    },
  );

export type Env = z.infer<typeof envSchema>;

/**
 * Validates raw environment variables at startup. Fails fast with a readable list of
 * problems and never echoes values (they may contain credentials).
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
