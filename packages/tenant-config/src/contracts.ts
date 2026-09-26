/**
 * API contracts for tenant management (platform scope) and tenant bootstrap (tenant scope).
 * Dates are ISO-8601 strings on the wire.
 */
import type { ConfigurationKey } from './configuration.js';
import type { FeatureKey } from './features.js';
import type { TenantLifecycleAction, TenantStatus } from './lifecycle.js';

export const TENANT_DOMAIN_TYPES = ['PLATFORM_SUBDOMAIN', 'CUSTOM', 'ADMIN'] as const;
export type TenantDomainType = (typeof TENANT_DOMAIN_TYPES)[number];

/** Public identifier header for branded mobile builds. NOT a secret, NOT authentication. */
export const TENANT_KEY_HEADER = 'x-acadlyx-tenant-key';

/** Machine-readable error codes returned in ApiErrorResponse.code. */
export const TENANT_ERROR_CODES = {
  NOT_FOUND: 'TENANT_NOT_FOUND',
  UNAVAILABLE: 'TENANT_UNAVAILABLE',
  CONFLICT: 'TENANT_CONFLICT',
  KEY_TAKEN: 'TENANT_KEY_TAKEN',
  SLUG_TAKEN: 'TENANT_SLUG_TAKEN',
  SLUG_LOCKED: 'TENANT_SLUG_LOCKED',
  INVALID_TRANSITION: 'INVALID_STATUS_TRANSITION',
  DOMAIN_TAKEN: 'DOMAIN_TAKEN',
  DOMAIN_NOT_FOUND: 'DOMAIN_NOT_FOUND',
  UNKNOWN_FEATURE: 'UNKNOWN_FEATURE',
  UNKNOWN_CONFIGURATION_KEY: 'UNKNOWN_CONFIGURATION_KEY',
  INVALID_CONFIGURATION_VALUE: 'INVALID_CONFIGURATION_VALUE',
  BRANDING_NOT_FOUND: 'BRANDING_NOT_FOUND',
} as const;

export interface TenantBranding {
  schoolName: string;
  shortName: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string | null;
  accentColor: string | null;
  backgroundImageUrl: string | null;
  loginImageUrl: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  websiteUrl: string | null;
  footerText: string | null;
}

export interface TenantDomain {
  id: string;
  domain: string;
  type: TenantDomainType;
  isPrimary: boolean;
  verifiedAt: string | null;
  createdAt: string;
}

export interface TenantFeatureState {
  key: FeatureKey;
  label: string;
  group: string;
  enabled: boolean;
  updatedAt: string | null;
}

export interface TenantConfigurationEntry {
  key: ConfigurationKey;
  label: string;
  description: string;
  category: string;
  input: 'text' | 'select' | 'number';
  options: string[] | null;
  value: unknown;
  isDefault: boolean;
  updatedAt: string | null;
}

export interface TenantSummary {
  id: string;
  key: string;
  slug: string;
  displayName: string;
  status: TenantStatus;
  primaryDomain: string | null;
  createdAt: string;
}

export interface TenantDetail extends TenantSummary {
  legalName: string | null;
  firstActivatedAt: string | null;
  archivedAt: string | null;
  updatedAt: string;
  slugLocked: boolean;
  availableActions: TenantLifecycleAction[];
  domains: TenantDomain[];
  branding: TenantBranding | null;
  enabledFeatures: FeatureKey[];
  configurationOverrides: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface TenantStats {
  total: number;
  byStatus: Record<TenantStatus, number>;
}

export interface TenantListQuery {
  search?: string;
  status?: TenantStatus;
  page?: number;
  pageSize?: number;
}

/** Public-safe tenant information for white-label clients. No internal ids or private config. */
export interface TenantBootstrap {
  key: string;
  slug: string;
  displayName: string;
  branding: TenantBranding | null;
  enabledFeatures: FeatureKey[];
  settings: Partial<Record<ConfigurationKey, unknown>>;
}
