import { Injectable, Logger } from '@nestjs/common';

/**
 * Audit logging integration point.
 *
 * Phase 1 emits audit events to the structured log only. The persistent, tenant-scoped
 * AuditLog table (blueprint §26.2) is introduced together with tenancy/auth, at which
 * point this service writes to the database without changing its callers.
 */
export interface AuditEvent {
  action: string;
  resourceType: string;
  resourceId?: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  record(event: AuditEvent): void {
    this.logger.log({ audit: event }, `audit:${event.action}`);
  }
}
