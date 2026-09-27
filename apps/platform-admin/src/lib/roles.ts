import { getRole, TENANT_ROLE_KEYS } from '@acadlyx/permissions';

/** Built-in school roles only (no custom roles in Phase 3). */
export const SCHOOL_ROLES = TENANT_ROLE_KEYS.map((key) => ({
  key,
  name: getRole(key)?.name ?? key,
}));

export function roleName(key: string): string {
  return getRole(key)?.name ?? key;
}
