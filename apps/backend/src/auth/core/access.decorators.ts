import { getPermissionScope } from './permission-scope.js';
import type { PermissionKey } from '@acadlyx/permissions';
import { SetMetadata } from '@nestjs/common';

export const ACCESS_POLICY = 'acadlyx:access-policy';
export const TENANT_ROUTE = 'acadlyx:tenant-route';

export type AccessPolicy =
  | { kind: 'public' }
  | { kind: 'authenticated'; scope: 'TENANT' | 'PLATFORM'; permission?: PermissionKey };

/**
 * Every route MUST declare exactly one access policy; AccessGuard rejects undeclared routes
 * (fail closed), so a new endpoint can never be accidentally unauthenticated.
 */
export const Public = () => SetMetadata(ACCESS_POLICY, { kind: 'public' } satisfies AccessPolicy);

/** Any authenticated identity of `scope` (e.g. /me, own sessions). */
export const Authenticated = (scope: 'TENANT' | 'PLATFORM') =>
  SetMetadata(ACCESS_POLICY, { kind: 'authenticated', scope } satisfies AccessPolicy);

/** Authenticated identity holding `permission`; the scope is taken from the permission. */
export const RequirePermission = (permission: PermissionKey) =>
  SetMetadata(ACCESS_POLICY, {
    kind: 'authenticated',
    scope: getPermissionScope(permission),
    permission,
  } satisfies AccessPolicy);

/** Marks a controller as tenant-scoped: tenant resolution + lifecycle are enforced first. */
export const TenantScoped = () => SetMetadata(TENANT_ROUTE, true);
