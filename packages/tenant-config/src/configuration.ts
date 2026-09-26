/**
 * Typed tenant configuration registry.
 *
 * Configuration that is not branding, domains or features lives here as namespaced keys
 * (`<category>.<name>`). Each key declares its own zod schema and default; values are stored
 * as JSONB and validated on every write. Unknown keys are rejected, so the table can never
 * become an unstructured dumping ground. Add keys here in the phase that needs them.
 *
 * `public: true` keys may appear in the tenant bootstrap response; all others are private.
 */
import { z } from '@acadlyx/validation';

const ianaTimezone = z
  .string()
  .max(64)
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Must be a valid IANA time zone, e.g. Asia/Kolkata' },
  );

export const CONFIGURATION_REGISTRY = {
  'general.timezone': {
    label: 'Time zone',
    description: 'IANA time zone used for school dates and schedules.',
    category: 'general',
    public: true,
    schema: ianaTimezone,
    defaultValue: 'Asia/Kolkata',
    input: 'text',
  },
  'general.locale': {
    label: 'Locale',
    description: 'Default language/region for formatting.',
    category: 'general',
    public: true,
    schema: z.enum(['en-IN', 'en-US', 'en-GB', 'hi-IN']),
    defaultValue: 'en-IN',
    input: 'select',
  },
  'general.academic_year_start_month': {
    label: 'Academic year start month',
    description: 'Month (1–12) in which the academic year begins. Used from Phase 4.',
    category: 'general',
    public: false,
    schema: z.number().int().min(1).max(12),
    defaultValue: 4,
    input: 'number',
  },
} as const;

export type ConfigurationKey = keyof typeof CONFIGURATION_REGISTRY;
export type ConfigurationValue<K extends ConfigurationKey> = z.infer<
  (typeof CONFIGURATION_REGISTRY)[K]['schema']
>;

export const CONFIGURATION_KEYS = Object.keys(CONFIGURATION_REGISTRY) as ConfigurationKey[];

export function isConfigurationKey(value: string): value is ConfigurationKey {
  return Object.hasOwn(CONFIGURATION_REGISTRY, value);
}

/** Validates a value for `key`. Returns the parsed value or a list of messages. */
export function validateConfigurationValue(
  key: ConfigurationKey,
  value: unknown,
): { success: true; value: unknown } | { success: false; errors: string[] } {
  const result = CONFIGURATION_REGISTRY[key].schema.safeParse(value);
  return result.success
    ? { success: true, value: result.data }
    : { success: false, errors: result.error.issues.map((issue) => issue.message) };
}
