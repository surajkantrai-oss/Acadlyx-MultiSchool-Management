import {
  ACADEMIC_CODE_MESSAGE,
  ACADEMIC_CODE_PATTERN,
  COUNTRY_CODE_MESSAGE,
  COUNTRY_CODE_PATTERN,
  isIanaTimezone,
  isIsoDate,
  PHONE_MESSAGE,
  PHONE_PATTERN,
  PLAIN_TEXT_MESSAGE,
  PLAIN_TEXT_PATTERN,
  POSTAL_CODE_MESSAGE,
  POSTAL_CODE_PATTERN,
  SCHOOL_BOARDS,
  WEEKDAYS,
} from '@acadlyx/validation';
import type { SchoolBoard, Weekday } from '@acadlyx/types';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';

// ---- Transforms: names are only trimmed (display text preserved); codes are upper-cased. ----
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const code = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
/** Optional text: '' → null (clear), undefined → unchanged. */
const optional = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? null : t;
};
const optionalUpper = ({ value }: { value: unknown }) => {
  const v = optional({ value });
  return typeof v === 'string' ? v.toUpperCase() : v;
};
/** Validate only when a value (not null) is present. */
const present = (_: object, value: unknown) => value !== null && value !== undefined;

function IsIanaTimezone(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isIanaTimezone',
      target: object.constructor,
      propertyName,
      options: { message: 'Must be a valid IANA time zone, e.g. Asia/Kolkata', ...options },
      validator: { validate: (v: unknown) => typeof v === 'string' && isIanaTimezone(v) },
    });
  };
}

function IsIsoDateOnly(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isIsoDateOnly',
      target: object.constructor,
      propertyName,
      options: { message: 'Must be a valid date (YYYY-MM-DD)', ...options },
      validator: { validate: (v: unknown) => typeof v === 'string' && isIsoDate(v) },
    });
  };
}

class AddressFields {
  @IsOptional()
  @Transform(optional)
  @ValidateIf(present)
  @IsString()
  @MaxLength(200)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  addressLine1?: string | null;

  @IsOptional()
  @Transform(optional)
  @ValidateIf(present)
  @IsString()
  @MaxLength(200)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  addressLine2?: string | null;

  @IsOptional()
  @Transform(optional)
  @ValidateIf(present)
  @IsString()
  @MaxLength(100)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  city?: string | null;

  @IsOptional()
  @Transform(optional)
  @ValidateIf(present)
  @IsString()
  @MaxLength(100)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  state?: string | null;

  @IsOptional()
  @Transform(optional)
  @ValidateIf(present)
  @IsString()
  @Matches(POSTAL_CODE_PATTERN, { message: POSTAL_CODE_MESSAGE })
  postalCode?: string | null;

  @IsOptional()
  @Transform(optionalUpper)
  @ValidateIf(present)
  @IsString()
  @Matches(COUNTRY_CODE_PATTERN, { message: COUNTRY_CODE_MESSAGE })
  country?: string | null;

  @IsOptional()
  @Transform(optional)
  @ValidateIf(present)
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @Transform(optional)
  @ValidateIf(present)
  @IsString()
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone?: string | null;
}

// ---- School -----------------------------------------------------------------------------------

export class UpdateSchoolDto extends AddressFields {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 160)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  name?: string;

  @IsOptional()
  @Transform(optional)
  @ValidateIf(present)
  @IsString()
  @MaxLength(40)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  shortName?: string | null;

  @IsOptional()
  @Transform(optionalUpper)
  @ValidateIf(present)
  @IsString()
  @Matches(ACADEMIC_CODE_PATTERN, { message: ACADEMIC_CODE_MESSAGE })
  code?: string | null;

  @IsOptional()
  @ValidateIf(present)
  @IsIn(SCHOOL_BOARDS)
  board?: SchoolBoard | null;

  @IsOptional()
  @Transform(optional)
  @ValidateIf(present)
  @IsString()
  @MaxLength(100)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  boardName?: string | null;

  @IsOptional()
  @Transform(optional)
  @ValidateIf(present)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  website?: string | null;
}

export class UpdateAcademicSettingsDto {
  @IsOptional()
  @Transform(trim)
  @IsIanaTimezone()
  timezone?: string;

  @IsOptional()
  @IsIn(WEEKDAYS)
  weekStartDay?: Weekday;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsIn(WEEKDAYS, { each: true })
  workingDays?: Weekday[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  academicYearStartMonth?: number;
}

// ---- Branch -----------------------------------------------------------------------------------

export class CreateBranchDto extends AddressFields {
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  name: string;

  @Transform(code)
  @IsString()
  @Matches(ACADEMIC_CODE_PATTERN, { message: ACADEMIC_CODE_MESSAGE })
  code: string;

  /** Defaults to the school's academic-settings time zone. */
  @IsOptional()
  @Transform(trim)
  @IsIanaTimezone()
  timezone?: string;
}

export class UpdateBranchDto extends AddressFields {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  name?: string;

  @IsOptional()
  @Transform(code)
  @IsString()
  @Matches(ACADEMIC_CODE_PATTERN, { message: ACADEMIC_CODE_MESSAGE })
  code?: string;

  @IsOptional()
  @Transform(trim)
  @IsIanaTimezone()
  timezone?: string;
}

export class ListBranchesQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  active?: 'true' | 'false';
}

// ---- Academic year ----------------------------------------------------------------------------

export class CreateAcademicYearDto {
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  name: string;

  @IsIsoDateOnly()
  startDate: string;

  @IsIsoDateOnly()
  endDate: string;
}

export class UpdateAcademicYearDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  name?: string;

  @IsOptional()
  @IsIsoDateOnly()
  startDate?: string;

  @IsOptional()
  @IsIsoDateOnly()
  endDate?: string;
}

// ---- Grade / Section / Subject ----------------------------------------------------------------

export class CreateGradeDto {
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  name: string;

  @Transform(code)
  @IsString()
  @Matches(ACADEMIC_CODE_PATTERN, { message: ACADEMIC_CODE_MESSAGE })
  code: string;
}

export class UpdateGradeDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  name?: string;

  @IsOptional()
  @Transform(code)
  @IsString()
  @Matches(ACADEMIC_CODE_PATTERN, { message: ACADEMIC_CODE_MESSAGE })
  code?: string;
}

export class CreateSectionDto {
  @IsUUID()
  branchId: string;

  @IsUUID()
  academicYearId: string;

  @IsUUID()
  gradeId: string;

  @Transform(trim)
  @IsString()
  @Length(1, 40)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  name: string;

  @Transform(code)
  @IsString()
  @Matches(ACADEMIC_CODE_PATTERN, { message: ACADEMIC_CODE_MESSAGE })
  code: string;

  @IsOptional()
  @ValidateIf(present)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity?: number | null;
}

export class UpdateSectionDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  name?: string;

  @IsOptional()
  @Transform(code)
  @IsString()
  @Matches(ACADEMIC_CODE_PATTERN, { message: ACADEMIC_CODE_MESSAGE })
  code?: string;

  @IsOptional()
  @ValidateIf(present)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity?: number | null;
}

export class ListSectionsQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @IsOptional()
  @IsUUID()
  gradeId?: string;
}

export class ReorderSectionsDto {
  @IsUUID()
  branchId: string;

  @IsUUID()
  academicYearId: string;

  @IsUUID()
  gradeId: string;

  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids: string[];
}

export class ReorderDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids: string[];
}

export class CreateSubjectDto {
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  name: string;

  @Transform(code)
  @IsString()
  @Matches(ACADEMIC_CODE_PATTERN, { message: ACADEMIC_CODE_MESSAGE })
  code: string;
}

export class UpdateSubjectDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  name?: string;

  @IsOptional()
  @Transform(code)
  @IsString()
  @Matches(ACADEMIC_CODE_PATTERN, { message: ACADEMIC_CODE_MESSAGE })
  code?: string;
}

export class ListSubjectsQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  active?: 'true' | 'false';
}

export class AssignGradeSubjectDto {
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;
}
