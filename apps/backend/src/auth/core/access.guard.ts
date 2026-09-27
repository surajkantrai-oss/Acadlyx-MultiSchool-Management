import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  tenantConflict,
  tenantNotFound,
  tenantUnavailable,
} from '../../common/errors/domain-errors.js';
import { RequestContext } from '../../common/request-context.js';
import { TenantContext } from '../../tenancy/tenant-context.js';
import { ACCESS_POLICY, type AccessPolicy, TENANT_ROUTE } from './access.decorators.js';
import {
  authRequired,
  invalidToken,
  permissionDenied,
  scopeMismatch,
  sessionRevoked,
  tenantMismatch,
  tokenExpired,
} from './auth-errors.js';
import { AUDIENCES, TokenService } from './crypto/token.service.js';
import { RbacService } from './rbac.service.js';
import { SessionsService } from './sessions.service.js';

/**
 * Global access control, in the approved order:
 *
 *   tenant routes:   resolve tenant → lifecycle (404/400/403) → bearer token → signature/expiry
 *                    → audience = tenant access → token tenant == resolved tenant (TENANT_MISMATCH)
 *                    → session valid & account ACTIVE → roles/permissions → authorise
 *   platform routes: bearer token → audience = platform access → session → permissions → authorise
 *
 * A genuine token of the other scope yields 403 SCOPE_MISMATCH. Routes without a declared policy
 * fail closed (500). The authenticated identity is stored in the per-request context.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionsService,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const policy = this.reflector.getAllAndOverride<AccessPolicy | undefined>(
      ACCESS_POLICY,
      targets,
    );
    const tenantRoute =
      this.reflector.getAllAndOverride<boolean | undefined>(TENANT_ROUTE, targets) === true;
    if (!policy) throw new InternalServerErrorException('Route access policy is not declared');

    if (tenantRoute) this.enforceTenantResolution();
    if (policy.kind === 'public') return true;

    if (policy.scope === 'TENANT' && !tenantRoute) {
      throw new InternalServerErrorException('Tenant-authenticated route is not tenant-scoped');
    }
    if (policy.scope === 'PLATFORM' && tenantRoute) {
      throw new InternalServerErrorException(
        'Platform-authenticated route must not be tenant-scoped',
      );
    }

    const token = bearer(context.switchToHttp().getRequest<Request>());
    if (!token) throw authRequired();
    const expected = policy.scope === 'TENANT' ? AUDIENCES.tenantAccess : AUDIENCES.platformAccess;
    const other = policy.scope === 'TENANT' ? AUDIENCES.platformAccess : AUDIENCES.tenantAccess;
    const verified = await this.tokens.verify(token, [expected, other]);
    if (!verified.ok) {
      if (verified.reason === 'expired') throw tokenExpired();
      if (verified.reason === 'wrong-audience') throw scopeMismatch();
      throw invalidToken();
    }
    if (verified.audience !== expected || verified.claims.scope !== policy.scope)
      throw scopeMismatch();
    const { claims } = verified;
    if (!claims.sid) throw invalidToken();

    let tenantId: string | undefined;
    if (policy.scope === 'TENANT') {
      tenantId = TenantContext.getTenantId();
      // The token's school must be the school this request resolved to — before any data access.
      if (!claims.tid || claims.tid !== tenantId) throw tenantMismatch();
    }

    const check = await this.sessions.check(policy.scope, claims.sid, claims.sub);
    if (!check.ok) throw sessionRevoked();
    if (policy.scope === 'TENANT' && check.session.tenantId !== tenantId) throw tenantMismatch();

    const grants = await this.rbac.resolve(policy.scope, claims.sub);
    const state = RequestContext.state();
    if (!state) throw new InternalServerErrorException('Request context is not established');
    state.auth =
      policy.scope === 'TENANT'
        ? {
            scope: 'TENANT',
            userId: claims.sub,
            tenantId: tenantId ?? '',
            sessionId: claims.sid,
            ...grants,
          }
        : { scope: 'PLATFORM', platformUserId: claims.sub, sessionId: claims.sid, ...grants };

    if (policy.permission && !grants.permissions.includes(policy.permission))
      throw permissionDenied();
    return true;
  }

  private enforceTenantResolution(): void {
    const resolution = TenantContext.resolution();
    if (!resolution) {
      throw new InternalServerErrorException('Tenant resolution did not run for this route');
    }
    if (resolution.outcome === 'conflict') throw tenantConflict();
    if (resolution.outcome === 'not-found') throw tenantNotFound();
    if (resolution.tenant.status !== 'ACTIVE') throw tenantUnavailable();
  }
}

function bearer(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(header.trim());
  return match?.[1];
}

/** The authenticated identity for the current request (set by AccessGuard). */
export function currentAuth() {
  const auth = RequestContext.state()?.auth;
  if (!auth) throw new InternalServerErrorException('No authenticated identity for this request');
  return auth;
}
