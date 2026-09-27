import { mfaRequiredForRoles, pinAllowedForRoles } from '@acadlyx/permissions';
import type {
  AuthResult,
  AuthTokens,
  DeviceDescriptor,
  MfaEnrollmentComplete,
  MfaEnrollmentStart,
} from '@acadlyx/types';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  credentialTypeNotAllowed,
  invalidCredentials,
  invalidMfa,
  invalidToken,
  mfaRequiredForRole,
  sessionRevoked,
} from './auth-errors.js';
import { AuthStore } from './auth-store.service.js';
import {
  afterFailure,
  isLocked,
  LOCKOUT,
  type LockoutPolicyKey,
  type LockoutState,
  PLATFORM_PASSWORD_MIN,
  TENANT_PASSWORD_MIN,
  validatePassword,
  validatePin,
} from './credential-policy.js';
import { PasswordHasher } from './crypto/password-hasher.js';
import { AUDIENCES, MFA_TOKEN_TTL_SECONDS, TokenService } from './crypto/token.service.js';
import { type IdentityRecord, loadIdentity, updateIdentity } from './identity-repo.js';
import { MfaService } from './mfa.service.js';
import { type Owner, ownerId } from './owner.js';
import { RbacService } from './rbac.service.js';
import { sessionOwner, SessionsService } from './sessions.service.js';

type Db = Prisma.TransactionClient;
const MAX_MFA_FAILURES_PER_CHALLENGE = 5;

interface RawLockout {
  failed_login_count: number;
  lockout_count: number;
  lockout_window_started_at: Date | null;
  locked_until: Date | null;
}

/**
 * Scope-neutral authentication flows shared by tenant and platform identities:
 * credential verification with lockout, rehash-on-login, session issue incl. the MFA step,
 * MFA completion/enrollment, credential change and account security. Scope-specific code only
 * resolves WHO is logging in (identifiers, activation, recovery).
 */
@Injectable()
export class AuthFlowsService {
  constructor(
    private readonly store: AuthStore,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly sessions: SessionsService,
    private readonly mfa: MfaService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Verifies `secret` for an identity (null = no such account → equal-time dummy verification).
   * Enforces status ACTIVE + temporary lockout and rehashes outdated hashes. Every failure
   * produces the same public error.
   *
   * Concurrency-safe threshold: an attempt slot is reserved atomically (row lock) BEFORE the
   * secret is checked, so parallel guesses cannot exceed the policy's failure limit.
   */
  async verifyCredential(
    owner: Owner | null,
    identity: IdentityRecord | null,
    secret: string,
  ): Promise<void> {
    if (!owner || !identity?.credentialHash) {
      await this.hasher.verifyDummy(secret);
      throw invalidCredentials();
    }
    if (identity.status !== 'ACTIVE') {
      await this.hasher.verifyDummy(secret);
      await this.audit.recordSecurity(owner, {
        action: 'LOGIN_FAILED',
        resourceType: 'account',
        resourceId: identity.id,
        metadata: { reason: 'inactive' },
      });
      throw invalidCredentials();
    }
    const policy = this.policyFor(owner, identity);
    const slot = await this.reserveAttempt(owner, policy);
    if (!slot.allowed) {
      await this.hasher.verifyDummy(secret);
      await this.audit.recordSecurity(owner, {
        action: 'LOGIN_FAILED',
        resourceType: 'account',
        resourceId: identity.id,
        metadata: { reason: 'locked' },
      });
      throw invalidCredentials();
    }
    const valid = await this.hasher.verify(identity.credentialHash, secret);
    if (!valid) {
      await this.applyFailure(owner, identity.id, policy, slot.attempt, 'bad_credential');
      throw invalidCredentials();
    }
    const rehash = this.hasher.needsRehash(identity.credentialHash)
      ? await this.hasher.hash(secret)
      : null;
    await this.store.run(owner.scope, (db) =>
      updateIdentity(db, owner, {
        failedLoginCount: 0,
        ...(rehash ? { credentialHash: rehash } : {}),
      }),
    );
  }

  private policyFor(
    owner: Owner,
    identity: Pick<IdentityRecord, 'credentialType'>,
  ): LockoutPolicyKey {
    if (owner.scope === 'PLATFORM') return 'PLATFORM';
    return identity.credentialType === 'PIN' ? 'PIN' : 'PASSWORD';
  }

  /** Locks the identity row (FOR UPDATE) for the rest of the transaction; PostgreSQL is authoritative. */
  private async lockRow(db: Db, owner: Owner): Promise<LockoutState> {
    const rows =
      owner.scope === 'TENANT'
        ? await db.$queryRaw<
            RawLockout[]
          >`SELECT failed_login_count, lockout_count, lockout_window_started_at, locked_until FROM users WHERE id = ${owner.userId}::uuid FOR UPDATE`
        : await db.$queryRaw<
            RawLockout[]
          >`SELECT failed_login_count, lockout_count, lockout_window_started_at, locked_until FROM platform_users WHERE id = ${owner.platformUserId}::uuid FOR UPDATE`;
    const row = rows[0];
    if (!row) throw invalidCredentials();
    return {
      failedLoginCount: row.failed_login_count,
      lockoutCount: row.lockout_count,
      lockoutWindowStartedAt: row.lockout_window_started_at,
      lockedUntil: row.locked_until,
    };
  }

  /** Atomically takes the next attempt number, unless the account is (or would be) locked. */
  private reserveAttempt(
    owner: Owner,
    policy: LockoutPolicyKey,
  ): Promise<{ allowed: false } | { allowed: true; attempt: number }> {
    return this.store.run(owner.scope, async (db) => {
      const state = await this.lockRow(db, owner);
      const attempt = state.failedLoginCount + 1;
      if (isLocked(state, new Date()) || attempt > LOCKOUT[policy].maxFailures)
        return { allowed: false as const };
      await updateIdentity(db, owner, { failedLoginCount: attempt });
      return { allowed: true as const, attempt };
    });
  }

  /** Records a failed reserved attempt; the attempt that reaches the threshold applies the lock. */
  private async applyFailure(
    owner: Owner,
    identityId: string,
    policy: LockoutPolicyKey,
    attempt: number,
    reason: string,
  ): Promise<void> {
    await this.audit.recordSecurity(owner, {
      action: 'LOGIN_FAILED',
      resourceType: 'account',
      resourceId: identityId,
      metadata: { reason },
    });
    if (attempt < LOCKOUT[policy].maxFailures) return;
    const next = await this.store.run(owner.scope, async (db) => {
      const state = await this.lockRow(db, owner);
      if (isLocked(state, new Date())) return null; // a concurrent attempt already locked it
      const locked = afterFailure(
        { ...state, failedLoginCount: LOCKOUT[policy].maxFailures - 1 },
        policy,
        new Date(),
      );
      await updateIdentity(db, owner, {
        failedLoginCount: locked.failedLoginCount,
        lockoutCount: locked.lockoutCount,
        lockoutWindowStartedAt: locked.lockoutWindowStartedAt,
        lockedUntil: locked.lockedUntil,
      });
      return locked;
    });
    if (next) {
      await this.audit.recordSecurity(owner, {
        action: 'ACCOUNT_LOCKED',
        resourceType: 'account',
        resourceId: identityId,
        metadata: { lockedUntil: next.lockedUntil?.toISOString(), lockoutCount: next.lockoutCount },
      });
    }
  }

  /** Counts a failure that happened outside password verification (e.g. exhausted MFA challenge). */
  async registerFailure(
    owner: Owner,
    identity: IdentityRecord,
    policy: LockoutPolicyKey,
    reason: string,
  ): Promise<void> {
    const slot = await this.reserveAttempt(owner, policy);
    if (slot.allowed) await this.applyFailure(owner, identity.id, policy, slot.attempt, reason);
  }

  /** Creates the session after a verified first factor; returns tokens or the MFA step. */
  async startSession(owner: Owner, device: DeviceDescriptor | undefined): Promise<AuthResult> {
    const { roles } = await this.rbac.resolve(owner.scope, ownerId(owner));
    const roleRequiresMfa = mfaRequiredForRoles(roles);
    const result = await this.store.run(owner.scope, async (db) => {
      const enrolled = (await this.mfa.status(db, owner)).enrolled;
      // Second factor applies when the role requires it OR the user has enrolled one voluntarily.
      const mfaRequired = roleRequiresMfa || enrolled;
      const resolved = await this.sessions.resolveDevice(db, owner, device);
      const { session, refreshToken } = await this.sessions.create(db, owner, {
        roles,
        mfaPending: mfaRequired,
        deviceId: resolved?.id ?? null,
      });
      if (!mfaRequired) await updateIdentity(db, owner, { lastLoginAt: new Date() });
      return { session, refreshToken, enrolled, mfaRequired, newDevice: resolved?.isNew === true };
    });
    const { mfaRequired } = result;
    if (result.newDevice) {
      await this.audit.recordSecurity(owner, {
        action: 'NEW_DEVICE_LOGIN',
        resourceType: 'device',
        resourceId: result.session.deviceId ?? undefined,
        metadata: { platform: device?.platform, sessionId: result.session.id },
      });
    }
    if (mfaRequired) {
      const { token, expiresAt } = await this.tokens.sign(
        AUDIENCES.mfa,
        {
          sub: ownerId(owner),
          scope: owner.scope,
          sid: result.session.id,
          ...(owner.scope === 'TENANT' ? { tid: owner.tenantId } : {}),
        },
        MFA_TOKEN_TTL_SECONDS,
      );
      return {
        status: result.enrolled ? 'MFA_REQUIRED' : 'MFA_ENROLLMENT_REQUIRED',
        mfaToken: token,
        mfaTokenExpiresAt: expiresAt.toISOString(),
      };
    }
    await this.auditLogin(owner, result.session.id);
    return this.sessions.issueTokens(result.session, result.refreshToken ?? '');
  }

  private async auditLogin(owner: Owner, sessionId: string): Promise<void> {
    await this.audit.recordSecurity(owner, {
      action: owner.scope === 'PLATFORM' ? 'PLATFORM_LOGIN' : 'LOGIN_SUCCESS',
      resourceType: 'session',
      resourceId: sessionId,
    });
  }

  /**
   * Resolves an MFA-step token to its pending session. `expectedTenantId` binds tenant tokens
   * to the resolved school.
   */
  async pendingFromMfaToken(
    scope: 'TENANT' | 'PLATFORM',
    mfaToken: string,
    expectedTenantId?: string,
  ) {
    const verified = await this.tokens.verify(mfaToken, [AUDIENCES.mfa]);
    if (!verified.ok || verified.claims.scope !== scope || !verified.claims.sid)
      throw invalidToken();
    if (scope === 'TENANT' && verified.claims.tid !== expectedTenantId) throw invalidToken();
    const session = await this.store.run(scope, (db) =>
      db.session.findUnique({ where: { id: verified.claims.sid ?? '' } }),
    );
    if (!session || !session.mfaPending || session.revokedAt || session.idleExpiresAt <= new Date())
      throw sessionRevoked();
    const owner = sessionOwner(session);
    if (ownerId(owner) !== verified.claims.sub) throw invalidToken();
    return { session, owner };
  }

  /** Completes a pending login with a TOTP or recovery code. */
  async completeMfa(
    scope: 'TENANT' | 'PLATFORM',
    mfaToken: string,
    factor: { code?: string; recoveryCode?: string },
    tenantId?: string,
  ): Promise<AuthTokens> {
    const { session, owner } = await this.pendingFromMfaToken(scope, mfaToken, tenantId);
    const used = await this.store.run(scope, (db) => this.mfa.verify(db, owner, factor));
    if (!used) {
      const attempts = session.mfaFailedAttempts + 1;
      await this.store.run(scope, async (db) => {
        await db.session.update({
          where: { id: session.id },
          data: { mfaFailedAttempts: attempts },
        });
        if (attempts >= MAX_MFA_FAILURES_PER_CHALLENGE)
          await this.sessions.revokeInDb(db, [session.id], 'mfa_failed');
      });
      await this.audit.recordSecurity(owner, {
        action: 'MFA_FAILED',
        resourceType: 'session',
        resourceId: session.id,
        metadata: { attempts },
      });
      if (attempts >= MAX_MFA_FAILURES_PER_CHALLENGE) {
        const identity = await this.store.run(scope, (db) => loadIdentity(db, owner));
        if (identity)
          await this.registerFailure(
            owner,
            identity,
            owner.scope === 'PLATFORM' ? 'PLATFORM' : 'PASSWORD',
            'mfa_failed',
          );
      }
      throw invalidMfa();
    }
    const { roles } = await this.rbac.resolve(scope, ownerId(owner));
    const completed = await this.store.run(scope, async (db) => {
      const result = await this.sessions.completeMfa(db, session, roles);
      await updateIdentity(db, owner, { lastLoginAt: new Date(), failedLoginCount: 0 });
      return result;
    });
    if (used === 'recovery') {
      await this.audit.recordSecurity(owner, {
        action: 'MFA_RECOVERY_CODE_USED',
        resourceType: 'account',
        resourceId: ownerId(owner),
      });
    }
    await this.auditLogin(owner, session.id);
    return this.sessions.issueTokens(completed.session, completed.refreshToken);
  }

  /** Enrollment for an authenticated owner, or for a pending login that must enroll first. */
  async startEnrollment(
    owner: Owner,
    account: string,
    issuer: string,
  ): Promise<MfaEnrollmentStart> {
    return this.store.run(owner.scope, (db) =>
      this.mfa.startEnrollment(db, owner, account, issuer),
    );
  }

  async confirmEnrollment(
    owner: Owner,
    code: string,
    pendingSession?: { id: string },
  ): Promise<MfaEnrollmentComplete> {
    const codes = await this.store.run(owner.scope, (db) =>
      this.mfa.confirmEnrollment(db, owner, code),
    );
    if (!codes) throw invalidMfa();
    await this.audit.recordSecurity(owner, {
      action: 'MFA_ENROLLED',
      resourceType: 'account',
      resourceId: ownerId(owner),
      metadata: { type: 'TOTP' },
    });
    if (!pendingSession) return { recoveryCodes: codes, auth: null };
    const { roles } = await this.rbac.resolve(owner.scope, ownerId(owner));
    const completed = await this.store.run(owner.scope, async (db) => {
      const session = await db.session.findUniqueOrThrow({ where: { id: pendingSession.id } });
      const result = await this.sessions.completeMfa(db, session, roles);
      await updateIdentity(db, owner, { lastLoginAt: new Date() });
      return result;
    });
    await this.auditLogin(owner, pendingSession.id);
    return {
      recoveryCodes: codes,
      auth: await this.sessions.issueTokens(completed.session, completed.refreshToken),
    };
  }

  /** Validates a new secret against the policy for the identity's roles. */
  validateNewSecret(
    scope: 'TENANT' | 'PLATFORM',
    roles: string[],
    type: 'PASSWORD' | 'PIN',
    secret: string,
  ): void {
    if (type === 'PIN') {
      if (scope === 'PLATFORM' || !pinAllowedForRoles(roles)) throw credentialTypeNotAllowed();
      validatePin(secret);
      return;
    }
    validatePassword(secret, scope === 'PLATFORM' ? PLATFORM_PASSWORD_MIN : TENANT_PASSWORD_MIN);
  }

  /** Change password/PIN: requires the current secret; revokes every other session. */
  async changeCredential(
    owner: Owner,
    sessionId: string,
    current: string,
    type: 'PASSWORD' | 'PIN',
    next: string,
  ): Promise<void> {
    const identity = await this.store.run(owner.scope, (db) => loadIdentity(db, owner));
    await this.verifyCredential(owner, identity, current);
    const { roles } = await this.rbac.resolve(owner.scope, ownerId(owner));
    this.validateNewSecret(owner.scope, roles, type, next);
    const hash = await this.hasher.hash(next);
    await this.store.run(owner.scope, async (db) => {
      await updateIdentity(db, owner, {
        credentialHash: hash,
        credentialType: type,
        credentialUpdatedAt: new Date(),
      });
      await this.sessions.revokeAll(db, owner, 'credential_changed', sessionId);
    });
    await this.audit.recordSecurity(owner, {
      action: type === 'PIN' ? 'PIN_CHANGED' : 'PASSWORD_CHANGED',
      resourceType: 'account',
      resourceId: ownerId(owner),
      metadata: { credentialType: type },
    });
  }

  /** MFA removal: re-authentication with current secret AND a valid code; not for MFA-mandatory roles. */
  async removeMfa(
    owner: Owner,
    sessionId: string,
    currentSecret: string,
    code: string,
  ): Promise<void> {
    const { roles } = await this.rbac.resolve(owner.scope, ownerId(owner));
    if (mfaRequiredForRoles(roles)) throw mfaRequiredForRole();
    const identity = await this.store.run(owner.scope, (db) => loadIdentity(db, owner));
    await this.verifyCredential(owner, identity, currentSecret);
    const ok = await this.store.run(owner.scope, (db) => this.mfa.verify(db, owner, { code }));
    if (!ok) throw invalidMfa();
    await this.store.run(owner.scope, async (db) => {
      await this.mfa.remove(db, owner);
      await this.sessions.revokeAll(db, owner, 'mfa_removed', sessionId);
    });
    await this.audit.recordSecurity(owner, {
      action: 'MFA_REMOVED',
      resourceType: 'account',
      resourceId: ownerId(owner),
    });
  }

  async regenerateRecoveryCodes(owner: Owner, code: string): Promise<string[]> {
    const codes = await this.store.run(owner.scope, async (db) => {
      const ok = await this.mfa.verify(db, owner, { code });
      return ok === 'totp' ? this.mfa.replaceRecoveryCodes(db, owner) : null;
    });
    if (!codes) throw invalidMfa();
    await this.audit.recordSecurity(owner, {
      action: 'MFA_RECOVERY_CODES_REGENERATED',
      resourceType: 'account',
      resourceId: ownerId(owner),
    });
    return codes;
  }

  async logout(owner: Owner, sessionId: string, all: boolean): Promise<void> {
    if (all) {
      // Revokes the session families (refresh tokens die with them) and clears their caches.
      await this.store.run(owner.scope, (db) => this.sessions.revokeAll(db, owner, 'logout_all'));
    } else {
      await this.sessions.revoke(owner.scope, [sessionId], 'logout');
    }
    await this.audit.recordSecurity(owner, {
      action: all ? 'LOGOUT_ALL' : 'LOGOUT',
      resourceType: 'session',
      resourceId: sessionId,
    });
  }

  async revokeOwnSession(owner: Owner, targetSessionId: string): Promise<boolean> {
    const found = await this.store.run(owner.scope, (db) =>
      db.session.findFirst({
        where: {
          id: targetSessionId,
          ...(owner.scope === 'TENANT'
            ? { userId: owner.userId }
            : { platformUserId: owner.platformUserId }),
          revokedAt: null,
        },
      }),
    );
    if (!found) return false;
    await this.sessions.revoke(owner.scope, [targetSessionId], 'user_revoked');
    await this.audit.recordSecurity(owner, {
      action: 'SESSION_REVOKED',
      resourceType: 'session',
      resourceId: targetSessionId,
    });
    return true;
  }

  async revokeOwnDevice(owner: Owner, deviceId: string): Promise<boolean> {
    const ok = await this.store.run(owner.scope, (db) =>
      this.sessions.revokeDevice(db, owner, deviceId),
    );
    if (ok)
      await this.audit.recordSecurity(owner, {
        action: 'DEVICE_REVOKED',
        resourceType: 'device',
        resourceId: deviceId,
      });
    return ok;
  }

  listSessions(owner: Owner, sessionId: string) {
    return this.store.run(owner.scope, (db: Db) =>
      this.sessions.listSessions(db, owner, sessionId),
    );
  }

  listDevices(owner: Owner) {
    return this.store.run(owner.scope, (db: Db) => this.sessions.listDevices(db, owner));
  }

  mfaStatus(owner: Owner) {
    return this.store.run(owner.scope, (db: Db) => this.mfa.status(db, owner));
  }
}
