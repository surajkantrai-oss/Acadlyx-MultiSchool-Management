import {
  appEnvironmentSchema,
  logLevelSchema,
  originListSchema,
  portSchema,
  z,
} from '@acadlyx/validation';

const booleanishInt = z.coerce.number().int().min(0).max(10);

export const envSchema = z.object({
  NODE_ENV: appEnvironmentSchema.default('development'),
  PORT: portSchema.default(4000),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => /^postgres(ql)?:\/\//.test(value), {
      message: 'DATABASE_URL must be a postgresql:// connection string',
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
});

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
