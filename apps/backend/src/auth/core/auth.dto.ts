import { Type } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/*
 * Auth request DTOs. Secrets are length-bounded strings only — never logged (see logger redaction)
 * and never echoed. Unknown fields are rejected globally.
 */

export class DeviceDto {
  /** App-generated random installation ID (UUID-like); not a hardware identifier. */
  @IsString()
  @Matches(/^[A-Za-z0-9-]{16,64}$/)
  installationId: string;

  @IsIn(['IOS', 'ANDROID', 'WEB'])
  platform: 'IOS' | 'ANDROID' | 'WEB';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[^<>]*$/)
  label?: string;
}

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  identifier: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  secret: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceDto)
  device?: DeviceDto;
}

export class PlatformLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceDto)
  device?: DeviceDto;
}

export class RefreshDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{20,128}$/)
  refreshToken: string;
}

export class MfaVerifyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  mfaToken: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  recoveryCode?: string;
}

export class MfaTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  mfaToken: string;
}

export class MfaEnrollConfirmDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  mfaToken: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}

export class TotpCodeDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}

export class RemoveMfaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentSecret: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}

export class OtpStartDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  identifier: string;
}

export class OtpVerifyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  identifier: string;

  @IsString()
  @Matches(/^[A-Za-z0-9 -]{6,16}$/)
  code: string;
}

export class SetCredentialDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  grantToken: string;

  @IsIn(['PASSWORD', 'PIN'])
  credentialType: 'PASSWORD' | 'PIN';

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  secret: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceDto)
  device?: DeviceDto;
}

export class ChangeCredentialDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentSecret: string;

  @IsIn(['PASSWORD', 'PIN'])
  credentialType: 'PASSWORD' | 'PIN';

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  newSecret: string;
}

export class IdentifierChangeStartDto {
  @IsIn(['phone', 'email'])
  kind: 'phone' | 'email';

  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  value: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentSecret: string;
}

export class IdentifierChangeVerifyDto {
  @IsIn(['phone', 'email'])
  kind: 'phone' | 'email';

  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}
