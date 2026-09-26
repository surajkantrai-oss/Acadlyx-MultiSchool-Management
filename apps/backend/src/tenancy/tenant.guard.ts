import {
  applyDecorators,
  type CanActivate,
  Injectable,
  InternalServerErrorException,
  UseGuards,
} from '@nestjs/common';
import {
  tenantConflict,
  tenantNotFound,
  tenantUnavailable,
} from '../common/errors/domain-errors.js';
import { TenantContext } from './tenant-context.js';

/**
 * Enforces tenant resolution outcomes for tenant-scoped routes:
 *   no resolution state        → 500 (middleware not applied — fail closed)
 *   conflict                   → 400 TENANT_CONFLICT
 *   not found                  → 404 TENANT_NOT_FOUND
 *   resolved but not ACTIVE    → 403 TENANT_UNAVAILABLE (DRAFT/SUSPENDED/INACTIVE/ARCHIVED)
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(): boolean {
    const resolution = TenantContext.resolution();
    if (!resolution) {
      throw new InternalServerErrorException('Tenant resolution did not run for this route');
    }
    if (resolution.outcome === 'conflict') throw tenantConflict();
    if (resolution.outcome === 'not-found') throw tenantNotFound();
    if (resolution.tenant.status !== 'ACTIVE') throw tenantUnavailable();
    return true;
  }
}

/** Marks a controller/handler as tenant-scoped. Use only inside TenantApiModule. */
export const TenantScoped = () => applyDecorators(UseGuards(TenantGuard));
