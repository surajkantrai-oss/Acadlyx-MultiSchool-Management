import type {
  AcademicSettings,
  AcademicYear,
  Branch,
  Grade,
  GradeSubject,
  School,
  SchoolSetupStatus,
  Section,
  Subject,
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
import {
  AssignGradeSubjectDto,
  CreateAcademicYearDto,
  CreateBranchDto,
  CreateGradeDto,
  CreateSectionDto,
  CreateSubjectDto,
  ListBranchesQueryDto,
  ListSectionsQueryDto,
  ListSubjectsQueryDto,
  ReorderDto,
  ReorderSectionsDto,
  UpdateAcademicSettingsDto,
  UpdateAcademicYearDto,
  UpdateBranchDto,
  UpdateGradeDto,
  UpdateSchoolDto,
  UpdateSectionDto,
  UpdateSubjectDto,
} from './academic.dto.js';
import { AcademicYearsService } from './academic-years.service.js';
import { BranchesService } from './branches.service.js';
import { GradesService } from './grades.service.js';
import { SchoolService } from './school.service.js';
import { SectionsService } from './sections.service.js';
import { SubjectsService } from './subjects.service.js';

/*
 * School & academic configuration API (Phase 4) — /api/v1/school, /branches, /academic-years,
 * /grades, /sections, /subjects. Every route is tenant-scoped (tenant from Host/key, never from
 * the body), requires a TENANT session bound to that tenant, and one named permission. Ids in
 * paths are UUID-validated; ids of other tenants resolve to 404 without revealing anything.
 */
const Id = (name = 'id') => Param(name, new ParseUUIDPipe());

@TenantScoped()
@Controller('school')
export class SchoolController {
  constructor(private readonly school: SchoolService) {}

  @RequirePermission('school.read')
  @Get()
  get(): Promise<School> {
    return this.school.get();
  }

  @RequirePermission('school.manage')
  @Patch()
  update(@Body() dto: UpdateSchoolDto): Promise<School> {
    return this.school.update(dto);
  }

  @RequirePermission('school.read')
  @Get('setup-status')
  setupStatus(): Promise<SchoolSetupStatus> {
    return this.school.setupStatus();
  }

  @RequirePermission('academic_configuration.read')
  @Get('academic-settings')
  settings(): Promise<AcademicSettings> {
    return this.school.settings();
  }

  @RequirePermission('academic_configuration.manage')
  @Patch('academic-settings')
  updateSettings(@Body() dto: UpdateAcademicSettingsDto): Promise<AcademicSettings> {
    return this.school.updateSettings(dto);
  }
}

@TenantScoped()
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @RequirePermission('branch.read')
  @Get()
  list(@Query() query: ListBranchesQueryDto): Promise<Branch[]> {
    return this.branches.list(query);
  }

  @RequirePermission('branch.manage')
  @Post()
  create(@Body() dto: CreateBranchDto): Promise<Branch> {
    return this.branches.create(dto);
  }

  @RequirePermission('branch.read')
  @Get(':id')
  get(@Id() id: string): Promise<Branch> {
    return this.branches.get(id);
  }

  @RequirePermission('branch.manage')
  @Patch(':id')
  update(@Id() id: string, @Body() dto: UpdateBranchDto): Promise<Branch> {
    return this.branches.update(id, dto);
  }

  @RequirePermission('branch.manage')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@Id() id: string): Promise<Branch> {
    return this.branches.setActive(id, true);
  }

  @RequirePermission('branch.manage')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Id() id: string): Promise<Branch> {
    return this.branches.setActive(id, false);
  }

  @RequirePermission('branch.manage')
  @Post(':id/set-primary')
  @HttpCode(HttpStatus.OK)
  setPrimary(@Id() id: string): Promise<Branch> {
    return this.branches.setPrimary(id);
  }
}

@TenantScoped()
@Controller('academic-years')
export class AcademicYearsController {
  constructor(private readonly years: AcademicYearsService) {}

  @RequirePermission('academic_year.read')
  @Get()
  list(): Promise<AcademicYear[]> {
    return this.years.list();
  }

  @RequirePermission('academic_year.manage')
  @Post()
  create(@Body() dto: CreateAcademicYearDto): Promise<AcademicYear> {
    return this.years.create(dto);
  }

  @RequirePermission('academic_year.read')
  @Get(':id')
  get(@Id() id: string): Promise<AcademicYear> {
    return this.years.get(id);
  }

  @RequirePermission('academic_year.manage')
  @Patch(':id')
  update(@Id() id: string, @Body() dto: UpdateAcademicYearDto): Promise<AcademicYear> {
    return this.years.update(id, dto);
  }

  @RequirePermission('academic_year.manage')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@Id() id: string): Promise<AcademicYear> {
    return this.years.activate(id);
  }

  @RequirePermission('academic_year.manage')
  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  close(@Id() id: string): Promise<AcademicYear> {
    return this.years.close(id);
  }

  @RequirePermission('academic_year.manage')
  @Post(':id/set-current')
  @HttpCode(HttpStatus.OK)
  setCurrent(@Id() id: string): Promise<AcademicYear> {
    return this.years.setCurrent(id);
  }
}

@TenantScoped()
@Controller('grades')
export class GradesController {
  constructor(
    private readonly grades: GradesService,
    private readonly subjects: SubjectsService,
  ) {}

  @RequirePermission('grade.read')
  @Get()
  list(): Promise<Grade[]> {
    return this.grades.list();
  }

  @RequirePermission('grade.manage')
  @Post()
  create(@Body() dto: CreateGradeDto): Promise<Grade> {
    return this.grades.create(dto);
  }

  @RequirePermission('grade.manage')
  @Put('order')
  reorder(@Body() dto: ReorderDto): Promise<Grade[]> {
    return this.grades.reorder(dto.ids);
  }

  @RequirePermission('grade.read')
  @Get(':id')
  get(@Id() id: string): Promise<Grade> {
    return this.grades.get(id);
  }

  @RequirePermission('grade.manage')
  @Patch(':id')
  update(@Id() id: string, @Body() dto: UpdateGradeDto): Promise<Grade> {
    return this.grades.update(id, dto);
  }

  @RequirePermission('grade.manage')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@Id() id: string): Promise<Grade> {
    return this.grades.setActive(id, true);
  }

  @RequirePermission('grade.manage')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Id() id: string): Promise<Grade> {
    return this.grades.setActive(id, false);
  }

  @RequirePermission('subject.read')
  @Get(':id/subjects')
  gradeSubjects(@Id() id: string): Promise<GradeSubject[]> {
    return this.subjects.gradeSubjects(id);
  }

  @RequirePermission('subject.manage')
  @Put(':id/subjects/:subjectId')
  assignSubject(
    @Id() id: string,
    @Id('subjectId') subjectId: string,
    @Body() dto: AssignGradeSubjectDto,
  ): Promise<GradeSubject[]> {
    return this.subjects.assign(id, subjectId, dto);
  }

  @RequirePermission('subject.manage')
  @Delete(':id/subjects/:subjectId')
  removeSubject(@Id() id: string, @Id('subjectId') subjectId: string): Promise<GradeSubject[]> {
    return this.subjects.remove(id, subjectId);
  }
}

@TenantScoped()
@Controller('sections')
export class SectionsController {
  constructor(private readonly sections: SectionsService) {}

  @RequirePermission('section.read')
  @Get()
  list(@Query() query: ListSectionsQueryDto): Promise<Section[]> {
    return this.sections.list(query);
  }

  @RequirePermission('section.manage')
  @Post()
  create(@Body() dto: CreateSectionDto): Promise<Section> {
    return this.sections.create(dto);
  }

  @RequirePermission('section.manage')
  @Put('order')
  reorder(@Body() dto: ReorderSectionsDto): Promise<Section[]> {
    return this.sections.reorder(dto);
  }

  @RequirePermission('section.read')
  @Get(':id')
  get(@Id() id: string): Promise<Section> {
    return this.sections.get(id);
  }

  @RequirePermission('section.manage')
  @Patch(':id')
  update(@Id() id: string, @Body() dto: UpdateSectionDto): Promise<Section> {
    return this.sections.update(id, dto);
  }

  @RequirePermission('section.manage')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@Id() id: string): Promise<Section> {
    return this.sections.setActive(id, true);
  }

  @RequirePermission('section.manage')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Id() id: string): Promise<Section> {
    return this.sections.setActive(id, false);
  }
}

@TenantScoped()
@Controller('subjects')
export class SubjectsController {
  constructor(private readonly subjects: SubjectsService) {}

  @RequirePermission('subject.read')
  @Get()
  list(@Query() query: ListSubjectsQueryDto): Promise<Subject[]> {
    return this.subjects.list(query);
  }

  @RequirePermission('subject.manage')
  @Post()
  create(@Body() dto: CreateSubjectDto): Promise<Subject> {
    return this.subjects.create(dto);
  }

  @RequirePermission('subject.read')
  @Get(':id')
  get(@Id() id: string): Promise<Subject> {
    return this.subjects.get(id);
  }

  @RequirePermission('subject.manage')
  @Patch(':id')
  update(@Id() id: string, @Body() dto: UpdateSubjectDto): Promise<Subject> {
    return this.subjects.update(id, dto);
  }

  @RequirePermission('subject.manage')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@Id() id: string): Promise<Subject> {
    return this.subjects.setActive(id, true);
  }

  @RequirePermission('subject.manage')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Id() id: string): Promise<Subject> {
    return this.subjects.setActive(id, false);
  }
}

export const ACADEMIC_CONTROLLERS = [
  SchoolController,
  BranchesController,
  AcademicYearsController,
  GradesController,
  SectionsController,
  SubjectsController,
];
