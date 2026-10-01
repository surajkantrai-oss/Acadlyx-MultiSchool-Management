import type { Paginated } from '@acadlyx/tenant-config';
import type {
  AssignmentSubmissionList,
  MobileAttendanceDay,
  MobileChild,
  MobileMe,
  MobileStudentHome,
  MobileWorkItem,
  MobileWorkScope,
  PublishedResultSummary,
  ReportCard,
  StudentAttendanceSummary,
  TimetableWeek,
} from '@acadlyx/types';
import { SUBMISSION_TEXT_MAX, SUBMISSION_URL_MAX } from '@acadlyx/validation';
import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  Authenticated,
  RequirePermission,
  TenantScoped,
} from '../../auth/core/access.decorators.js';
import { MobileService } from './mobile.service.js';
import { SubmissionsService } from './submissions.service.js';

/*
 * Phase 8 mobile API (decision J). Parent/Student routes are "any authenticated tenant user"
 * at the guard, then authorised in the service by the caller's OWN profile/relationship — no
 * school-level read permission is granted to Parents or Students. Teacher submission reads reuse
 * the Phase 7 `assignment.read` permission + Section/Subject scope.
 */
const Id = (name = 'id') => Param(name, new ParseUUIDPipe());

export class MobilePageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize?: number;
}

export class MobileWorkQueryDto extends MobilePageDto {
  @IsOptional() @IsIn(['current', 'past']) scope?: MobileWorkScope;
}

export class SubmitAssignmentDto {
  // Shape/length only here; the shared submission schema is authoritative in the service.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(SUBMISSION_TEXT_MAX)
  text?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(SUBMISSION_URL_MAX)
  url?: string | null;
  @Type(() => Number) @IsInt() @Min(0) expectedVersion: number;
}

@TenantScoped()
@Controller('mobile')
export class MobileMeController {
  constructor(private readonly mobile: MobileService) {}

  @Authenticated('TENANT')
  @Get('me')
  me(): Promise<MobileMe> {
    return this.mobile.me();
  }
}

@TenantScoped()
@Controller('mobile/parent')
export class MobileParentController {
  constructor(private readonly mobile: MobileService) {}

  @Authenticated('TENANT')
  @Get('children')
  children(): Promise<MobileChild[]> {
    return this.mobile.children();
  }

  @Authenticated('TENANT')
  @Get('children/:studentId/home')
  home(@Id('studentId') studentId: string): Promise<MobileStudentHome> {
    return this.mobile.home({ kind: 'PARENT', studentId });
  }

  @Authenticated('TENANT')
  @Get('children/:studentId/attendance')
  attendance(@Id('studentId') studentId: string): Promise<StudentAttendanceSummary | null> {
    return this.mobile.attendance({ kind: 'PARENT', studentId });
  }

  @Authenticated('TENANT')
  @Get('children/:studentId/attendance/days')
  attendanceDays(
    @Id('studentId') studentId: string,
    @Query() q: MobilePageDto,
  ): Promise<Paginated<MobileAttendanceDay>> {
    return this.mobile.attendanceDays({ kind: 'PARENT', studentId }, q.page ?? 1, q.pageSize ?? 20);
  }

  @Authenticated('TENANT')
  @Get('children/:studentId/homework')
  listHomework(
    @Id('studentId') studentId: string,
    @Query() q: MobileWorkQueryDto,
  ): Promise<Paginated<MobileWorkItem>> {
    return this.mobile.work(
      { kind: 'PARENT', studentId },
      'homework',
      q.scope ?? 'current',
      q.page ?? 1,
      q.pageSize ?? 20,
    );
  }

  @Authenticated('TENANT')
  @Get('children/:studentId/homework/:id')
  getHomework(@Id('studentId') studentId: string, @Id() id: string): Promise<MobileWorkItem> {
    return this.mobile.workItem({ kind: 'PARENT', studentId }, 'homework', id);
  }

  @Authenticated('TENANT')
  @Get('children/:studentId/assignments')
  listAssignments(
    @Id('studentId') studentId: string,
    @Query() q: MobileWorkQueryDto,
  ): Promise<Paginated<MobileWorkItem>> {
    return this.mobile.work(
      { kind: 'PARENT', studentId },
      'assignments',
      q.scope ?? 'current',
      q.page ?? 1,
      q.pageSize ?? 20,
    );
  }

  @Authenticated('TENANT')
  @Get('children/:studentId/assignments/:id')
  getAssignments(@Id('studentId') studentId: string, @Id() id: string): Promise<MobileWorkItem> {
    return this.mobile.workItem({ kind: 'PARENT', studentId }, 'assignments', id);
  }

  @Authenticated('TENANT')
  @Get('children/:studentId/results')
  results(@Id('studentId') studentId: string): Promise<PublishedResultSummary[]> {
    return this.mobile.results({ kind: 'PARENT', studentId });
  }

  @Authenticated('TENANT')
  @Get('children/:studentId/results/:examId')
  reportCard(
    @Id('studentId') studentId: string,
    @Id('examId') examId: string,
  ): Promise<ReportCard> {
    return this.mobile.reportCard({ kind: 'PARENT', studentId }, examId);
  }

  @Authenticated('TENANT')
  @Get('children/:studentId/timetable')
  timetable(@Id('studentId') studentId: string): Promise<TimetableWeek> {
    return this.mobile.timetable({ kind: 'PARENT', studentId });
  }
}

@TenantScoped()
@Controller('mobile/student')
export class MobileStudentController {
  constructor(
    private readonly mobile: MobileService,
    private readonly submissions: SubmissionsService,
  ) {}

  @Authenticated('TENANT')
  @Get('home')
  home(): Promise<MobileStudentHome> {
    return this.mobile.home({ kind: 'STUDENT' });
  }

  @Authenticated('TENANT')
  @Get('attendance')
  attendance(): Promise<StudentAttendanceSummary | null> {
    return this.mobile.attendance({ kind: 'STUDENT' });
  }

  @Authenticated('TENANT')
  @Get('attendance/days')
  attendanceDays(@Query() q: MobilePageDto): Promise<Paginated<MobileAttendanceDay>> {
    return this.mobile.attendanceDays({ kind: 'STUDENT' }, q.page ?? 1, q.pageSize ?? 20);
  }

  @Authenticated('TENANT')
  @Get('homework')
  listHomework(@Query() q: MobileWorkQueryDto): Promise<Paginated<MobileWorkItem>> {
    return this.mobile.work(
      { kind: 'STUDENT' },
      'homework',
      q.scope ?? 'current',
      q.page ?? 1,
      q.pageSize ?? 20,
    );
  }

  @Authenticated('TENANT')
  @Get('homework/:id')
  getHomework(@Id() id: string): Promise<MobileWorkItem> {
    return this.mobile.workItem({ kind: 'STUDENT' }, 'homework', id);
  }

  @Authenticated('TENANT')
  @Get('assignments')
  listAssignments(@Query() q: MobileWorkQueryDto): Promise<Paginated<MobileWorkItem>> {
    return this.mobile.work(
      { kind: 'STUDENT' },
      'assignments',
      q.scope ?? 'current',
      q.page ?? 1,
      q.pageSize ?? 20,
    );
  }

  @Authenticated('TENANT')
  @Get('assignments/:id')
  getAssignments(@Id() id: string): Promise<MobileWorkItem> {
    return this.mobile.workItem({ kind: 'STUDENT' }, 'assignments', id);
  }

  @Authenticated('TENANT')
  @Put('assignments/:id/submission')
  submit(@Id() id: string, @Body() body: SubmitAssignmentDto): Promise<MobileWorkItem> {
    return this.submissions.submit(id, body);
  }

  @Authenticated('TENANT')
  @Get('timetable')
  timetable(): Promise<TimetableWeek> {
    return this.mobile.timetable({ kind: 'STUDENT' });
  }

  @Authenticated('TENANT')
  @Get('results')
  results(): Promise<PublishedResultSummary[]> {
    return this.mobile.results({ kind: 'STUDENT' });
  }

  @Authenticated('TENANT')
  @Get('results/:examId')
  reportCard(@Id('examId') examId: string): Promise<ReportCard> {
    return this.mobile.reportCard({ kind: 'STUDENT' }, examId);
  }
}

@TenantScoped()
@Controller('mobile/teacher')
export class MobileTeacherController {
  constructor(private readonly submissions: SubmissionsService) {}

  @RequirePermission('assignment.read')
  @Get('assignments/:id/submissions')
  submissionsOf(@Id() id: string): Promise<AssignmentSubmissionList> {
    return this.submissions.list(id);
  }
}

export const MOBILE_CONTROLLERS = [
  MobileMeController,
  MobileParentController,
  MobileStudentController,
  MobileTeacherController,
];
export const MOBILE_PROVIDERS = [MobileService, SubmissionsService];
