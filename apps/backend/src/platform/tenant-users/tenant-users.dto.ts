import { TENANT_ROLE_KEYS } from '@acadlyx/permissions';
import { PLAIN_TEXT_MESSAGE, PLAIN_TEXT_PATTERN } from '@acadlyx/validation';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Create a school identity. Only the identifiers its roles need (Principal/Admin: email,
 * Teacher: employee ID or email, Parent: mobile, Student: admission ID). No profile fields.
 * Only built-in TENANT system roles are accepted — PLATFORM_ADMIN is rejected by validation.
 */
export class CreateTenantUserDto {
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  displayName: string;

  @IsOptional()
  @IsString()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  loginId?: string;

  @IsOptional()
  @IsIn(['STUDENT_ID', 'EMPLOYEE_ID'])
  loginIdKind?: 'STUDENT_ID' | 'EMPLOYEE_ID';

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(9)
  @ArrayUnique()
  @IsIn(TENANT_ROLE_KEYS, { each: true })
  roles: string[];
}

export class UpdateTenantUserDto {
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  displayName: string;
}

export class AssignRoleDto {
  @IsIn(TENANT_ROLE_KEYS)
  roleKey: string;
}

export class ListTenantUsersQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'DISABLED'])
  status?: 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';

  @IsOptional()
  @IsIn(TENANT_ROLE_KEYS)
  role?: string;

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
