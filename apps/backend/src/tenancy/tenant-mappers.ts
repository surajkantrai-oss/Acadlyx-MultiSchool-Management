import type {
  TenantBranding as TenantBrandingDto,
  TenantDomain as TenantDomainDto,
} from '@acadlyx/tenant-config';
import type { TenantBranding, TenantDomain } from '../generated/prisma/client.js';

/** Maps DB rows to API contracts (explicit field lists: nothing leaks by accident). */
export function toBrandingDto(row: TenantBranding): TenantBrandingDto {
  return {
    schoolName: row.schoolName,
    shortName: row.shortName,
    logoUrl: row.logoUrl,
    faviconUrl: row.faviconUrl,
    primaryColor: row.primaryColor,
    secondaryColor: row.secondaryColor,
    accentColor: row.accentColor,
    backgroundImageUrl: row.backgroundImageUrl,
    loginImageUrl: row.loginImageUrl,
    supportEmail: row.supportEmail,
    supportPhone: row.supportPhone,
    websiteUrl: row.websiteUrl,
    footerText: row.footerText,
  };
}

export function toDomainDto(row: TenantDomain): TenantDomainDto {
  return {
    id: row.id,
    domain: row.domain,
    type: row.type,
    isPrimary: row.isPrimary,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
