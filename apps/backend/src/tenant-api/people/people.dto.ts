import {
  ACCOUNT_STATES,
  GUARDIAN_RELATIONSHIPS,
  IMPORT_TYPES,
  isIsoDate,
  PERSON_ID_MESSAGE,
  PERSON_ID_PATTERN,
  PHONE_MESSAGE,
  PHONE_PATTERN,
  PLAIN_TEXT_MESSAGE,
  PLAIN_TEXT_PATTERN,
  STUDENT_STATUSES,
  TEACHER_ASSIGNMENT_TYPES,
  TEACHER_STATUSES,
} from '@acadlyx/validation';
import type {
  AccountState,
  GuardianRelationship,
  ImportType,
  StudentQualityFilter,
  StudentStatus,
  TeacherAssignmentType,
  TeacherQualityFilter,
  TeacherStatus,
} from '@acadlyx/types';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  registerDecorator,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const personId = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const optional = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? null : t;
};
const optionalPersonId = ({ value }: { value: unknown }) => {
  const v = optional({ value });
  return typeof v === 'string' ? v.toUpperCase() : v;
};
const present = (_: object, value: unknown) => value !== null && value !== undefined;

function IsIsoDateOnly() {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isIsoDateOnly',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} must be a valid date (YYYY-MM-DD)` },
      validator: { validate: (v: unknown) => typeof v === 'string' && isIsoDate(v) },
    });
  };
}

class NameFields {
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  firstName: string;

  @IsOptional()
  @Transform(optional)
  @ValidateIf(present)
  @IsString()
  @MaxLength(80)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  middleName?: string | null;

  @IsOptional()
  @Transform(optional)
  @ValidateIf(present)
  @IsString()
  @MaxLength(80)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  lastName?: string | null;
}

class PartialNameFields {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  firstName?: string;

  @IsOptional()
  @Transform(optional)
  @ValidateIf(present)
  @IsString()
  @MaxLength(80)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  middleName?: string | null;

  @IsOptional()
  @Transform(optional)
  @ValidateIf(present)
  @IsString()
  @MaxLength(80)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  lastName?: string | null;
}

class ContactFields {
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

export class PagingQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

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

// ---- Students --------------------------------------------------------------------------------

export class LinkGuardianDto {
  @IsUUID() parentId: string;
  @IsIn(GUARDIAN_RELATIONSHIPS) relationship: GuardianRelationship;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsBoolean() pickupAuthorized?: boolean;
  @IsOptional() @IsBoolean() isEmergencyContact?: boolean;
}

export class UpdateGuardianDto {
  @IsOptional() @IsIn(GUARDIAN_RELATIONSHIPS) relationship?: GuardianRelationship;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsBoolean() pickupAuthorized?: boolean;
  @IsOptional() @IsBoolean() isEmergencyContact?: boolean;
}

export class EnrollmentPlacementDto {
  @IsUUID() sectionId: string;
  @IsOptional() @IsIsoDateOnly() startDate?: string;
}

export class CreateStudentDto extends NameFields {
  @Transform(personId)
  @IsString()
  @Matches(PERSON_ID_PATTERN, { message: PERSON_ID_MESSAGE })
  admissionNumber: string;

  @IsOptional()
  @Transform(optional)
  @ValidateIf(present)
  @IsString()
  @MaxLength(80)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  preferredName?: string | null;

  @IsOptional()
  @Transform(optional)
  @ValidateIf(present)
  @IsIsoDateOnly()
  dateOfBirth?: string | null;

  @IsOptional()
  @Transform(optional)
  @ValidateIf(present)
  @IsIsoDateOnly()
  admissionDate?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => EnrollmentPlacementDto)
  enrollment?: EnrollmentPlacementDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => LinkGuardianDto)
  guardians?: LinkGuardianDto[];
}

export class UpdateStudentDto extends PartialNameFields {
  @IsOptional()
  @Transform(personId)
  @IsString()
  @Matches(PERSON_ID_PATTERN, { message: PERSON_ID_MESSAGE })
  admissionNumber?: string;

  @IsOptional()
  @Transform(optional)
  @ValidateIf(present)
  @IsString()
  @MaxLength(80)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  preferredName?: string | null;

  @IsOptional()
  @Transform(optional)
  @ValidateIf(present)
  @IsIsoDateOnly()
  dateOfBirth?: string | null;

  @IsOptional()
  @Transform(optional)
  @ValidateIf(present)
  @IsIsoDateOnly()
  admissionDate?: string | null;
}

export class ChangeStudentStatusDto {
  @IsIn(STUDENT_STATUSES) status: StudentStatus;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  @Matches(PLAIN_TEXT_PATTERN, { message: PLAIN_TEXT_MESSAGE })
  reason?: string;
}

export class StudentListQueryDto extends PagingQueryDto {
  @IsOptional() @IsIn(STUDENT_STATUSES) status?: StudentStatus;
  @IsOptional() @IsUUID() academicYearId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() gradeId?: string;
  @IsOptional() @IsUUID() sectionId?: string;
  @IsOptional() @IsIn(ACCOUNT_STATES) account?: AccountState;
  @IsOptional() @IsIn(['NO_ENROLLMENT', 'NO_GUARDIAN']) quality?: StudentQualityFilter;
}

export class ParentListQueryDto extends PagingQueryDto {
  @IsOptional() @IsIn(ACCOUNT_STATES) account?: AccountState;
}

export class CreateEnrollmentDto {
  @IsUUID() sectionId: string;
  @IsOptional() @IsIsoDateOnly() startDate?: string;
}

export class TransferEnrollmentDto {
  @IsUUID() sectionId: string;
  @IsOptional() @IsIsoDateOnly() date?: string;
}

export class EndEnrollmentDto {
  @IsIn(['WITHDRAWN', 'COMPLETED']) status: 'WITHDRAWN' | 'COMPLETED';
  @IsOptional() @IsIsoDateOnly() date?: string;
}

// ---- Parents ---------------------------------------------------------------------------------

export class CreateParentDto extends NameFields {
  @IsOptional()
  @Transform(optionalPersonId)
  @ValidateIf(present)
  @IsString()
  @Matches(PERSON_ID_PATTERN, { message: PERSON_ID_MESSAGE })
  parentCode?: string | null;

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

export class UpdateParentDto extends PartialNameFields {
  @IsOptional()
  @Transform(optionalPersonId)
  @ValidateIf(present)
  @IsString()
  @Matches(PERSON_ID_PATTERN, { message: PERSON_ID_MESSAGE })
  parentCode?: string | null;

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

// ---- Teachers --------------------------------------------------------------------------------

export class CreateTeacherDto extends NameFields {
  @Transform(personId)
  @IsString()
  @Matches(PERSON_ID_PATTERN, { message: PERSON_ID_MESSAGE })
  employeeId: string;

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

  @IsOptional()
  @Transform(optional)
  @ValidateIf(present)
  @IsIsoDateOnly()
  joiningDate?: string | null;
}

export class UpdateTeacherDto extends PartialNameFields {
  @IsOptional()
  @Transform(personId)
  @IsString()
  @Matches(PERSON_ID_PATTERN, { message: PERSON_ID_MESSAGE })
  employeeId?: string;

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

  @IsOptional()
  @Transform(optional)
  @ValidateIf(present)
  @IsIsoDateOnly()
  joiningDate?: string | null;
}

export class TeacherListQueryDto extends PagingQueryDto {
  @IsOptional() @IsIn(TEACHER_STATUSES) status?: TeacherStatus;
  @IsOptional() @IsIn(ACCOUNT_STATES) account?: AccountState;
  @IsOptional() @IsIn(['NO_ASSIGNMENT']) quality?: TeacherQualityFilter;
}

export class TeacherStatusDto {
  @IsIn(TEACHER_STATUSES) status: TeacherStatus;
}

export class CreateAssignmentDto {
  @IsIn(TEACHER_ASSIGNMENT_TYPES) type: TeacherAssignmentType;
  @IsUUID() sectionId: string;
  @IsOptional() @IsUUID() subjectId?: string;
}

// ---- Accounts & imports ----------------------------------------------------------------------

export class LinkAccountDto {
  @IsUUID() userId: string;
}

export class UploadImportDto {
  @IsIn(IMPORT_TYPES) type: ImportType;
}

export class ImportRowsQueryDto {
  @IsOptional()
  @IsIn(['INVALID', 'VALID', 'SUCCEEDED', 'FAILED'])
  status?: 'INVALID' | 'VALID' | 'SUCCEEDED' | 'FAILED';

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
  @Max(200)
  pageSize?: number;
}

export { ContactFields };
