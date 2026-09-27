import type {
  Paginated,
  TenantBranding,
  TenantConfigurationEntry,
  TenantDetail,
  TenantDomain,
  TenantFeatureState,
  TenantStats,
  TenantSummary,
} from '@acadlyx/tenant-config';
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
import { RequirePermission } from '../../auth/core/access.decorators.js';
import {
  AddDomainDto,
  CreateTenantDto,
  ListTenantsQueryDto,
  SetConfigurationDto,
  SetFeatureDto,
  UpdateBrandingDto,
  UpdateDomainDto,
  UpdateTenantDto,
} from './dto/tenant.dto.js';
import { TenantSettingsService } from './tenant-settings.service.js';
import { TenantsService } from './tenants.service.js';

const TenantId = () => Param('tenantId', new ParseUUIDPipe({ version: '7' }));
const DomainId = () => Param('domainId', new ParseUUIDPipe({ version: '7' }));

/**
 * PLATFORM-scoped tenant management (/api/v1/platform/tenants). No tenant resolution runs here.
 *
 * Requires an authenticated Platform Admin session and the platform permission named on each
 * route (platform.tenant.read / platform.tenant.manage). Tenant identities get 403.
 */
@Controller('platform/tenants')
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly settings: TenantSettingsService,
  ) {}

  @RequirePermission('platform.tenant.read')
  @Get()
  list(@Query() query: ListTenantsQueryDto): Promise<Paginated<TenantSummary>> {
    return this.tenants.list(query);
  }

  @RequirePermission('platform.tenant.read')
  @Get('stats')
  stats(): Promise<TenantStats> {
    return this.tenants.stats();
  }

  @RequirePermission('platform.tenant.manage')
  @Post()
  create(@Body() dto: CreateTenantDto): Promise<TenantDetail> {
    return this.tenants.create(dto);
  }

  @RequirePermission('platform.tenant.read')
  @Get(':tenantId')
  get(@TenantId() id: string): Promise<TenantDetail> {
    return this.tenants.get(id);
  }

  @RequirePermission('platform.tenant.manage')
  @Patch(':tenantId')
  update(@TenantId() id: string, @Body() dto: UpdateTenantDto): Promise<TenantDetail> {
    return this.tenants.update(id, dto);
  }

  @RequirePermission('platform.tenant.manage')
  @Post(':tenantId/activate')
  @HttpCode(HttpStatus.OK)
  activate(@TenantId() id: string): Promise<TenantDetail> {
    return this.tenants.transition(id, 'activate');
  }

  @RequirePermission('platform.tenant.manage')
  @Post(':tenantId/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(@TenantId() id: string): Promise<TenantDetail> {
    return this.tenants.transition(id, 'suspend');
  }

  @RequirePermission('platform.tenant.manage')
  @Post(':tenantId/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@TenantId() id: string): Promise<TenantDetail> {
    return this.tenants.transition(id, 'deactivate');
  }

  @RequirePermission('platform.tenant.manage')
  @Post(':tenantId/archive')
  @HttpCode(HttpStatus.OK)
  archive(@TenantId() id: string): Promise<TenantDetail> {
    return this.tenants.transition(id, 'archive');
  }

  @RequirePermission('platform.tenant.read')
  @Get(':tenantId/domains')
  listDomains(@TenantId() id: string): Promise<TenantDomain[]> {
    return this.settings.listDomains(id);
  }

  @RequirePermission('platform.tenant.manage')
  @Post(':tenantId/domains')
  addDomain(@TenantId() id: string, @Body() dto: AddDomainDto): Promise<TenantDomain> {
    return this.settings.addDomain(id, dto);
  }

  @RequirePermission('platform.tenant.manage')
  @Patch(':tenantId/domains/:domainId')
  updateDomain(
    @TenantId() id: string,
    @DomainId() domainId: string,
    @Body() dto: UpdateDomainDto,
  ): Promise<TenantDomain> {
    return this.settings.updateDomain(id, domainId, dto);
  }

  @RequirePermission('platform.tenant.manage')
  @Delete(':tenantId/domains/:domainId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeDomain(@TenantId() id: string, @DomainId() domainId: string): Promise<void> {
    return this.settings.removeDomain(id, domainId);
  }

  @RequirePermission('platform.tenant.read')
  @Get(':tenantId/branding')
  getBranding(@TenantId() id: string): Promise<TenantBranding | null> {
    return this.settings.getBranding(id);
  }

  @RequirePermission('platform.tenant.manage')
  @Put(':tenantId/branding')
  updateBranding(@TenantId() id: string, @Body() dto: UpdateBrandingDto): Promise<TenantBranding> {
    return this.settings.updateBranding(id, dto);
  }

  @RequirePermission('platform.tenant.read')
  @Get(':tenantId/features')
  listFeatures(@TenantId() id: string): Promise<TenantFeatureState[]> {
    return this.settings.listFeatures(id);
  }

  @RequirePermission('platform.tenant.manage')
  @Put(':tenantId/features/:featureKey')
  setFeature(
    @TenantId() id: string,
    @Param('featureKey') featureKey: string,
    @Body() dto: SetFeatureDto,
  ): Promise<TenantFeatureState> {
    return this.settings.setFeature(id, featureKey, dto.enabled);
  }

  @RequirePermission('platform.tenant.read')
  @Get(':tenantId/configuration')
  listConfiguration(@TenantId() id: string): Promise<TenantConfigurationEntry[]> {
    return this.settings.listConfiguration(id);
  }

  @RequirePermission('platform.tenant.manage')
  @Put(':tenantId/configuration/:key')
  setConfiguration(
    @TenantId() id: string,
    @Param('key') key: string,
    @Body() dto: SetConfigurationDto,
  ): Promise<TenantConfigurationEntry> {
    return this.settings.setConfiguration(id, key, dto.value);
  }

  @RequirePermission('platform.tenant.manage')
  @Delete(':tenantId/configuration/:key')
  resetConfiguration(
    @TenantId() id: string,
    @Param('key') key: string,
  ): Promise<TenantConfigurationEntry> {
    return this.settings.resetConfiguration(id, key);
  }
}
