/**
 * Reusable validation primitives. Business schemas are added by the phase that owns them.
 */
import { z } from 'zod';

export { z };

export * from './tenant.js';
export * from './academic.js';
export * from './people.js';

export const appEnvironmentSchema = z.enum(['development', 'test', 'staging', 'production']);

export const logLevelSchema = z.enum([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
]);

/** TCP port supplied as a string (e.g. from process.env). */
export const portSchema = z.coerce.number().int().min(1).max(65535);

/**
 * Comma-separated list of absolute http(s) origins, e.g.
 * `http://localhost:4001,http://localhost:4002`. Wildcards are rejected on purpose.
 */
export const originListSchema = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  )
  .pipe(
    z.array(
      z.url({ protocol: /^https?$/ }).refine((origin) => URL.parse(origin)?.origin === origin, {
        message: 'Origin must be scheme://host[:port] with no path or trailing slash',
      }),
    ),
  );
export * from './operations.js';
export * from './mobile.js';
export * from './assessment.js';
