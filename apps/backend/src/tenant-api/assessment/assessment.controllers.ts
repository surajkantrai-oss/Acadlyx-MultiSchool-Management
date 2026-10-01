import type { Paginated } from '@acadlyx/tenant-config';
import type {
  AssignmentGrading,
  ClassResults,
  ExamDetail,
  ExamSummary,
  ExamTransition,
  GradeScale,
  MarkSheet,
  MarkSheetSummary,
  ReportCard,
  ResultPublicationSummary,
} from '@acadlyx/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RequirePermission, TenantScoped } from '../../auth/core/access.decorators.js';
import { ASSESSMENT_ERRORS } from './assessment-errors.js';
import {
  AddExamSubjectDto,
  ComponentDto,
  CreateExamDto,
  ExamListQueryDto,
  GradeScaleDto,
  GradeScaleQueryDto,
  RemarkDto,
  ReopenDto,
  ResultsQueryDto,
  SaveGradeDto,
  SaveMarksDto,
  ScheduleDto,
  SheetListQueryDto,
  UpdateComponentDto,
  UpdateExamDto,
  UpdateExamSubjectDto,
  VersionOnlyDto,
} from './assessment.dto.js';
import { ExamsService } from './exams.service.js';
import { GradingService } from './grading.service.js';
import { MarksService } from './marks.service.js';
import { ResultsService } from './results.service.js';

/*
 * Phase 9 API. Every route: tenant session + one named permission + resource scope (teachers:
 * TeacherAssignment Section + Subject; class teachers: their section's results). Other tenants',
 * other schools' and out-of-scope ids are 404. Parents/students use /mobile/* self-service routes.
 */
const Id = (name = 'id') => Param(name, new ParseUUIDPipe());
const TRANSITIONS: ExamTransition[] = ['publish', 'open-marks', 'finalize-marks', 'archive'];

@TenantScoped()
@Controller('grade-scales')
export class GradeScalesController {
  constructor(private readonly exams: ExamsService) {}

  @RequirePermission('exam.read')
  @Get()
  list(@Query() q: GradeScaleQueryDto): Promise<GradeScale[]> {
    return this.exams.gradeScales(q.academicYearId);
  }

  @RequirePermission('exam.manage')
  @Post()
  create(@Body() body: GradeScaleDto): Promise<GradeScale[]> {
    return this.exams.saveGradeScale(null, body);
  }

  @RequirePermission('exam.manage')
  @Put(':id')
  replace(@Id() id: string, @Body() body: GradeScaleDto): Promise<GradeScale[]> {
    return this.exams.saveGradeScale(id, body);
  }

  @RequirePermission('exam.manage')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Id() id: string): Promise<void> {
    await this.exams.deleteGradeScale(id);
  }
}

@TenantScoped()
@Controller('exams')
export class ExamsController {
  constructor(
    private readonly exams: ExamsService,
    private readonly marks: MarksService,
    private readonly results: ResultsService,
  ) {}

  @RequirePermission('exam.read')
  @Get()
  list(@Query() q: ExamListQueryDto): Promise<Paginated<ExamSummary>> {
    return this.exams.list(q);
  }

  @RequirePermission('exam.read')
  @Get(':id')
  get(@Id() id: string): Promise<ExamDetail> {
    return this.exams.get(id);
  }

  @RequirePermission('exam.manage')
  @Post()
  create(@Body() body: CreateExamDto): Promise<ExamDetail> {
    return this.exams.create(body);
  }

  @RequirePermission('exam.manage')
  @Patch(':id')
  update(@Id() id: string, @Body() body: UpdateExamDto): Promise<ExamDetail> {
    return this.exams.update(id, body);
  }

  @RequirePermission('exam.manage')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Id() id: string): Promise<void> {
    await this.exams.remove(id);
  }

  @RequirePermission('exam.manage')
  @Post(':id/transitions/:action')
  transition(
    @Id() id: string,
    @Param('action') action: string,
    @Body() body: VersionOnlyDto,
  ): Promise<ExamDetail> {
    if (!(TRANSITIONS as string[]).includes(action)) throw ASSESSMENT_ERRORS.invalidTransition();
    return this.exams.transition(id, action as ExamTransition, body.expectedVersion);
  }

  // ---- structure ----

  @RequirePermission('exam.manage')
  @Post(':id/subjects')
  addSubject(@Id() id: string, @Body() body: AddExamSubjectDto): Promise<ExamDetail> {
    return this.exams.addSubject(id, body);
  }

  @RequirePermission('exam.manage')
  @Patch(':id/subjects/:examSubjectId')
  updateSubject(
    @Id() id: string,
    @Id('examSubjectId') examSubjectId: string,
    @Body() body: UpdateExamSubjectDto,
  ): Promise<ExamDetail> {
    return this.exams.updateSubject(id, examSubjectId, body);
  }

  @RequirePermission('exam.manage')
  @Delete(':id/subjects/:examSubjectId')
  removeSubject(@Id() id: string, @Id('examSubjectId') examSubjectId: string): Promise<ExamDetail> {
    return this.exams.removeSubject(id, examSubjectId);
  }

  @RequirePermission('exam.manage')
  @Post(':id/subjects/:examSubjectId/components')
  addComponent(
    @Id() id: string,
    @Id('examSubjectId') examSubjectId: string,
    @Body() body: ComponentDto,
  ): Promise<ExamDetail> {
    return this.exams.addComponent(id, examSubjectId, body);
  }

  @RequirePermission('exam.manage')
  @Patch(':id/components/:componentId')
  updateComponent(
    @Id() id: string,
    @Id('componentId') componentId: string,
    @Body() body: UpdateComponentDto,
  ): Promise<ExamDetail> {
    return this.exams.updateComponent(id, componentId, body);
  }

  @RequirePermission('exam.manage')
  @Delete(':id/components/:componentId')
  removeComponent(@Id() id: string, @Id('componentId') componentId: string): Promise<ExamDetail> {
    return this.exams.removeComponent(id, componentId);
  }

  @RequirePermission('exam.manage')
  @Put(':id/components/:componentId/schedules/:branchId')
  setSchedule(
    @Id() id: string,
    @Id('componentId') componentId: string,
    @Id('branchId') branchId: string,
    @Body() body: ScheduleDto,
  ): Promise<ExamDetail> {
    return this.exams.setSchedule(id, componentId, branchId, body);
  }

  @RequirePermission('exam.manage')
  @Delete(':id/components/:componentId/schedules/:branchId')
  removeSchedule(
    @Id() id: string,
    @Id('componentId') componentId: string,
    @Id('branchId') branchId: string,
  ): Promise<ExamDetail> {
    return this.exams.removeSchedule(id, componentId, branchId);
  }

  // ---- marks ----

  @RequirePermission('exam.read')
  @Get(':id/sheets')
  sheets(
    @Id() id: string,
    @Query() query: SheetListQueryDto,
  ): Promise<Paginated<MarkSheetSummary>> {
    return this.marks.sheets(id, query);
  }

  @RequirePermission('exam.read')
  @Get(':id/sheets/:examSubjectId/:sectionId')
  sheet(
    @Id() id: string,
    @Id('examSubjectId') examSubjectId: string,
    @Id('sectionId') sectionId: string,
  ): Promise<MarkSheet> {
    return this.marks.sheet(id, examSubjectId, sectionId);
  }

  @RequirePermission('marks.enter')
  @Put(':id/sheets/:examSubjectId/:sectionId')
  saveMarks(
    @Id() id: string,
    @Id('examSubjectId') examSubjectId: string,
    @Id('sectionId') sectionId: string,
    @Body() body: SaveMarksDto,
  ): Promise<MarkSheet> {
    return this.marks.save(id, examSubjectId, sectionId, body);
  }

  @RequirePermission('marks.enter')
  @Post(':id/sheets/:examSubjectId/:sectionId/submit')
  submit(
    @Id() id: string,
    @Id('examSubjectId') examSubjectId: string,
    @Id('sectionId') sectionId: string,
    @Body() body: VersionOnlyDto,
  ): Promise<MarkSheet> {
    return this.marks.submit(id, examSubjectId, sectionId, body.expectedVersion);
  }

  @RequirePermission('marks.finalize')
  @Post(':id/sheets/:examSubjectId/:sectionId/finalize')
  finalize(
    @Id() id: string,
    @Id('examSubjectId') examSubjectId: string,
    @Id('sectionId') sectionId: string,
    @Body() body: VersionOnlyDto,
  ): Promise<MarkSheet> {
    return this.marks.finalize(id, examSubjectId, sectionId, body.expectedVersion);
  }

  @RequirePermission('marks.finalize')
  @Post(':id/sheets/:examSubjectId/:sectionId/reopen')
  reopen(
    @Id() id: string,
    @Id('examSubjectId') examSubjectId: string,
    @Id('sectionId') sectionId: string,
    @Body() body: ReopenDto,
  ): Promise<MarkSheet> {
    return this.marks.reopen(id, examSubjectId, sectionId, body.expectedVersion, body.reason);
  }

  // ---- results ----

  @RequirePermission('results.read')
  @Get(':id/results')
  classResults(@Id() id: string, @Query() q: ResultsQueryDto): Promise<ClassResults> {
    return this.results.classResults(id, q);
  }

  @RequirePermission('results.read')
  @Get(':id/results/students/:studentId')
  preview(@Id() id: string, @Id('studentId') studentId: string): Promise<ReportCard> {
    return this.results.preview(id, studentId);
  }

  @RequirePermission('results.read')
  @Put(':id/remarks/:studentId')
  remark(
    @Id() id: string,
    @Id('studentId') studentId: string,
    @Body() body: RemarkDto,
  ): Promise<ReportCard> {
    return this.results.setRemark(id, studentId, body.remark ?? null);
  }

  @RequirePermission('results.publish')
  @Post(':id/results/publish')
  publish(@Id() id: string, @Body() body: VersionOnlyDto): Promise<ResultPublicationSummary[]> {
    return this.results.publish(id, body.expectedVersion);
  }

  @RequirePermission('results.read')
  @Get(':id/publications')
  publications(@Id() id: string): Promise<ResultPublicationSummary[]> {
    return this.results.publications(id);
  }
}

@TenantScoped()
@Controller('result-publications')
export class ResultPublicationsController {
  constructor(private readonly results: ResultsService) {}

  @RequirePermission('results.read')
  @Get(':publicationId/students/:studentId')
  card(
    @Id('publicationId') publicationId: string,
    @Id('studentId') studentId: string,
  ): Promise<ReportCard> {
    return this.results.publishedCard(publicationId, studentId);
  }
}

@TenantScoped()
@Controller('assignments/:id')
export class AssignmentGradingController {
  constructor(private readonly grading: GradingService) {}

  @RequirePermission('assignment_grade.manage')
  @Get('grading')
  view(@Id() id: string): Promise<AssignmentGrading> {
    return this.grading.grading(id);
  }

  @RequirePermission('assignment_grade.manage')
  @Put('submissions/:submissionId/versions/:version/grade')
  save(
    @Id() id: string,
    @Id('submissionId') submissionId: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() body: SaveGradeDto,
  ): Promise<AssignmentGrading> {
    return this.grading.save(id, submissionId, version, body);
  }

  @RequirePermission('assignment_grade.manage')
  @Post('submissions/:submissionId/versions/:version/grade/publish')
  publish(
    @Id() id: string,
    @Id('submissionId') submissionId: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() body: VersionOnlyDto,
  ): Promise<AssignmentGrading> {
    return this.grading.publish(id, submissionId, version, body.expectedVersion);
  }
}

export const ASSESSMENT_CONTROLLERS = [
  GradeScalesController,
  ExamsController,
  ResultPublicationsController,
  AssignmentGradingController,
];
export const ASSESSMENT_PROVIDERS = [ExamsService, MarksService, ResultsService, GradingService];
