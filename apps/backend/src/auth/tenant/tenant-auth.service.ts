import { mfaRequiredForRoles, pinAllowedForRoles } from '@acadlyx/permissions';
import type { AuthResult, DeviceDescriptor, MeResponse, OtpGrant } from '@acadlyx/types';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import type { OtpPurpose, Prisma, User } from '../../generated/prisma/client.js';
import { TenantContext } from '../../tenancy/tenant-context.js';
import { invalidCode, invalidCredentials, invalidToken } from '../core/auth-errors.js';
import { AuthFlowsService } from '../core/auth-flows.service.js';
import { AuthStore } from '../core/auth-store.service.js';
import { PasswordHasher } from '../core/crypto/password-hasher.js';
import { AUDIENCES, OTP_GRANT_TTL_SECONDS, TokenService } from '../core/crypto/token.service.js';
import { identifierCandidates, normalizeEmail, normalizePhone } from '../core/identifiers.js';
import { IdentifierLimiterService } from '../core/identifier-limiter.service.js';
import { MfaService } from '../core/mfa.service.js';
import { OtpDeliveryService } from '../core/otp/otp-delivery.js';
import { OtpService } from '../core/otp/otp.service.js';
import type { Owner } from '../core/owner.js';
import { RbacService } from '../core/rbac.service.js';
import { SessionsService } from '../core/sessions.service.js';

type Db = Prisma.TransactionClient;

/**
 * Tenant (school) identity flows. Every method runs inside a resolved, ACTIVE tenant and uses
 * only the tenant database path (TenantPrisma + RLS) — this module never imports the platform
 * client (ESLint-enforced).
 */
@Injectable()
export class TenantAuthService {
  constructor(
    private readonly store: AuthStore,
    private readonly flows: AuthFlowsService,
    private readonly limiter: IdentifierLimiterService,
    private readonly otp: OtpService,
    private readonly delivery: OtpDeliveryService,
    private readonly tokens: TokenService,
    private readonly hasher: PasswordHasher,
    private readonly rbac: RbacService,
    private readonly mfa: MfaService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
  ) {}

  private tenant() {
    return TenantContext.requireActiveTenant();
  }

  private owner(user: Pick<User, 'id' | 'tenantId'>): Owner {
    return { scope: 'TENANT', tenantId: user.tenantId, userId: user.id };
  }

  /** Precedence: login ID (exact), then email, then phone — within the resolved tenant only. */
  private async findByIdentifier(db: Db, raw: string): Promise<User | null> {
    const c = identifierCandidates(raw);
    if (c.loginId) {
      const byLogin = await db.user.findFirst({ where: { loginId: c.loginId } });
      if (byLogin) return byLogin;
    }
    if (c.email) {
      const byEmail = await db.user.findFirst({ where: { email: c.email } });
      if (byEmail) return byEmail;
    }
    if (c.phone) return db.user.findFirst({ where: { phone: c.phone } });
    return null;
  }

  async login(identifier: string, secret: string, device?: DeviceDescriptor): Promise<AuthResult> {
    const tenant = this.tenant();
    await this.limiter.hit(`tenant:${tenant.id}`, identifier);
    const user = await this.store.run('TENANT', (db) => this.findByIdentifier(db, identifier));
    const owner = user ? this.owner(user) : null;
    await this.flows.verifyCredential(owner, user, secret);
    if (!owner) throw invalidCredentials(); // verifyCredential already rejects unknown accounts
    return this.flows.startSession(owner, device);
  }

  refresh(refreshToken: string) {
    return this.sessions.rotate('TENANT', refreshToken, async (owner) =>
      owner.scope === 'TENANT' ? (await this.rbac.resolve('TENANT', owner.userId)).roles : [],
    );
  }

  // ------------------------------------------------------------ OTP-based flows

  /**
   * Starts activation or recovery. Always answers the same way, whether or not the identifier
   * matches an eligible account (no enumeration); codes go only to the registered channel.
   */
  async startOtpFlow(
    purpose: 'ACCOUNT_ACTIVATION' | 'ACCOUNT_RECOVERY',
    identifier: string,
  ): Promise<void> {
    this.delivery.assertAvailable();
    const tenant = this.tenant();
    const email = identifier.includes('@') ? normalizeEmail(identifier) : null;
    const phone = email ? null : normalizePhone(identifier);
    if (!email && !phone) return;
    const issued = await this.store.run('TENANT', async (db) => {
      const user = await db.user.findFirst({ where: email ? { email } : { phone: phone ?? '' } });
      const eligible =
        user &&
        (purpose === 'ACCOUNT_ACTIVATION'
          ? user.status === 'PENDING_ACTIVATION'
          : user.status === 'ACTIVE' &&
            (email ? user.emailVerifiedAt !== null : user.phoneVerifiedAt !== null));
      if (!user || !eligible) return null;
      const result = await this.otp.issue(db, {
        tenantId: tenant.id,
        userId: user.id,
        purpose,
        channel: email ? 'EMAIL' : 'SMS',
        target: email ?? phone ?? '',
      });
      return result.issued ? { result, user } : null;
    });
    if (!issued?.result.issued) return;
    await this.delivery.deliver({
      channel: email ? 'EMAIL' : 'SMS',
      target: issued.result.challenge.target,
      code: issued.result.code,
      purpose,
      tenantKey: tenant.key,
    });
  }

  /** Verifies a code (OTP, or an admin-issued student activation code) → short single-use grant. */
  async verifyOtpFlow(
    purpose: 'ACCOUNT_ACTIVATION' | 'ACCOUNT_RECOVERY',
    identifier: string,
    code: string,
  ): Promise<OtpGrant> {
    const tenant = this.tenant();
    await this.limiter.hit(`otp:${tenant.id}`, identifier);
    const verified = await this.store.run('TENANT', async (db) => {
      const user = await this.findByIdentifier(db, identifier);
      if (!user) return null;
      const challenge = await this.otp.verify(db, { userId: user.id, purpose, code });
      return challenge ? { challenge, user } : null;
    });
    if (!verified) throw invalidCode();
    const { token, expiresAt } = await this.tokens.sign(
      AUDIENCES.otpGrant,
      {
        sub: verified.user.id,
        scope: 'TENANT',
        tid: tenant.id,
        cid: verified.challenge.id,
        purpose,
      },
      OTP_GRANT_TTL_SECONDS,
    );
    return { grantToken: token, grantExpiresAt: expiresAt.toISOString() };
  }

  /** Checks the grant token (signature, tenant, purpose) WITHOUT consuming it. */
  private async readGrant(
    grantToken: string,
    purpose: OtpPurpose,
  ): Promise<{ userId: string; challengeId: string; tenantId: string }> {
    const tenant = this.tenant();
    const verified = await this.tokens.verify(grantToken, [AUDIENCES.otpGrant]);
    if (
      !verified.ok ||
      verified.claims.tid !== tenant.id ||
      verified.claims.purpose !== purpose ||
      !verified.claims.cid
    ) {
      throw invalidToken();
    }
    return { userId: verified.claims.sub, challengeId: verified.claims.cid, tenantId: tenant.id };
  }

  /**
   * Validates the new secret first, THEN consumes the single-use grant — a rejected weak PIN does
   * not burn the user's verification.
   */
  private async prepareCredential(
    grantToken: string,
    purpose: OtpPurpose,
    type: 'PASSWORD' | 'PIN',
    secret: string,
  ) {
    const grant = await this.readGrant(grantToken, purpose);
    const { roles } = await this.rbac.resolve('TENANT', grant.userId);
    this.flows.validateNewSecret('TENANT', roles, type, secret);
    const challenge = await this.store.run('TENANT', (db) =>
      this.otp.complete(db, grant.challengeId, grant.userId, purpose),
    );
    if (!challenge) throw invalidCode();
    return {
      challenge,
      userId: grant.userId,
      tenantId: grant.tenantId,
      hash: await this.hasher.hash(secret),
    };
  }

  /** Sets the first PIN/password, activates the account and signs in (MFA step if required). */
  async completeActivation(
    grantToken: string,
    type: 'PASSWORD' | 'PIN',
    secret: string,
    device?: DeviceDescriptor,
  ): Promise<AuthResult> {
    const { challenge, userId, tenantId, hash } = await this.prepareCredential(
      grantToken,
      'ACCOUNT_ACTIVATION',
      type,
      secret,
    );
    const owner: Owner = { scope: 'TENANT', tenantId, userId };
    const now = new Date();
    const activated = await this.store.run('TENANT', async (db) => {
      const result = await db.user.updateMany({
        where: { id: userId, status: 'PENDING_ACTIVATION' },
        data: {
          status: 'ACTIVE',
          credentialType: type,
          credentialHash: hash,
          credentialUpdatedAt: now,
          failedLoginCount: 0,
          lockedUntil: null,
          ...(challenge.channel === 'SMS' ? { phoneVerifiedAt: now } : {}),
          ...(challenge.channel === 'EMAIL' ? { emailVerifiedAt: now } : {}),
        },
      });
      return result.count === 1;
    });
    if (!activated) throw invalidCode();
    await this.audit.recordSecurity(owner, {
      action: 'ACCOUNT_ACTIVATED',
      resourceType: 'account',
      resourceId: userId,
      metadata: { channel: challenge.channel, credentialType: type },
    });
    return this.flows.startSession(owner, device);
  }

  /** Sets a new PIN/password after verified recovery; ends every session (sign in again). */
  async completeRecovery(
    grantToken: string,
    type: 'PASSWORD' | 'PIN',
    secret: string,
  ): Promise<void> {
    const { userId, tenantId, hash } = await this.prepareCredential(
      grantToken,
      'ACCOUNT_RECOVERY',
      type,
      secret,
    );
    const owner: Owner = { scope: 'TENANT', tenantId, userId };
    await this.store.run('TENANT', async (db) => {
      await db.user.update({
        where: { id: userId },
        data: {
          credentialType: type,
          credentialHash: hash,
          credentialUpdatedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await this.sessions.revokeAll(db, owner, 'password_reset');
    });
    await this.audit.recordSecurity(owner, {
      action: type === 'PIN' ? 'PIN_RESET' : 'PASSWORD_RESET',
      resourceType: 'account',
      resourceId: userId,
      metadata: { credentialType: type },
    });
  }

  // ------------------------------------------------------------ verified identifier change

  /** Re-authenticates, then sends a code to the NEW phone/email. Nothing changes until verified. */
  async startIdentifierChange(
    owner: Extract<Owner, { scope: 'TENANT' }>,
    kind: 'phone' | 'email',
    value: string,
    currentSecret: string,
  ): Promise<void> {
    this.delivery.assertAvailable();
    const user = await this.store.run('TENANT', (db) =>
      db.user.findUnique({ where: { id: owner.userId } }),
    );
    await this.flows.verifyCredential(owner, user, currentSecret);
    const target = kind === 'email' ? normalizeEmail(value) : normalizePhone(value);
    if (!target) throw invalidCode();
    const purpose = kind === 'email' ? 'EMAIL_CHANGE' : 'PHONE_CHANGE';
    const issued = await this.store.run('TENANT', async (db) => {
      const taken = await db.user.findFirst({
        where: kind === 'email' ? { email: target } : { phone: target },
      });
      if (taken) return null; // same generic behaviour: no code, no disclosure
      return this.otp.issue(db, {
        tenantId: owner.tenantId,
        userId: owner.userId,
        purpose,
        channel: kind === 'email' ? 'EMAIL' : 'SMS',
        target,
      });
    });
    if (!issued?.issued) return;
    await this.delivery.deliver({
      channel: kind === 'email' ? 'EMAIL' : 'SMS',
      target,
      code: issued.code,
      purpose,
      tenantKey: this.tenant().key,
    });
  }

  async completeIdentifierChange(
    owner: Extract<Owner, { scope: 'TENANT' }>,
    sessionId: string,
    kind: 'phone' | 'email',
    code: string,
  ): Promise<void> {
    const purpose = kind === 'email' ? 'EMAIL_CHANGE' : 'PHONE_CHANGE';
    const changed = await this.store.run('TENANT', async (db) => {
      const challenge = await this.otp.verify(db, { userId: owner.userId, purpose, code });
      if (!challenge || !(await this.otp.complete(db, challenge.id, owner.userId, purpose)))
        return false;
      const now = new Date();
      await db.user.update({
        where: { id: owner.userId },
        data:
          kind === 'email'
            ? { email: challenge.target, emailVerifiedAt: now }
            : { phone: challenge.target, phoneVerifiedAt: now },
      });
      await this.sessions.revokeAll(db, owner, `${kind}_changed`, sessionId);
      return true;
    });
    if (!changed) throw invalidCode();
    await this.audit.recordSecurity(owner, {
      action: kind === 'email' ? 'EMAIL_CHANGED' : 'PHONE_CHANGED',
      resourceType: 'account',
      resourceId: owner.userId,
      changedFields: [kind],
    });
  }

  // ------------------------------------------------------------ self

  async me(
    owner: Extract<Owner, { scope: 'TENANT' }>,
    sessionId: string,
    roles: string[],
    permissions: string[],
  ): Promise<MeResponse> {
    const tenant = this.tenant();
    const { user, mfa } = await this.store.run('TENANT', async (db) => ({
      user: await db.user.findUniqueOrThrow({
        where: { id: owner.userId },
        include: { tenant: { select: { displayName: true } } },
      }),
      mfa: await this.mfa.status(db, owner),
    }));
    return {
      id: user.id,
      scope: 'TENANT',
      displayName: user.displayName,
      tenant: { key: tenant.key, displayName: user.tenant.displayName },
      roles,
      permissions,
      identifiers: {
        email: user.email,
        phone: user.phone,
        loginId: user.loginId,
        emailVerified: user.emailVerifiedAt !== null,
        phoneVerified: user.phoneVerifiedAt !== null,
      },
      credentialType: user.credentialType,
      pinAllowed: pinAllowedForRoles(roles),
      mfa: { required: mfaRequiredForRoles(roles), ...mfa },
      sessionId,
    };
  }
}
