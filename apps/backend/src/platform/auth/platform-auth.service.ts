import type { AuthResult, DeviceDescriptor, MeResponse } from '@acadlyx/types';
import { Injectable } from '@nestjs/common';
import { invalidCredentials } from '../../auth/core/auth-errors.js';
import { AuthFlowsService } from '../../auth/core/auth-flows.service.js';
import { loadIdentity } from '../../auth/core/identity-repo.js';
import { normalizeEmail } from '../../auth/core/identifiers.js';
import { IdentifierLimiterService } from '../../auth/core/identifier-limiter.service.js';
import type { Owner } from '../../auth/core/owner.js';
import { RbacService } from '../../auth/core/rbac.service.js';
import { SessionsService } from '../../auth/core/sessions.service.js';
import { PlatformPrismaService } from '../../database/platform-prisma.service.js';

export type PlatformOwner = Extract<Owner, { scope: 'PLATFORM' }>;

/** Platform Admin authentication: email + strong password + mandatory TOTP MFA. */
@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly flows: AuthFlowsService,
    private readonly limiter: IdentifierLimiterService,
    private readonly rbac: RbacService,
    private readonly sessions: SessionsService,
  ) {}

  async login(email: string, password: string, device?: DeviceDescriptor): Promise<AuthResult> {
    await this.limiter.hit('platform', email);
    const normalized = normalizeEmail(email);
    const user = normalized
      ? await this.prisma.platformUser.findUnique({ where: { email: normalized } })
      : null;
    const owner: PlatformOwner | null = user
      ? { scope: 'PLATFORM', platformUserId: user.id }
      : null;
    const identity = owner ? await loadIdentity(this.prisma, owner) : null;
    await this.flows.verifyCredential(owner, identity, password);
    if (!owner) throw invalidCredentials();
    return this.flows.startSession(owner, device);
  }

  refresh(refreshToken: string) {
    return this.sessions.rotate('PLATFORM', refreshToken, async (owner) =>
      owner.scope === 'PLATFORM'
        ? (await this.rbac.resolve('PLATFORM', owner.platformUserId)).roles
        : [],
    );
  }

  async me(
    owner: PlatformOwner,
    sessionId: string,
    roles: string[],
    permissions: string[],
  ): Promise<MeResponse> {
    const user = await this.prisma.platformUser.findUniqueOrThrow({
      where: { id: owner.platformUserId },
    });
    const mfa = await this.flows.mfaStatus(owner);
    return {
      id: user.id,
      scope: 'PLATFORM',
      displayName: user.displayName,
      tenant: null,
      roles,
      permissions,
      identifiers: {
        email: user.email,
        phone: null,
        loginId: null,
        emailVerified: true,
        phoneVerified: false,
      },
      credentialType: user.passwordHash ? 'PASSWORD' : null,
      pinAllowed: false,
      mfa: { required: true, ...mfa },
      sessionId,
    };
  }
}
