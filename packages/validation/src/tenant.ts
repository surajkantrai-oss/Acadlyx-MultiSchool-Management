/**
 * Tenant identity, domain and branding validation (Phase 2).
 *
 * The regular expressions are exported so the backend's class-validator DTOs and these zod
 * schemas share one definition. The backend remains authoritative; frontends use the zod
 * schemas for early feedback only.
 */
import { z } from 'zod';

/** Machine key, e.g. `WORLD_WAY`: upper-case letters, digits, underscores; starts with a letter. */
export const TENANT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/;
export const TENANT_KEY_MESSAGE =
  'Tenant key must be 2–40 characters: A–Z, 0–9 and _, starting with a letter';

/** URL slug, e.g. `world-way`: lower-case letters, digits and single hyphens. */
export const TENANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,62}$/;
export const TENANT_SLUG_MESSAGE =
  'Slug must be 2–63 characters: a–z, 0–9 and single hyphens, not starting or ending with -';

/**
 * Normalised host name: lower-case labels separated by dots, at least two labels, no scheme,
 * port, path, whitespace or trailing dot; the last label must start with a letter (so IP
 * addresses never match). Validate AFTER normalizeDomain().
 */
export const DOMAIN_PATTERN =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const DOMAIN_MESSAGE =
  'Domain must be a host name like portal.school.com (no protocol, port, path or spaces)';

export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
export const HEX_COLOR_MESSAGE = 'Colour must be a 6-digit hex value like #1D4ED8';

export const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{6,19}$/;
export const PHONE_MESSAGE = 'Phone must contain 7–20 digits, spaces, hyphens or parentheses';

/** Free text shown in branded UIs must not carry markup. */
export const PLAIN_TEXT_PATTERN = /^[^<>]*$/;
export const PLAIN_TEXT_MESSAGE = 'Text must not contain < or > characters';

/** Case-only normalisation. Anything else malformed (scheme, path, spaces) must fail validation. */
export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

const plainText = (max: number) =>
  z.string().trim().min(1).max(max).regex(PLAIN_TEXT_PATTERN, PLAIN_TEXT_MESSAGE);

const httpsUrl = z.url({ protocol: /^https$/, message: 'Must be an https:// URL' }).max(2048);

export const tenantKeySchema = z.string().regex(TENANT_KEY_PATTERN, TENANT_KEY_MESSAGE);
export const tenantSlugSchema = z.string().regex(TENANT_SLUG_PATTERN, TENANT_SLUG_MESSAGE);
export const domainSchema = z
  .string()
  .transform(normalizeDomain)
  .pipe(z.string().regex(DOMAIN_PATTERN, DOMAIN_MESSAGE));
export const hexColorSchema = z.string().regex(HEX_COLOR_PATTERN, HEX_COLOR_MESSAGE);

export const createTenantSchema = z.object({
  displayName: plainText(120),
  legalName: plainText(200).optional(),
  key: tenantKeySchema,
  slug: tenantSlugSchema,
  initialStatus: z.enum(['DRAFT', 'ACTIVE']).default('DRAFT'),
});

export const updateTenantSchema = z.object({
  displayName: plainText(120).optional(),
  legalName: plainText(200).nullable().optional(),
  slug: tenantSlugSchema.optional(),
});

export const tenantBrandingSchema = z.object({
  schoolName: plainText(120),
  shortName: plainText(40).nullable().optional(),
  logoUrl: httpsUrl.nullable().optional(),
  faviconUrl: httpsUrl.nullable().optional(),
  primaryColor: hexColorSchema,
  secondaryColor: hexColorSchema.nullable().optional(),
  accentColor: hexColorSchema.nullable().optional(),
  backgroundImageUrl: httpsUrl.nullable().optional(),
  loginImageUrl: httpsUrl.nullable().optional(),
  supportEmail: z.email().max(254).nullable().optional(),
  supportPhone: z.string().regex(PHONE_PATTERN, PHONE_MESSAGE).nullable().optional(),
  websiteUrl: httpsUrl.nullable().optional(),
  footerText: plainText(200).nullable().optional(),
});

export type CreateTenantInput = z.input<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
export type TenantBrandingInput = z.infer<typeof tenantBrandingSchema>;
