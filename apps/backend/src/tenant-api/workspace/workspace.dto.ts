import { ACCOUNT_STATES, SEARCH_MAX_LENGTH } from '@acadlyx/validation';
import type { AccountState, ProfileKind } from '@acadlyx/types';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PagingQueryDto } from '../people/people.dto.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Academic context from the UI (URL/cookie). A convenience filter only: ids are re-validated
 * against the caller's school on every request and never replace tenant/permission checks.
 */
export class WorkspaceContextDto {
  @IsOptional() @IsUUID() academicYearId?: string;
  @IsOptional() @IsUUID() branchId?: string;
}

export class ClassListQueryDto extends WorkspaceContextDto {
  @IsOptional() @IsUUID() gradeId?: string;
}

export class SearchQueryDto {
  @Transform(trim)
  @IsString()
  @MaxLength(SEARCH_MAX_LENGTH)
  q: string;
}

export class AccessQueryDto extends PagingQueryDto {
  @IsIn(['students', 'parents', 'teachers']) kind: ProfileKind;
  @IsOptional()
  @IsIn(ACCOUNT_STATES.filter((s) => s !== 'ACTIVE'))
  state?: Exclude<AccountState, 'ACTIVE'>;
}
