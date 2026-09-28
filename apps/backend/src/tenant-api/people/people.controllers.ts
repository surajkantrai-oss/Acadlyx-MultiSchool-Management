import type { Paginated } from '@acadlyx/tenant-config';
import type {
  CreatedAccount,
  Enrollment,
  ImportJob,
  ImportRow,
  ImportTemplate,
  ImportType,
  ParentDetail,
  ParentSummary,
  PeopleCounts,
  ProfileAccount,
  StudentDetail,
  StudentSummary,
  TeacherAssignment,
  TeacherDetail,
  TeacherSummary,
} from '@acadlyx/types';
import { IMPORT_MAX_BYTES } from '@acadlyx/validation';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { currentAuth } from '../../auth/core/access.guard.js';
import { RequirePermission, TenantScoped } from '../../auth/core/access.decorators.js';
import { AcademicStore } from '../academic/academic-store.js';
import { template } from '../imports/import-templates.js';
import { ImportsService } from '../imports/imports.service.js';
import { AccountsService } from './accounts.service.js';
import { ParentsService } from './parents.service.js';
import {
  ChangeStudentStatusDto,
  CreateAssignmentDto,
  CreateEnrollmentDto,
  CreateParentDto,
  CreateStudentDto,
  CreateTeacherDto,
  EndEnrollmentDto,
  ImportRowsQueryDto,
  LinkAccountDto,
  LinkGuardianDto,
  PagingQueryDto,
  ParentListQueryDto,
  StudentListQueryDto,
  TeacherListQueryDto,
  TeacherStatusDto,
  TransferEnrollmentDto,
  UpdateGuardianDto,
  UpdateParentDto,
  UpdateStudentDto,
  UpdateTeacherDto,
  UploadImportDto,
} from './people.dto.js';
import { StudentsService } from './students.service.js';
import { TeachersService } from './teachers.service.js';

/*
 * People, enrollment and bulk-onboarding API (Phase 5). Tenant-scoped (tenant from Host/key,
 * never the body); every route requires a TENANT session bound to the tenant plus one named
 * permission. Other tenants'/schools' ids are 404. Nothing here deletes a person.
 */
const Id = (name = 'id') => Param(name, new ParseUUIDPipe());

/** Guardian contact data is only returned to callers who may read parent profiles. */
function withoutGuardianContact(s: StudentDetail): StudentDetail {
  if (currentAuth().permissions.includes('parent.read')) return s;
  return {
    ...s,
    guardians: s.guardians.map((g) => ({
      ...g,
      parent: { ...g.parent, phone: null, email: null },
    })),
  };
}

@TenantScoped()
@Controller('students')
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly accounts: AccountsService,
  ) {}

  @RequirePermission('student.read')
  @Get()
  list(@Query() q: StudentListQueryDto): Promise<Paginated<StudentSummary>> {
    return this.students.list(q);
  }

  @RequirePermission('student.manage')
  @Post()
  create(@Body() dto: CreateStudentDto): Promise<StudentDetail> {
    return this.students.create(dto);
  }

  @RequirePermission('student.read')
  @Get(':id')
  async get(@Id() id: string): Promise<StudentDetail> {
    return withoutGuardianContact(await this.students.get(id));
  }

  @RequirePermission('student.manage')
  @Patch(':id')
  update(@Id() id: string, @Body() dto: UpdateStudentDto): Promise<StudentDetail> {
    return this.students.update(id, dto);
  }

  @RequirePermission('student.manage')
  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  status(@Id() id: string, @Body() dto: ChangeStudentStatusDto): Promise<StudentDetail> {
    return this.students.changeStatus(id, dto);
  }

  @RequirePermission('student.manage')
  @Post(':id/guardians')
  linkGuardian(@Id() id: string, @Body() dto: LinkGuardianDto): Promise<StudentDetail> {
    return this.students.linkGuardian(id, dto);
  }

  @RequirePermission('student.manage')
  @Patch(':id/guardians/:linkId')
  updateGuardian(
    @Id() id: string,
    @Id('linkId') linkId: string,
    @Body() dto: UpdateGuardianDto,
  ): Promise<StudentDetail> {
    return this.students.updateGuardian(id, linkId, dto);
  }

  @RequirePermission('student.manage')
  @Delete(':id/guardians/:linkId')
  unlinkGuardian(@Id() id: string, @Id('linkId') linkId: string): Promise<StudentDetail> {
    return this.students.unlinkGuardian(id, linkId);
  }

  @RequirePermission('enrollment.read')
  @Get(':id/enrollments')
  enrollments(@Id() id: string): Promise<Enrollment[]> {
    return this.students.enrollments(id);
  }

  @RequirePermission('enrollment.manage')
  @Post(':id/enrollments')
  enroll(@Id() id: string, @Body() dto: CreateEnrollmentDto): Promise<StudentDetail> {
    return this.students.enroll(id, dto);
  }

  @RequirePermission('enrollment.manage')
  @Post(':id/enrollments/:enrollmentId/transfer')
  @HttpCode(HttpStatus.OK)
  transfer(
    @Id() id: string,
    @Id('enrollmentId') eid: string,
    @Body() dto: TransferEnrollmentDto,
  ): Promise<StudentDetail> {
    return this.students.transfer(id, eid, dto);
  }

  @RequirePermission('enrollment.manage')
  @Post(':id/enrollments/:enrollmentId/end')
  @HttpCode(HttpStatus.OK)
  end(
    @Id() id: string,
    @Id('enrollmentId') eid: string,
    @Body() dto: EndEnrollmentDto,
  ): Promise<StudentDetail> {
    return this.students.endEnrollment(id, eid, dto);
  }

  @RequirePermission('people_account.manage')
  @Post(':id/account')
  createAccount(@Id() id: string): Promise<CreatedAccount> {
    return this.accounts.createAccount('students', id);
  }

  @RequirePermission('people_account.manage')
  @Post(':id/account/link')
  @HttpCode(HttpStatus.OK)
  linkAccount(@Id() id: string, @Body() dto: LinkAccountDto): Promise<ProfileAccount> {
    return this.accounts.linkAccount('students', id, dto.userId);
  }

  @RequirePermission('people_account.manage')
  @Post(':id/account/activation-code')
  @HttpCode(HttpStatus.OK)
  activationCode(@Id() id: string): Promise<CreatedAccount> {
    return this.accounts.issueActivationCode('students', id);
  }
}

@TenantScoped()
@Controller('parents')
export class ParentsController {
  constructor(
    private readonly parents: ParentsService,
    private readonly accounts: AccountsService,
  ) {}

  @RequirePermission('parent.read')
  @Get()
  list(@Query() q: ParentListQueryDto): Promise<Paginated<ParentSummary>> {
    return this.parents.list(q);
  }

  @RequirePermission('parent.manage')
  @Post()
  create(@Body() dto: CreateParentDto): Promise<ParentDetail> {
    return this.parents.create(dto);
  }

  @RequirePermission('parent.read')
  @Get(':id')
  get(@Id() id: string): Promise<ParentDetail> {
    return this.parents.get(id);
  }

  @RequirePermission('parent.manage')
  @Patch(':id')
  update(@Id() id: string, @Body() dto: UpdateParentDto): Promise<ParentDetail> {
    return this.parents.update(id, dto);
  }

  @RequirePermission('parent.manage')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@Id() id: string): Promise<ParentDetail> {
    return this.parents.setActive(id, true);
  }

  @RequirePermission('parent.manage')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Id() id: string): Promise<ParentDetail> {
    return this.parents.setActive(id, false);
  }

  @RequirePermission('people_account.manage')
  @Post(':id/account')
  createAccount(@Id() id: string): Promise<CreatedAccount> {
    return this.accounts.createAccount('parents', id);
  }

  @RequirePermission('people_account.manage')
  @Post(':id/account/link')
  @HttpCode(HttpStatus.OK)
  linkAccount(@Id() id: string, @Body() dto: LinkAccountDto): Promise<ProfileAccount> {
    return this.accounts.linkAccount('parents', id, dto.userId);
  }

  @RequirePermission('people_account.manage')
  @Post(':id/account/activation-code')
  @HttpCode(HttpStatus.OK)
  activationCode(@Id() id: string): Promise<CreatedAccount> {
    return this.accounts.issueActivationCode('parents', id);
  }
}

@TenantScoped()
@Controller('teachers')
export class TeachersController {
  constructor(
    private readonly teachers: TeachersService,
    private readonly accounts: AccountsService,
  ) {}

  @RequirePermission('teacher.read')
  @Get()
  list(@Query() q: TeacherListQueryDto): Promise<Paginated<TeacherSummary>> {
    return this.teachers.list(q);
  }

  @RequirePermission('teacher.manage')
  @Post()
  create(@Body() dto: CreateTeacherDto): Promise<TeacherDetail> {
    return this.teachers.create(dto);
  }

  @RequirePermission('teacher.read')
  @Get(':id')
  get(@Id() id: string): Promise<TeacherDetail> {
    return this.teachers.get(id);
  }

  @RequirePermission('teacher.manage')
  @Patch(':id')
  update(@Id() id: string, @Body() dto: UpdateTeacherDto): Promise<TeacherDetail> {
    return this.teachers.update(id, dto);
  }

  @RequirePermission('teacher.manage')
  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  status(@Id() id: string, @Body() dto: TeacherStatusDto): Promise<TeacherDetail> {
    return this.teachers.setStatus(id, dto);
  }

  @RequirePermission('teacher_assignment.read')
  @Get(':id/assignments')
  assignments(
    @Id() id: string,
    @Query('includeEnded', new ParseBoolPipe({ optional: true })) includeEnded?: boolean,
  ): Promise<TeacherAssignment[]> {
    return this.teachers.assignments(id, includeEnded ?? false);
  }

  @RequirePermission('teacher_assignment.manage')
  @Post(':id/assignments')
  assign(@Id() id: string, @Body() dto: CreateAssignmentDto): Promise<TeacherDetail> {
    return this.teachers.assign(id, dto);
  }

  @RequirePermission('teacher_assignment.manage')
  @Post(':id/assignments/:assignmentId/end')
  @HttpCode(HttpStatus.OK)
  endAssignment(@Id() id: string, @Id('assignmentId') aid: string): Promise<TeacherDetail> {
    return this.teachers.endAssignment(id, aid);
  }

  @RequirePermission('people_account.manage')
  @Post(':id/account')
  createAccount(@Id() id: string): Promise<CreatedAccount> {
    return this.accounts.createAccount('teachers', id);
  }

  @RequirePermission('people_account.manage')
  @Post(':id/account/link')
  @HttpCode(HttpStatus.OK)
  linkAccount(@Id() id: string, @Body() dto: LinkAccountDto): Promise<ProfileAccount> {
    return this.accounts.linkAccount('teachers', id, dto.userId);
  }

  @RequirePermission('people_account.manage')
  @Post(':id/account/activation-code')
  @HttpCode(HttpStatus.OK)
  activationCode(@Id() id: string): Promise<CreatedAccount> {
    return this.accounts.issueActivationCode('teachers', id);
  }
}

const TYPES = new ParseEnumPipe(['STUDENTS', 'PARENTS', 'TEACHERS']);

@TenantScoped()
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @RequirePermission('bulk_import.read')
  @Get()
  list(@Query() q: PagingQueryDto): Promise<Paginated<ImportJob>> {
    return this.imports.list(q);
  }

  @RequirePermission('bulk_import.read')
  @Get('templates/:type')
  template(@Param('type', TYPES) type: ImportType): ImportTemplate {
    return template(type);
  }

  @RequirePermission('bulk_import.read')
  @Get('templates/:type/file')
  async templateFile(
    @Param('type', TYPES) type: ImportType,
    @Query('format', new ParseEnumPipe(['csv', 'xlsx'])) format: 'csv' | 'xlsx',
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.imports.templateFile(type, format);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return new StreamableFile(file.body, { type: file.contentType });
  }

  /** Multipart upload (field "file"). Parsed + validated immediately; NOTHING is created here. */
  @RequirePermission('bulk_import.manage')
  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_BYTES, files: 1, fields: 5 } }),
  )
  upload(
    @Body() dto: UploadImportDto,
    @UploadedFile() file: { originalname: string; buffer: Buffer } | undefined,
  ): Promise<ImportJob> {
    return this.imports.upload(dto.type, file);
  }

  @RequirePermission('bulk_import.read')
  @Get(':id')
  get(@Id() id: string): Promise<ImportJob> {
    return this.imports.get(id);
  }

  @RequirePermission('bulk_import.read')
  @Get(':id/rows')
  rows(@Id() id: string, @Query() q: ImportRowsQueryDto): Promise<Paginated<ImportRow>> {
    return this.imports.rows(id, q);
  }

  @RequirePermission('bulk_import.read')
  @Get(':id/errors.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async errors(@Id() id: string, @Res({ passthrough: true }) res: Response): Promise<string> {
    const report = await this.imports.errorsCsv(id);
    res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
    return report.body;
  }

  @RequirePermission('bulk_import.manage')
  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(@Id() id: string): Promise<ImportJob> {
    return this.imports.confirm(id);
  }

  @RequirePermission('bulk_import.manage')
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Id() id: string): Promise<ImportJob> {
    return this.imports.cancel(id);
  }
}

@TenantScoped()
@Controller('people')
export class PeopleController {
  constructor(private readonly store: AcademicStore) {}

  /** Real school-wide counts (no invented metrics). Phase 6: requires school-wide people read. */
  @RequirePermission('people.read_all')
  @Get('summary')
  summary(): Promise<PeopleCounts> {
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const s = { schoolId: school.id };
      const [
        students,
        activeStudents,
        parents,
        teachers,
        activeTeachers,
        guardianLinks,
        pendingImports,
      ] = await Promise.all([
        tx.student.count({ where: s }),
        tx.student.count({ where: { ...s, status: 'ACTIVE' } }),
        tx.parent.count({ where: s }),
        tx.teacher.count({ where: s }),
        tx.teacher.count({ where: { ...s, status: 'ACTIVE' } }),
        tx.studentGuardian.count({ where: s }),
        tx.bulkImportJob.count({
          where: { ...s, status: { in: ['READY', 'QUEUED', 'PROCESSING'] } },
        }),
      ]);
      return {
        students,
        activeStudents,
        parents,
        teachers,
        activeTeachers,
        guardianLinks,
        pendingImports,
      };
    });
  }
}

export const PEOPLE_CONTROLLERS = [
  StudentsController,
  ParentsController,
  TeachersController,
  ImportsController,
  PeopleController,
];
