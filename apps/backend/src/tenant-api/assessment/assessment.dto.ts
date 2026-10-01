import {
  COMPONENT_NAME_MAX,
  EXAM_DESCRIPTION_MAX,
  EXAM_NAME_MAX,
  FEEDBACK_MAX,
  GRADE_LABEL_MAX,
  MARKS_PATTERN,
  PERCENT_PATTERN,
  REASON_MAX,
  REMARK_MAX,
} from '@acadlyx/validation';
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
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsIsoDateOnly } from '../people/people.dto.js';

/* Shape/length validation only; the services enforce every business rule. */
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class VersionOnlyDto {
  @Type(() => Number) @IsInt() @Min(0) expectedVersion: number;
}

export class ExamListQueryDto {
  @IsOptional() @IsUUID() academicYearId?: string;
  @IsOptional()
  @IsIn(['DRAFT', 'PUBLISHED', 'MARKS_ENTRY', 'MARKS_FINALIZED', 'RESULTS_PUBLISHED', 'ARCHIVED'])
  status?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

export class SheetListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

export class CreateExamDto {
  @IsUUID() academicYearId: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(EXAM_NAME_MAX) name: string;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(EXAM_DESCRIPTION_MAX)
  description?: string | null;
  @IsIsoDateOnly() startDate: string;
  @IsIsoDateOnly() endDate: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() gradeScaleId?: string | null;
}

export class UpdateExamDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(EXAM_NAME_MAX) name?: string;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(EXAM_DESCRIPTION_MAX)
  description?: string | null;
  @IsOptional() @IsIsoDateOnly() startDate?: string;
  @IsOptional() @IsIsoDateOnly() endDate?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() gradeScaleId?: string | null;
  @Type(() => Number) @IsInt() @Min(1) expectedVersion: number;
}

export class AddExamSubjectDto {
  @IsUUID() gradeId: string;
  @IsUUID() subjectId: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(MARKS_PATTERN) passMarks?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) displayOrder?: number;
}

export class UpdateExamSubjectDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(MARKS_PATTERN) passMarks?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) displayOrder?: number;
}

export class ComponentDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(COMPONENT_NAME_MAX) name: string;
  @Matches(MARKS_PATTERN) maxMarks: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(MARKS_PATTERN) passMarks?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) displayOrder?: number;
}

export class UpdateComponentDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(COMPONENT_NAME_MAX)
  name?: string;
  @IsOptional() @Matches(MARKS_PATTERN) maxMarks?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(MARKS_PATTERN) passMarks?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) displayOrder?: number;
}

export class ScheduleDto {
  @IsIsoDateOnly() examDate: string;
  @Matches(TIME) startTime: string;
  @Matches(TIME) endTime: string;
}

export class GradeBandDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(GRADE_LABEL_MAX) label: string;
  @Matches(PERCENT_PATTERN) minPercentage: string;
  @Matches(PERCENT_PATTERN) maxPercentage: string;
}

export class GradeScaleDto {
  @IsUUID() academicYearId: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(60) name: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => GradeBandDto)
  bands: GradeBandDto[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) expectedVersion?: number;
}

export class GradeScaleQueryDto {
  @IsUUID() academicYearId: string;
}

export class MarkEntryDto {
  @IsUUID() studentId: string;
  @IsUUID() componentId: string;
  @IsIn(['MARKED', 'ABSENT', 'EXEMPT']) status: 'MARKED' | 'ABSENT' | 'EXEMPT';
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(12) marks?: string | null;
}

export class SaveMarksDto {
  @Type(() => Number) @IsInt() @Min(0) expectedVersion: number;
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => MarkEntryDto)
  entries: MarkEntryDto[];
}

export class ReopenDto extends VersionOnlyDto {
  @IsString() @MaxLength(REASON_MAX) reason: string;
}

export class ResultsQueryDto {
  @IsOptional() @IsUUID() sectionId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}

export class RemarkDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(REMARK_MAX) remark?:
    string | null;
}

export class SaveGradeDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsString()
  @MaxLength(12)
  marksAwarded?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(FEEDBACK_MAX) feedback?:
    string | null;
  @Type(() => Number) @IsInt() @Min(0) expectedVersion: number;
}
