import {
  ASSIGNMENT_STATUSES,
  ATTENDANCE_MAX_RECORDS,
  ATTENDANCE_NOTE_MAX,
  ATTENDANCE_STATUSES,
  CLASSWORK_INSTRUCTIONS_MAX,
  CLASSWORK_TITLE_MAX,
  HOMEWORK_STATUSES,
  TIME_PATTERN,
  TIMETABLE_PERIOD_TYPES,
} from '@acadlyx/validation';
import type { AttendanceStatus, TimetablePeriodType, Weekday } from '@acadlyx/types';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsIsoDateOnly, PagingQueryDto } from '../people/people.dto.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;
const WEEKDAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;

// ---- Attendance ------------------------------------------------------------------------------

export class AttendanceClassesQueryDto {
  @IsOptional() @IsUUID() academicYearId?: string;
  @IsOptional() @IsUUID() branchId?: string;
}

export class AttendanceSheetQueryDto {
  @IsOptional() @IsIsoDateOnly() date?: string;
}

export class AttendanceHistoryQueryDto extends PagingQueryDto {
  @IsOptional() @IsIsoDateOnly() from?: string;
  @IsOptional() @IsIsoDateOnly() to?: string;
}

export class AttendanceMarkDto {
  @IsUUID() studentId: string;
  @IsIn(ATTENDANCE_STATUSES) status: AttendanceStatus;
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(ATTENDANCE_NOTE_MAX)
  note?: string | null;
}

export class SaveAttendanceDto {
  @IsUUID() sectionId: string;
  @IsIsoDateOnly() date: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) expectedVersion?: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ATTENDANCE_MAX_RECORDS)
  @ValidateNested({ each: true })
  @Type(() => AttendanceMarkDto)
  records: AttendanceMarkDto[];
}

// ---- Homework & assignments ------------------------------------------------------------------

export class ClassworkQueryDto extends PagingQueryDto {
  @IsOptional() @IsIn([...new Set([...HOMEWORK_STATUSES, ...ASSIGNMENT_STATUSES])]) status?: string;
  @IsOptional() @IsUUID() sectionId?: string;
  @IsOptional() @IsUUID() subjectId?: string;
  @IsOptional() @IsUUID() teacherId?: string;
  @IsOptional() @IsUUID() academicYearId?: string;
  @IsOptional() @IsIsoDateOnly() dueFrom?: string;
  @IsOptional() @IsIsoDateOnly() dueTo?: string;
}

class ClassworkFields {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(CLASSWORK_TITLE_MAX) title: string;
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(CLASSWORK_INSTRUCTIONS_MAX)
  instructions?: string | null;
  @IsIsoDateOnly() assignedDate: string;
  @IsIsoDateOnly() dueDate: string;
  /** Leadership only; ignored for teachers (always themselves). */
  @IsOptional() @IsUUID() teacherId?: string | null;
}

export class CreateClassworkDto extends ClassworkFields {
  @IsUUID() sectionId: string;
  @IsUUID() subjectId: string;
}

export class UpdateClassworkDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(CLASSWORK_TITLE_MAX)
  title?: string;
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(CLASSWORK_INSTRUCTIONS_MAX)
  instructions?: string | null;
  @IsOptional() @IsIsoDateOnly() assignedDate?: string;
  @IsOptional() @IsIsoDateOnly() dueDate?: string;
  @IsOptional() @IsUUID() teacherId?: string | null;
  @Type(() => Number) @IsInt() @Min(1) expectedVersion: number;
}

export class VersionDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion: number;
}

// ---- Timetable -------------------------------------------------------------------------------

export class PeriodListQueryDto {
  @IsUUID() branchId: string;
  @IsUUID() academicYearId: string;
}

export class CreatePeriodDto {
  @IsUUID() branchId: string;
  @IsUUID() academicYearId: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(60) name: string;
  @IsIn(TIMETABLE_PERIOD_TYPES) type: TimetablePeriodType;
  @Matches(TIME_PATTERN, { message: 'startTime must be HH:MM (24h)' }) startTime: string;
  @Matches(TIME_PATTERN, { message: 'endTime must be HH:MM (24h)' }) endTime: string;
}

export class UpdatePeriodDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(60) name?: string;
  @IsOptional() @IsIn(TIMETABLE_PERIOD_TYPES) type?: TimetablePeriodType;
  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'startTime must be HH:MM (24h)' })
  startTime?: string;
  @IsOptional() @Matches(TIME_PATTERN, { message: 'endTime must be HH:MM (24h)' }) endTime?: string;
}

export class ReorderPeriodsDto {
  @IsUUID() branchId: string;
  @IsUUID() academicYearId: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @IsUUID('all', { each: true }) ids: string[];
}

export class CreateEntryDto {
  @IsUUID() sectionId: string;
  @IsUUID() periodId: string;
  @IsIn(WEEKDAYS) weekday: Weekday;
  @IsUUID() subjectId: string;
  @IsUUID() teacherId: string;
}

export class UpdateEntryDto {
  @IsOptional() @IsUUID() periodId?: string;
  @IsOptional() @IsIn(WEEKDAYS) weekday?: Weekday;
  @IsOptional() @IsUUID() subjectId?: string;
  @IsOptional() @IsUUID() teacherId?: string;
}

export class WeekQueryDto {
  @IsOptional() @IsUUID() academicYearId?: string;
}
