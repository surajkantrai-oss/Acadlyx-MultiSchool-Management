/**
 * The owner of a security row: a tenant user (tenant-scoped, RLS path) or a platform user
 * (platform path). Shared security tables store exactly one of the two (DB CHECK constraints).
 */
export type Owner =
  | { scope: 'TENANT'; tenantId: string; userId: string }
  | { scope: 'PLATFORM'; platformUserId: string };

export function ownerId(owner: Owner): string {
  return owner.scope === 'TENANT' ? owner.userId : owner.platformUserId;
}

/** Column values for inserting an owned row. */
export function ownerColumns(owner: Owner): {
  scope: 'TENANT' | 'PLATFORM';
  tenantId: string | null;
  userId: string | null;
  platformUserId: string | null;
} {
  return owner.scope === 'TENANT'
    ? { scope: 'TENANT', tenantId: owner.tenantId, userId: owner.userId, platformUserId: null }
    : { scope: 'PLATFORM', tenantId: null, userId: null, platformUserId: owner.platformUserId };
}

/** Filter for rows belonging to the owner. */
export function ownerWhere(owner: Owner): { userId: string } | { platformUserId: string } {
  return owner.scope === 'TENANT'
    ? { userId: owner.userId }
    : { platformUserId: owner.platformUserId };
}
