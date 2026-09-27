import { PERMISSION_REGISTRY, type PermissionKey } from '@acadlyx/permissions';

export function getPermissionScope(permission: PermissionKey): 'TENANT' | 'PLATFORM' {
  const definition = PERMISSION_REGISTRY.find((p) => p.key === permission);
  if (!definition) throw new Error(`Unknown permission ${permission}`);
  return definition.scope;
}
