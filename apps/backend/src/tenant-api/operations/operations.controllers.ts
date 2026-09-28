import type { Paginated } from '@acadlyx/tenant-config';
import type {
  AttendanceClass,
  AttendanceHistoryDay,
  AttendanceRecordChange,
  AttendanceSheet,
  ClassworkItem,
  ClassworkKind,
  ClassworkTarget,
  StudentAttendanceSummary,
  TimetableEntry,
  TimetablePeriod,
  TimetableWeek,
} from '@acadlyx/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RequirePermission, TenantScoped } from '../../auth/core/access.decorators.js';
import { AttendanceService } from './attendance.service.js';
import { ClassworkService } from './classwork.service.js';
import {
  AttendanceClassesQueryDto,
  AttendanceHistoryQueryDto,
  AttendanceSheetQueryDto,
  ClassworkQueryDto,
  CreateClassworkDto,
  CreateEntryDto,
  CreatePeriodDto,
  PeriodListQueryDto,
  ReorderPeriodsDto,
  SaveAttendanceDto,
  UpdateClassworkDto,
  UpdateEntryDto,
  UpdatePeriodDto,
  VersionDto,
  WeekQueryDto,
} from './operations.dto.js';
import { TimetableService } from './timetable.service.js';

/*
 * Academic operations API (Phase 7). Tenant-scoped; every route needs a tenant session, one named
 * permission AND the resource scope (teachers: their assigned sections/subjects). Other tenants',
 * other schools' and out-of-scope ids are 404.
 */
const Id = (name = 'id') => Param(name, new ParseUUIDPipe());

@TenantScoped()
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @RequirePermission('attendance.read')
  @Get('classes')
  classes(@Query() q: AttendanceClassesQueryDto): Promise<AttendanceClass[]> {
    return this.attendance.classes(q);
  }

  @RequirePermission('attendance.read')
  @Get('sections/:sectionId')
  sheet(
    @Id('sectionId') sectionId: string,
    @Query() q: AttendanceSheetQueryDto,
  ): Promise<AttendanceSheet> {
    return this.attendance.sheet(sectionId, q.date);
  }

  @RequirePermission('attendance.read')
  @Get('sections/:sectionId/history')
  history(
    @Id('sectionId') sectionId: string,
    @Query() q: AttendanceHistoryQueryDto,
  ): Promise<Paginated<AttendanceHistoryDay>> {
    return this.attendance.history(sectionId, q);
  }

  @RequirePermission('attendance.read')
  @Get('sections/:sectionId/changes')
  changes(
    @Id('sectionId') sectionId: string,
    @Query() q: AttendanceSheetQueryDto,
  ): Promise<AttendanceRecordChange[]> {
    return this.attendance.changes(sectionId, q.date ?? '');
  }

  /** Records (first save) or corrects (later saves) one class's attendance for one date. */
  @RequirePermission('attendance.manage')
  @Put()
  save(@Body() dto: SaveAttendanceDto): Promise<AttendanceSheet> {
    return this.attendance.save(dto);
  }

  @RequirePermission('attendance.read')
  @Get('students/:studentId')
  student(
    @Id('studentId') studentId: string,
    @Query() q: WeekQueryDto,
  ): Promise<StudentAttendanceSummary | null> {
    return this.attendance.studentSummary(studentId, q.academicYearId);
  }
}

/** Homework and Assignments share one service; the kind is fixed per controller. */
function classworkController(
  kind: ClassworkKind,
  read: 'homework.read' | 'assignment.read',
  manage: 'homework.manage' | 'assignment.manage',
) {
  @TenantScoped()
  @Controller(kind)
  class ClassworkController {
    constructor(readonly classwork: ClassworkService) {}

    @RequirePermission(read)
    @Get()
    list(@Query() q: ClassworkQueryDto): Promise<Paginated<ClassworkItem>> {
      return this.classwork.list(kind, q);
    }

    @RequirePermission(manage)
    @Get('targets')
    targets(): Promise<ClassworkTarget[]> {
      return this.classwork.targets();
    }

    @RequirePermission(read)
    @Get(':id')
    get(@Id() id: string): Promise<ClassworkItem> {
      return this.classwork.get(kind, id);
    }

    @RequirePermission(manage)
    @Post()
    create(@Body() dto: CreateClassworkDto): Promise<ClassworkItem> {
      return this.classwork.create(kind, dto);
    }

    @RequirePermission(manage)
    @Patch(':id')
    update(@Id() id: string, @Body() dto: UpdateClassworkDto): Promise<ClassworkItem> {
      return this.classwork.update(kind, id, dto);
    }

    @RequirePermission(manage)
    @Post(':id/publish')
    @HttpCode(HttpStatus.OK)
    publish(@Id() id: string, @Body() dto: VersionDto): Promise<ClassworkItem> {
      return this.classwork.transition(kind, id, 'PUBLISHED', dto.expectedVersion);
    }

    @RequirePermission(manage)
    @Post(':id/archive')
    @HttpCode(HttpStatus.OK)
    archive(@Id() id: string, @Body() dto: VersionDto): Promise<ClassworkItem> {
      return this.classwork.transition(kind, id, 'ARCHIVED', dto.expectedVersion);
    }

    @RequirePermission(manage)
    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    remove(@Id() id: string): Promise<void> {
      return this.classwork.remove(kind, id);
    }
  }
  return ClassworkController;
}

export const HomeworkController = classworkController(
  'homework',
  'homework.read',
  'homework.manage',
);

const AssignmentsBase = classworkController('assignments', 'assignment.read', 'assignment.manage');
@TenantScoped()
@Controller('assignments')
export class AssignmentsController extends AssignmentsBase {
  @RequirePermission('assignment.manage')
  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  close(@Id() id: string, @Body() dto: VersionDto): Promise<ClassworkItem> {
    return this.classwork.transition('assignments', id, 'CLOSED', dto.expectedVersion);
  }
}

@TenantScoped()
@Controller('timetable')
export class TimetableController {
  constructor(private readonly timetable: TimetableService) {}

  @RequirePermission('timetable.read')
  @Get('periods')
  periods(@Query() q: PeriodListQueryDto): Promise<TimetablePeriod[]> {
    return this.timetable.periods(q);
  }

  @RequirePermission('timetable.manage')
  @Post('periods')
  createPeriod(@Body() dto: CreatePeriodDto): Promise<TimetablePeriod> {
    return this.timetable.createPeriod(dto);
  }

  @RequirePermission('timetable.manage')
  @Put('periods/order')
  reorder(@Body() dto: ReorderPeriodsDto): Promise<TimetablePeriod[]> {
    return this.timetable.reorderPeriods(dto);
  }

  @RequirePermission('timetable.manage')
  @Patch('periods/:id')
  updatePeriod(@Id() id: string, @Body() dto: UpdatePeriodDto): Promise<TimetablePeriod> {
    return this.timetable.updatePeriod(id, dto);
  }

  @RequirePermission('timetable.manage')
  @Delete('periods/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removePeriod(@Id() id: string): Promise<void> {
    return this.timetable.removePeriod(id);
  }

  @RequirePermission('timetable.manage')
  @Post('entries')
  createEntry(@Body() dto: CreateEntryDto): Promise<TimetableEntry> {
    return this.timetable.createEntry(dto);
  }

  @RequirePermission('timetable.manage')
  @Patch('entries/:id')
  updateEntry(@Id() id: string, @Body() dto: UpdateEntryDto): Promise<TimetableEntry> {
    return this.timetable.updateEntry(id, dto);
  }

  @RequirePermission('timetable.manage')
  @Delete('entries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeEntry(@Id() id: string): Promise<void> {
    return this.timetable.removeEntry(id);
  }

  @RequirePermission('timetable.read')
  @Get('sections/:sectionId')
  section(@Id('sectionId') sectionId: string): Promise<TimetableWeek> {
    return this.timetable.sectionWeek(sectionId);
  }

  @RequirePermission('timetable.read')
  @Get('teachers/me')
  mine(@Query() q: WeekQueryDto): Promise<TimetableWeek> {
    return this.timetable.teacherWeek('me', q.academicYearId);
  }

  @RequirePermission('timetable.read')
  @Get('teachers/:teacherId')
  teacher(@Id('teacherId') teacherId: string, @Query() q: WeekQueryDto): Promise<TimetableWeek> {
    return this.timetable.teacherWeek(teacherId, q.academicYearId);
  }
}

export const OPERATIONS_CONTROLLERS = [
  AttendanceController,
  HomeworkController,
  AssignmentsController,
  TimetableController,
];
export const OPERATIONS_PROVIDERS = [AttendanceService, ClassworkService, TimetableService];
