import { Injectable, Logger } from '@nestjs/common';
import type { Owner } from '../../auth/core/owner.js';
import { PlatformPrismaService } from '../../database/platform-prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { TenantContext } from '../../tenancy/tenant-context.js';
import { TenantPrismaService } from '../../tenancy/tenant-prisma.service.js';
import { RequestContext } from '../request-context.js';

/**
 * Persistent audit logging (Phase 3).
 *
 *   recordPlatform()  → platform_audit_logs (platform path). Actor = authenticated Platform Admin.
 *   recordSecurity()  → audit_logs (tenant path, RLS) for tenant identities, or
 *                       platform_audit_logs for platform identities.
 *
 * Every row carries requestId, IP, user agent and changed FIELD NAMES — never values, secrets,
 * credentials, codes or tokens. Events are also mirrored to the structured log. Audit write
 * failures are logged but never block the operation being audited.
 */
export interface AuditEvent {
  action: string;
  resourceType: string;
  resourceId?: string;
  tenantId?: string;
  tenantKey?: string;
  changedFields?: string[];
  /** Safe, non-secret context only. */
  metadata?: Record<string, unknown>;
  /** Overrides the actor (e.g. `system:cli`). */
  actorLabel?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(
    private readonly platform: PlatformPrismaService,
    private readonly tenant: TenantPrismaService,
  ) {}

  /** Platform-scope action (tenant management, tenant-user administration, platform auth). */
  async recordPlatform(event: AuditEvent): Promise<void> {
    const actor = this.actor(event);
    const meta = RequestContext.meta();
    this.mirror(event, actor.label);
    try {
      await this.platform.platformAuditLog.create({
        data: {
          actorPlatformUserId: actor.platformUserId,
          actorLabel: actor.label,
          tenantId: event.tenantId ?? null,
          action: event.action,
          resourceType: event.resourceType,
          resourceId: event.resourceId ?? null,
          requestId: meta.requestId,
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
          changedFields: event.changedFields ?? [],
          metadata: toJson({
            ...event.metadata,
            ...(event.tenantKey ? { tenantKey: event.tenantKey } : {}),
          }),
        },
      });
    } catch (error) {
      this.logger.error(`Audit write failed for ${event.action}: ${(error as Error).message}`);
    }
  }

  /** Security event about an identity (login, logout, MFA, credential changes, …). */
  async recordSecurity(subject: Owner, event: AuditEvent): Promise<void> {
    if (subject.scope === 'PLATFORM') {
      await this.recordPlatform({
        ...event,
        metadata: { ...event.metadata, subjectPlatformUserId: subject.platformUserId },
      });
      return;
    }
    const actor = this.actor(event);
    const meta = RequestContext.meta();
    this.mirror({ ...event, tenantId: subject.tenantId }, actor.label);
    try {
      await this.tenant.run((tx) =>
        tx.auditLog.create({
          data: {
            tenantId: subject.tenantId,
            actorUserId: actor.userId ?? null,
            actorLabel: actor.label,
            action: event.action,
            resourceType: event.resourceType,
            resourceId: event.resourceId ?? null,
            requestId: meta.requestId,
            ipAddress: meta.ip,
            userAgent: meta.userAgent,
            changedFields: event.changedFields ?? [],
            metadata: toJson({ ...event.metadata, subjectUserId: subject.userId }),
          },
        }),
      );
    } catch (error) {
      this.logger.error(`Audit write failed for ${event.action}: ${(error as Error).message}`);
    }
  }

  /**
   * Tenant-scope business action by the authenticated school user (Phase 4+: school & academic
   * configuration). Written to audit_logs on the tenant path (RLS) for the current tenant.
   */
  async recordTenant(event: AuditEvent): Promise<void> {
    const actor = this.actor(event);
    const meta = RequestContext.meta();
    const tenantId = TenantContext.getTenantId();
    this.mirror({ ...event, tenantId }, actor.label);
    try {
      await this.tenant.run((tx) =>
        tx.auditLog.create({
          data: {
            tenantId,
            actorUserId: actor.userId ?? null,
            actorLabel: actor.label,
            action: event.action,
            resourceType: event.resourceType,
            resourceId: event.resourceId ?? null,
            requestId: meta.requestId,
            ipAddress: meta.ip,
            userAgent: meta.userAgent,
            changedFields: event.changedFields ?? [],
            ...(event.metadata ? { metadata: toJson(event.metadata) } : {}),
          },
        }),
      );
    } catch (error) {
      this.logger.error(`Audit write failed for ${event.action}: ${(error as Error).message}`);
    }
  }

  private actor(event: AuditEvent): {
    label: string;
    userId?: string;
    platformUserId: string | null;
  } {
    const auth = RequestContext.state()?.auth;
    if (event.actorLabel) return { label: event.actorLabel, platformUserId: null };
    if (auth?.scope === 'PLATFORM') {
      return { label: `platform-user:${auth.platformUserId}`, platformUserId: auth.platformUserId };
    }
    if (auth?.scope === 'TENANT') {
      return { label: `user:${auth.userId}`, userId: auth.userId, platformUserId: null };
    }
    return { label: 'anonymous', platformUserId: null };
  }

  private mirror(event: AuditEvent, actor: string): void {
    this.logger.log(
      {
        audit: {
          action: event.action,
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          tenantId: event.tenantId,
          tenantKey: event.tenantKey,
          changedFields: event.changedFields,
          actor,
          requestId: RequestContext.meta().requestId,
        },
      },
      `audit:${event.action}`,
    );
  }
}

function toJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
