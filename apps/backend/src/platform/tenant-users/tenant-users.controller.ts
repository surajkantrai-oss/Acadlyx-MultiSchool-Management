import type { Paginated } from '@acadlyx/tenant-config';
import type { IssuedActivationCode, TenantUserSummary } from '@acadlyx/types';
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
  Query,
} from '@nestjs/common';
import { RequirePermission } from '../../auth/core/access.decorators.js';
import {
  AssignRoleDto,
  CreateTenantUserDto,
  ListTenantUsersQueryDto,
  UpdateTenantUserDto,
} from './tenant-users.dto.js';
import { TenantUsersService } from './tenant-users.service.js';

const TenantId = () => Param('tenantId', new ParseUUIDPipe({ version: '7' }));
const UserId = () => Param('userId', new ParseUUIDPipe({ version: '7' }));

/** Platform Admin administration of school identities: /api/v1/platform/tenants/:tenantId/users. */
@Controller('platform/tenants/:tenantId/users')
export class TenantUsersController {
  constructor(private readonly users: TenantUsersService) {}

  @RequirePermission('platform.tenant_user.read')
  @Get()
  list(
    @TenantId() tenantId: string,
    @Query() query: ListTenantUsersQueryDto,
  ): Promise<Paginated<TenantUserSummary>> {
    return this.users.list(tenantId, query);
  }

  @RequirePermission('platform.tenant_user.manage')
  @Post()
  create(
    @TenantId() tenantId: string,
    @Body() dto: CreateTenantUserDto,
  ): Promise<TenantUserSummary> {
    return this.users.create(tenantId, dto);
  }

  @RequirePermission('platform.tenant_user.read')
  @Get(':userId')
  get(@TenantId() tenantId: string, @UserId() userId: string): Promise<TenantUserSummary> {
    return this.users.get(tenantId, userId);
  }

  @RequirePermission('platform.tenant_user.manage')
  @Patch(':userId')
  update(
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Body() dto: UpdateTenantUserDto,
  ): Promise<TenantUserSummary> {
    return this.users.rename(tenantId, userId, dto.displayName);
  }

  @RequirePermission('platform.tenant_user.manage')
  @Post(':userId/roles')
  assignRole(
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Body() dto: AssignRoleDto,
  ): Promise<TenantUserSummary> {
    return this.users.assignRole(tenantId, userId, dto.roleKey);
  }

  @RequirePermission('platform.tenant_user.manage')
  @Delete(':userId/roles/:roleKey')
  removeRole(
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Param('roleKey') roleKey: string,
  ): Promise<TenantUserSummary> {
    return this.users.removeRole(tenantId, userId, roleKey);
  }

  @RequirePermission('platform.tenant_user.manage')
  @Post(':userId/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(@TenantId() tenantId: string, @UserId() userId: string): Promise<TenantUserSummary> {
    return this.users.transition(tenantId, userId, 'suspend');
  }

  @RequirePermission('platform.tenant_user.manage')
  @Post(':userId/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(@TenantId() tenantId: string, @UserId() userId: string): Promise<TenantUserSummary> {
    return this.users.transition(tenantId, userId, 'reactivate');
  }

  @RequirePermission('platform.tenant_user.manage')
  @Post(':userId/disable')
  @HttpCode(HttpStatus.OK)
  disable(@TenantId() tenantId: string, @UserId() userId: string): Promise<TenantUserSummary> {
    return this.users.transition(tenantId, userId, 'disable');
  }

  @RequirePermission('platform.tenant_user.manage')
  @Post(':userId/reset-activation')
  @HttpCode(HttpStatus.OK)
  resetActivation(
    @TenantId() tenantId: string,
    @UserId() userId: string,
  ): Promise<TenantUserSummary> {
    return this.users.resetActivation(tenantId, userId);
  }

  @RequirePermission('platform.tenant_user.manage')
  @Post(':userId/activation-code')
  @HttpCode(HttpStatus.OK)
  issueActivationCode(
    @TenantId() tenantId: string,
    @UserId() userId: string,
  ): Promise<IssuedActivationCode> {
    return this.users.issueActivationCode(tenantId, userId);
  }
}
