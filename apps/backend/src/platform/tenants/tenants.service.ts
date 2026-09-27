import {
  availableActions,
  canTransition,
  isFeatureKey,
  TENANT_ERROR_CODES,
  TENANT_LIFECYCLE_ACTIONS,
  TENANT_STATUSES,
  type FeatureKey,
  type Paginated,
  type TenantDetail,
  type TenantLifecycleAction,
  type TenantStats,
  type TenantStatus,
  type TenantSummary,
} from '@acadlyx/tenant-config';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { conflict, isUniqueViolation, notFound } from '../../common/errors/domain-errors.js';
import { PlatformPrismaService } from '../../database/platform-prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { toBrandingDto, toDomainDto } from '../../tenancy/tenant-mappers.js';
import type { CreateTenantDto, ListTenantsQueryDto, UpdateTenantDto } from './dto/tenant.dto.js';

const AUDIT_ACTION: Record<TenantLifecycleAction, string> = {
  activate: 'TENANT_ACTIVATED',
  suspend: 'TENANT_SUSPENDED',
  deactivate: 'TENANT_DEACTIVATED',
  archive: 'TENANT_ARCHIVED',
};

const tenantNotFoundError = () => notFound(TENANT_ERROR_CODES.NOT_FOUND, 'Tenant not found');

/** Platform-scoped tenant management. Never hard-deletes tenants. */
@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListTenantsQueryDto): Promise<Paginated<TenantSummary>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.TenantWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.search) {
      const term = query.search;
      where.OR = [
        { displayName: { contains: term, mode: 'insensitive' } },
        { key: { contains: term, mode: 'insensitive' } },
        { slug: { contains: term, mode: 'insensitive' } },
        { domains: { some: { domain: { contains: term.toLowerCase() } } } },
      ];
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.tenant.count({ where }),
      this.prisma.tenant.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { domains: { where: { isPrimary: true }, orderBy: { type: 'asc' }, take: 1 } },
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        key: row.key,
        slug: row.slug,
        displayName: row.displayName,
        status: row.status,
        primaryDomain: row.domains[0]?.domain ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async stats(): Promise<TenantStats> {
    const groups = await this.prisma.tenant.groupBy({ by: ['status'], _count: { _all: true } });
    const byStatus = Object.fromEntries(TENANT_STATUSES.map((s) => [s, 0])) as Record<
      TenantStatus,
      number
    >;
    for (const group of groups) byStatus[group.status] = group._count._all;
    return { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus };
  }

  async create(dto: CreateTenantDto): Promise<TenantDetail> {
    const active = dto.initialStatus === 'ACTIVE';
    try {
      const tenant = await this.prisma.tenant.create({
        data: {
          key: dto.key,
          slug: dto.slug,
          displayName: dto.displayName,
          legalName: dto.legalName ?? null,
          status: active ? 'ACTIVE' : 'DRAFT',
          firstActivatedAt: active ? new Date() : null,
        },
      });
      await this.audit.recordPlatform({
        action: 'TENANT_CREATED',
        resourceType: 'tenant',
        resourceId: tenant.id,
        tenantId: tenant.id,
        tenantKey: tenant.key,
        changedFields: Object.keys(dto),
        metadata: { status: tenant.status },
      });
      return await this.get(tenant.id);
    } catch (error) {
      throw this.mapUniqueErrors(error);
    }
  }

  async get(id: string): Promise<TenantDetail> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        domains: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        branding: true,
        features: { where: { enabled: true }, orderBy: { featureKey: 'asc' } },
        _count: { select: { configurations: true } },
      },
    });
    if (!tenant) throw tenantNotFoundError();
    const primary = tenant.domains.find((d) => d.isPrimary) ?? null;
    return {
      id: tenant.id,
      key: tenant.key,
      slug: tenant.slug,
      displayName: tenant.displayName,
      legalName: tenant.legalName,
      status: tenant.status,
      primaryDomain: primary?.domain ?? null,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
      firstActivatedAt: tenant.firstActivatedAt?.toISOString() ?? null,
      archivedAt: tenant.archivedAt?.toISOString() ?? null,
      slugLocked: tenant.firstActivatedAt !== null,
      availableActions: availableActions(tenant.status),
      domains: tenant.domains.map(toDomainDto),
      branding: tenant.branding ? toBrandingDto(tenant.branding) : null,
      enabledFeatures: tenant.features
        .map((f) => f.featureKey)
        .filter((key): key is FeatureKey => isFeatureKey(key)),
      configurationOverrides: tenant._count.configurations,
    };
  }

  async update(id: string, dto: UpdateTenantDto): Promise<TenantDetail> {
    const current = await this.requireTenant(id);
    const data: Prisma.TenantUpdateInput = {};
    const changed: string[] = [];
    if (dto.displayName !== undefined && dto.displayName !== current.displayName) {
      data.displayName = dto.displayName;
      changed.push('displayName');
    }
    if (dto.legalName !== undefined && dto.legalName !== current.legalName) {
      data.legalName = dto.legalName;
      changed.push('legalName');
    }
    if (dto.slug !== undefined && dto.slug !== current.slug) {
      // Slugs may appear in URLs/app configs once a tenant has gone live.
      if (current.firstActivatedAt !== null) {
        throw conflict(
          TENANT_ERROR_CODES.SLUG_LOCKED,
          'Slug cannot be changed after the tenant has been activated',
        );
      }
      data.slug = dto.slug;
      changed.push('slug');
    }
    if (changed.length > 0) {
      try {
        await this.prisma.tenant.update({ where: { id }, data });
      } catch (error) {
        throw this.mapUniqueErrors(error);
      }
      await this.audit.recordPlatform({
        action: 'TENANT_UPDATED',
        resourceType: 'tenant',
        resourceId: id,
        tenantId: id,
        tenantKey: current.key,
        changedFields: changed,
      });
    }
    return this.get(id);
  }

  async transition(id: string, action: TenantLifecycleAction): Promise<TenantDetail> {
    const current = await this.requireTenant(id);
    const target = TENANT_LIFECYCLE_ACTIONS[action];
    if (!canTransition(current.status, target)) {
      throw conflict(
        TENANT_ERROR_CODES.INVALID_TRANSITION,
        `Cannot ${action} a tenant that is ${current.status}`,
      );
    }
    // Compare-and-set on the observed status so concurrent transitions cannot both succeed.
    const { count } = await this.prisma.tenant.updateMany({
      where: { id, status: current.status },
      data: {
        status: target,
        ...(target === 'ACTIVE' && current.firstActivatedAt === null
          ? { firstActivatedAt: new Date() }
          : {}),
        ...(target === 'ARCHIVED' ? { archivedAt: new Date() } : {}),
      },
    });
    if (count === 0) {
      throw conflict(
        TENANT_ERROR_CODES.INVALID_TRANSITION,
        'Tenant status changed concurrently; reload and retry',
      );
    }
    await this.audit.recordPlatform({
      action: AUDIT_ACTION[action],
      resourceType: 'tenant',
      resourceId: id,
      tenantId: id,
      tenantKey: current.key,
      changedFields: ['status'],
      metadata: { from: current.status, to: target },
    });
    return this.get(id);
  }

  async requireTenant(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw tenantNotFoundError();
    return tenant;
  }

  private mapUniqueErrors(error: unknown): unknown {
    if (isUniqueViolation(error, 'tenants_key_key')) {
      return conflict(TENANT_ERROR_CODES.KEY_TAKEN, 'A tenant with this key already exists');
    }
    if (isUniqueViolation(error, 'tenants_slug_key')) {
      return conflict(TENANT_ERROR_CODES.SLUG_TAKEN, 'A tenant with this slug already exists');
    }
    return error;
  }
}
