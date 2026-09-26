import { Injectable, Logger } from '@nestjs/common';

/**
 * Audit logging.
 *
 * Events are emitted to the structured log (nestjs-pino binds the current request, so each
 * line carries req.id / requestId). Persistence to a tenant-scoped AuditLog table arrives with
 * authentication in Phase 3; callers will not change.
 *
 * Actor: until Phase 3 there is no authenticated identity, so platform actions are recorded
 * as `unauthenticated-platform-dev`. This is a truthful placeholder, not an identity.
 */
export const UNAUTHENTICATED_PLATFORM_ACTOR = 'unauthenticated-platform-dev';

export interface AuditEvent {
  action: string;
  resourceType: string;
  resourceId?: string;
  actor?: string;
  tenantId?: string;
  tenantKey?: string;
  /** Names of changed fields only — values are omitted to keep secrets out of logs. */
  changedFields?: string[];
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  record(event: AuditEvent): void {
    const audit = {
      ...event,
      actor: event.actor ?? UNAUTHENTICATED_PLATFORM_ACTOR,
      at: new Date().toISOString(),
    };
    this.logger.log({ audit }, `audit:${event.action}`);
  }
}
