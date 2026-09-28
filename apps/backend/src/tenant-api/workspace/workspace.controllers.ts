import type { Paginated } from '@acadlyx/tenant-config';
import type {
  AccessRow,
  ClassDetail,
  ClassSummary,
  DashboardSummary,
  SearchResults,
} from '@acadlyx/types';
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { RequirePermission, TenantScoped } from '../../auth/core/access.decorators.js';
import {
  AccessQueryDto,
  ClassListQueryDto,
  SearchQueryDto,
  WorkspaceContextDto,
} from './workspace.dto.js';
import { WorkspaceService } from './workspace.service.js';

/*
 * School Admin workspace (Phase 6). Tenant-scoped read models over the Phase 4/5 domain. The
 * route permission is the minimum to open the view; each block/entity inside is additionally
 * gated by its own read permission and by the people data scope (teachers → assigned sections).
 */
@TenantScoped()
@Controller('workspace')
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceService) {}

  /** Dashboard summary; blocks the caller cannot read are omitted (not zeroed). */
  @RequirePermission('tenant.workspace.access')
  @Get('dashboard')
  dashboard(@Query() q: WorkspaceContextDto): Promise<DashboardSummary> {
    return this.workspace.dashboard(q);
  }

  /** Global search across students, parents, teachers and classes the caller may read. */
  @RequirePermission('tenant.workspace.access')
  @Get('search')
  search(@Query() q: SearchQueryDto): Promise<SearchResults> {
    return this.workspace.search(q);
  }

  /** Profiles without an active login (the central "pending access" list). */
  @RequirePermission('people_account.manage')
  @Get('access')
  access(@Query() q: AccessQueryDto): Promise<Paginated<AccessRow>> {
    return this.workspace.access(q);
  }
}

/** Classes are Sections (no separate entity). Rosters are enrollment data. */
@TenantScoped()
@Controller('classes')
export class ClassesController {
  constructor(private readonly workspace: WorkspaceService) {}

  @RequirePermission('enrollment.read')
  @Get()
  list(@Query() q: ClassListQueryDto): Promise<ClassSummary[]> {
    return this.workspace.classes(q);
  }

  @RequirePermission('enrollment.read')
  @Get(':sectionId')
  detail(@Param('sectionId', new ParseUUIDPipe()) sectionId: string): Promise<ClassDetail> {
    return this.workspace.classDetail(sectionId);
  }
}

export const WORKSPACE_CONTROLLERS = [WorkspaceController, ClassesController];
