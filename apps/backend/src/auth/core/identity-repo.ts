import type { Prisma } from '../../generated/prisma/client.js';
import type { LockoutState } from './credential-policy.js';
import type { Owner } from './owner.js';

type Db = Prisma.TransactionClient;

/** Scope-neutral view of an identity's login state (tenant User or PlatformUser). */
export interface IdentityRecord extends LockoutState {
  id: string;
  status: 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  displayName: string;
  credentialType: 'PASSWORD' | 'PIN' | null;
  credentialHash: string | null;
  email: string | null;
  phone: string | null;
  loginId: string | null;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
}

export async function loadIdentity(db: Db, owner: Owner): Promise<IdentityRecord | null> {
  if (owner.scope === 'TENANT') {
    const u = await db.user.findUnique({ where: { id: owner.userId } });
    return u ? { ...u } : null;
  }
  const p = await db.platformUser.findUnique({ where: { id: owner.platformUserId } });
  return p
    ? {
        ...p,
        credentialType: p.passwordHash ? 'PASSWORD' : null,
        credentialHash: p.passwordHash,
        phone: null,
        loginId: null,
        phoneVerifiedAt: null,
        emailVerifiedAt: null,
      }
    : null;
}

export type LoginStateUpdate = Partial<
  LockoutState & {
    lastLoginAt: Date;
    credentialHash: string;
    credentialType: 'PASSWORD' | 'PIN';
    credentialUpdatedAt: Date;
  }
>;

export async function updateIdentity(db: Db, owner: Owner, data: LoginStateUpdate): Promise<void> {
  if (owner.scope === 'TENANT') {
    await db.user.update({ where: { id: owner.userId }, data });
    return;
  }
  // Platform users only have passwords: credentialType is implied and not stored.
  const { credentialHash, ...rest } = data;
  delete rest.credentialType;
  await db.platformUser.update({
    where: { id: owner.platformUserId },
    data: { ...rest, ...(credentialHash !== undefined ? { passwordHash: credentialHash } : {}) },
  });
}
