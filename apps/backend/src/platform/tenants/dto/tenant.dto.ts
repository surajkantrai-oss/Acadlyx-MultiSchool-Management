import {
  TENANT_DOMAIN_TYPES,
  TENANT_STATUSES,
  type TenantDomainType,
  type TenantStatus,
} from '@acadlyx/tenant-config';
import {
  DOMAIN_MESSAGE,
  DOMAIN_PATTERN,
  HEX_COLOR_MESSAGE,
  HEX_COLOR_PATTERN,
  normalizeDomain,
  PHONE_MESSAGE,
  PHONE_PATTERN,
  PLAIN_TEXT_MESSAGE,
  PLAIN_TEXT_PATTERN,
  TENANT_KEY_MESSAGE,
  TENANT_KEY_PATTERN,
  TENANT_SLUG_MESSAGE,
  TENANT_SLUG_PATTERN,
} from '@acadlyx/validation';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
  Min,
  Max,
  ValidateIf,
} from 'class-validator';

/*
 * Authoritative server-side validation. Patterns come from @acadlyx/validation so the web
 * forms and the API enforce identical rules. Unknown fields are rejected globally
 * (ValidationPipe forbidNonWhitelisted), which also makes `key` immutable on PATCH.
 */

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};
const HTTPS_URL: Parameters<typeof IsUrl>[0] = {
  protocols: ['https'],
  require_protocol: true,
  require_tld: true,
};
const HTTPS_MESSAGE = { message: '$property must be an https:// URL' };

export class CreateTenantDto {
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  displayName: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  legalName?: string;

  @IsString()
  @Matches(TENANT_KEY_PATTERN, { message: TENANT_KEY_MESSAGE })
  key: string;

  @IsString()
  @Matches(TENANT_SLUG_PATTERN, { message: TENANT_SLUG_MESSAGE })
  slug: string;

  @IsOptional()
  @IsIn(['DRAFT', 'ACTIVE'])
  initialStatus?: 'DRAFT' | 'ACTIVE';
}

export class UpdateTenantDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  displayName?: string;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Length(1, 200)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  legalName?: string | null;

  @IsOptional()
  @IsString()
  @Matches(TENANT_SLUG_PATTERN, { message: TENANT_SLUG_MESSAGE })
  slug?: string;
}

export class ListTenantsQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(TENANT_STATUSES)
  status?: TenantStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class AddDomainDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeDomain(value) : value,
  )
  @IsString()
  @Matches(DOMAIN_PATTERN, { message: DOMAIN_MESSAGE })
  domain: string;

  @IsIn(TENANT_DOMAIN_TYPES)
  type: TenantDomainType;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateDomainDto {
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  /** Manual verification flag (no DNS automation yet). true sets verified_at; false clears it. */
  @IsOptional()
  @IsBoolean()
  verified?: boolean;
}

export class UpdateBrandingDto {
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  schoolName: string;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Length(1, 40)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  shortName?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_o, v) => v !== null)
  @IsUrl(HTTPS_URL, HTTPS_MESSAGE)
  @MaxLength(2048)
  logoUrl?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_o, v) => v !== null)
  @IsUrl(HTTPS_URL, HTTPS_MESSAGE)
  @MaxLength(2048)
  faviconUrl?: string | null;

  @IsString()
  @Matches(HEX_COLOR_PATTERN, { message: HEX_COLOR_MESSAGE })
  primaryColor: string;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(HEX_COLOR_PATTERN, { message: HEX_COLOR_MESSAGE })
  secondaryColor?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(HEX_COLOR_PATTERN, { message: HEX_COLOR_MESSAGE })
  accentColor?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_o, v) => v !== null)
  @IsUrl(HTTPS_URL, HTTPS_MESSAGE)
  @MaxLength(2048)
  backgroundImageUrl?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_o, v) => v !== null)
  @IsUrl(HTTPS_URL, HTTPS_MESSAGE)
  @MaxLength(2048)
  loginImageUrl?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_o, v) => v !== null)
  @IsEmail()
  @MaxLength(254)
  supportEmail?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  supportPhone?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_o, v) => v !== null)
  @IsUrl(HTTPS_URL, HTTPS_MESSAGE)
  @MaxLength(2048)
  websiteUrl?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Length(1, 200)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  footerText?: string | null;
}

export class SetFeatureDto {
  @IsBoolean()
  enabled: boolean;
}

export class SetConfigurationDto {
  /** Validated against the key's schema in CONFIGURATION_REGISTRY by the service. */
  @IsDefined()
  value: unknown;
}
