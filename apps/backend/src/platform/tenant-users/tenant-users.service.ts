import { isTenantRoleKey, requiredIdentifiers } from '@acadlyx/permissions';
import type { Paginated } from '@acadlyx/tenant-config';
import type { IssuedActivationCode, TenantUserSummary } from '@acadlyx/types';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { normalizeEmail, normalizeLoginId, normalizePhone } from '../../auth/core/identifiers.js';
import { OtpService } from '../../auth/core/otp/otp.service.js';
import type { Owner } from '../../auth/core/owner.js';
import { RbacService } from '../../auth/core/rbac.service.js';
import { SessionsService } from '../../auth/core/sessions.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { isUniqueViolation } from '../../common/errors/domain-errors.js';
import { RequestContext } from '../../common/request-context.js';
import { PlatformPrismaService } from '../../database/platform-prisma.service.js';
import type { AccountStatus, Prisma } from '../../generated/prisma/client.js';
import type { CreateTenantUserDto, ListTenantUsersQueryDto } from './tenant-users.dto.js';

const userInclude = {
  roles: { select: { role: { select: { key: true } } } },
  mfaMethods: { where: { verifiedAt: { not: null } }, select: { id: true } },
} as const;

type UserWithRoles = Prisma.UserGetPayload<{ include: typeof userInclude }>;

const STATUS_TRANSITIONS: Record<
  'suspend' | 'reactivate' | 'disable',
  { from: AccountStatus[]; to: AccountStatus; action: string }
> = {
  suspend: { from: ['ACTIVE'], to: 'SUSPENDED', action: 'USER_SUSPENDED' },
  reactivate: { from: ['SUSPENDED'], to: 'ACTIVE', action: 'USER_REACTIVATED' },
  disable: {
    from: ['ACTIVE', 'SUSPENDED', 'PENDING_ACTIVATION'],
    to: 'DISABLED',
    action: 'USER_DISABLED',
  },
};

/**
 * Platform Admin administration of school identities (Phase 3 minimal scope). Every query is
 * pinned to the route's tenant: a user of school B addressed through school A's route is simply
 * "not found". Roles come only from the built-in registry. Platform users cannot be created here.
 */
@Injectable()
export class TenantUsersService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly rbac: RbacService,
    private readonly sessions: SessionsService,
    private readonly otp: OtpService,
    private readonly audit: AuditService,
  ) {}

  private async tenantKey(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { key: true },
    });
    if (!tenant)
      throw new NotFoundException({ code: 'TENANT_NOT_FOUND', message: 'Tenant not found' });
    return tenant.key;
  }

  private async requireUser(tenantId: string, userId: string): Promise<UserWithRoles> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      include: userInclude,
    });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    return user;
  }

  private summary(user: UserWithRoles): TenantUserSummary {
    return {
      id: user.id,
      displayName: user.displayName,
      status: user.status,
      email: user.email,
      phone: user.phone,
      loginId: user.loginId,
      loginIdKind: user.loginIdKind,
      roles: user.roles.map((r) => r.role.key).sort(),
      mfaEnrolled: user.mfaMethods.length > 0,
      locked: user.lockedUntil !== null && user.lockedUntil > new Date(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  }

  async list(
    tenantId: string,
    query: ListTenantUsersQueryDto,
  ): Promise<Paginated<TenantUserSummary>> {
    await this.tenantKey(tenantId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.UserWhereInput = { tenantId };
    if (query.status) where.status = query.status;
    if (query.role) where.roles = { some: { role: { key: query.role } } };
    if (query.search) {
      const term = query.search;
      where.OR = [
        { displayName: { contains: term, mode: 'insensitive' } },
        { email: { contains: term.toLowerCase() } },
        { phone: { contains: term.replace(/[\s()-]/g, '') } },
        { loginId: { contains: term, mode: 'insensitive' } },
      ];
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        include: userInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((u) => this.summary(u)),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async get(tenantId: string, userId: string): Promise<TenantUserSummary> {
    return this.summary(await this.requireUser(tenantId, userId));
  }

  async create(tenantId: string, dto: CreateTenantUserDto): Promise<TenantUserSummary> {
    const tenantKey = await this.tenantKey(tenantId);
    const email = dto.email ? normalizeEmail(dto.email) : null;
    const phone = dto.phone ? normalizePhone(dto.phone) : null;
    const loginId = dto.loginId ? normalizeLoginId(dto.loginId) : null;
    const problems: string[] = [];
    if (dto.email && !email) problems.push('email is not a valid email address');
    if (dto.phone && !phone)
      problems.push('phone must be a valid mobile number (E.164 or 10-digit Indian)');
    if (dto.loginId && !loginId)
      problems.push('loginId may contain letters, digits and . _ / - (max 64)');
    if (loginId && !dto.loginIdKind) problems.push('loginIdKind is required with loginId');
    for (const need of requiredIdentifiers(dto.roles)) {
      if (need === 'email' && !email) problems.push('email is required for the selected role(s)');
      if (need === 'phone' && !phone) problems.push('phone is required for the Parent role');
      if (need === 'studentId' && (!loginId || dto.loginIdKind !== 'STUDENT_ID'))
        problems.push('a student ID (loginId, kind STUDENT_ID) is required for the Student role');
      if (need === 'employeeIdOrEmail' && !email && !(loginId && dto.loginIdKind === 'EMPLOYEE_ID'))
        problems.push('an employee ID or email is required for the Teacher role');
    }
    if (dto.roles.some((r) => !isTenantRoleKey(r)))
      problems.push('only built-in school roles can be assigned');
    if (problems.length > 0)
      throw new BadRequestException({ code: 'INVALID_IDENTITY', message: problems });

    try {
      const user = await this.prisma.$transaction(async (db) => {
        const roles = await db.role.findMany({
          where: { key: { in: dto.roles }, scope: 'TENANT' },
        });
        if (roles.length !== dto.roles.length)
          throw new BadRequestException({ code: 'UNKNOWN_ROLE', message: 'Unknown role' });
        return db.user.create({
          data: {
            tenantId,
            displayName: dto.displayName,
            email,
            phone,
            loginId,
            loginIdKind: loginId ? (dto.loginIdKind ?? null) : null,
            roles: {
              create: roles.map((r) => ({
                roleId: r.id,
                roleScope: 'TENANT' as const,
                createdByPlatformUserId: this.actorId(),
              })),
            },
          },
          include: userInclude,
        });
      });
      await this.audit.recordPlatform({
        action: 'TENANT_USER_CREATED',
        resourceType: 'user',
        resourceId: user.id,
        tenantId,
        tenantKey,
        changedFields: [
          'displayName',
          ...(email ? ['email'] : []),
          ...(phone ? ['phone'] : []),
          ...(loginId ? ['loginId'] : []),
        ],
        metadata: { roles: dto.roles },
      });
      for (const role of dto.roles) {
        await this.audit.recordPlatform({
          action: 'ROLE_ASSIGNED',
          resourceType: 'user',
          resourceId: user.id,
          tenantId,
          tenantKey,
          metadata: { role },
        });
      }
      return this.summary(user);
    } catch (error) {
      for (const [index, field] of [
        ['users_tenant_email_key', 'email'],
        ['users_tenant_phone_key', 'phone'],
        ['users_tenant_login_id_key', 'loginId'],
      ] as const) {
        if (isUniqueViolation(error, index)) {
          throw new ConflictException({
            code: 'IDENTIFIER_TAKEN',
            message: `Another account in this school already uses this ${field}`,
          });
        }
      }
      throw error;
    }
  }

  async rename(tenantId: string, userId: string, displayName: string): Promise<TenantUserSummary> {
    const user = await this.requireUser(tenantId, userId);
    await this.prisma.user.update({ where: { id: user.id }, data: { displayName } });
    await this.audit.recordPlatform({
      action: 'TENANT_USER_UPDATED',
      resourceType: 'user',
      resourceId: userId,
      tenantId,
      changedFields: ['displayName'],
    });
    return this.get(tenantId, userId);
  }

  async assignRole(tenantId: string, userId: string, roleKey: string): Promise<TenantUserSummary> {
    const user = await this.requireUser(tenantId, userId);
    if (!isTenantRoleKey(roleKey))
      throw new BadRequestException({ code: 'UNKNOWN_ROLE', message: 'Unknown role' });
    const role = await this.prisma.role.findFirst({ where: { key: roleKey, scope: 'TENANT' } });
    if (!role) throw new BadRequestException({ code: 'UNKNOWN_ROLE', message: 'Unknown role' });
    try {
      await this.prisma.userRole.create({
        data: {
          tenantId,
          userId: user.id,
          roleId: role.id,
          roleScope: 'TENANT',
          createdByPlatformUserId: this.actorId(),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException({
          code: 'ROLE_ALREADY_ASSIGNED',
          message: 'Role already assigned',
        });
      throw error;
    }
    // New role may tighten MFA/session policy: end existing sessions so the next login applies it.
    await this.prisma.$transaction((db) =>
      this.sessions.revokeAll(db, this.owner(user), 'role_assigned'),
    );
    await this.rbac.invalidate('TENANT', user.id);
    await this.audit.recordPlatform({
      action: 'ROLE_ASSIGNED',
      resourceType: 'user',
      resourceId: userId,
      tenantId,
      metadata: { role: roleKey },
    });
    return this.get(tenantId, userId);
  }

  async removeRole(tenantId: string, userId: string, roleKey: string): Promise<TenantUserSummary> {
    const user = await this.requireUser(tenantId, userId);
    const held = user.roles.map((r) => r.role.key);
    if (!held.includes(roleKey))
      throw new NotFoundException({ code: 'ROLE_NOT_ASSIGNED', message: 'Role not assigned' });
    if (held.length === 1)
      throw new ConflictException({
        code: 'LAST_ROLE',
        message: 'An account must keep at least one role',
      });
    await this.prisma.userRole.deleteMany({
      where: { tenantId, userId: user.id, role: { key: roleKey } },
    });
    // Permissions shrink immediately: grants cache invalidated; every request re-resolves.
    await this.rbac.invalidate('TENANT', user.id);
    await this.audit.recordPlatform({
      action: 'ROLE_REMOVED',
      resourceType: 'user',
      resourceId: userId,
      tenantId,
      metadata: { role: roleKey },
    });
    return this.get(tenantId, userId);
  }

  async transition(
    tenantId: string,
    userId: string,
    kind: keyof typeof STATUS_TRANSITIONS,
  ): Promise<TenantUserSummary> {
    const user = await this.requireUser(tenantId, userId);
    const rule = STATUS_TRANSITIONS[kind];
    if (!rule.from.includes(user.status)) {
      throw new ConflictException({
        code: 'INVALID_STATUS_TRANSITION',
        message: `Cannot ${kind} an account that is ${user.status}`,
      });
    }
    await this.prisma.$transaction(async (db) => {
      const updated = await db.user.updateMany({
        where: { id: user.id, tenantId, status: user.status },
        data: { status: rule.to },
      });
      if (updated.count === 0)
        throw new ConflictException({
          code: 'INVALID_STATUS_TRANSITION',
          message: 'Status changed concurrently',
        });
      if (rule.to !== 'ACTIVE')
        await this.sessions.revokeAll(db, this.owner(user), `account_${rule.to.toLowerCase()}`);
    });
    await this.rbac.invalidate('TENANT', user.id);
    await this.audit.recordPlatform({
      action: rule.action,
      resourceType: 'user',
      resourceId: userId,
      tenantId,
      changedFields: ['status'],
      metadata: { from: user.status, to: rule.to },
    });
    return this.get(tenantId, userId);
  }

  /**
   * Returns the account to PENDING_ACTIVATION: credential and MFA removed, lockout cleared, all
   * sessions revoked. No default credential is ever set — the user re-activates via OTP (or a
   * school-issued activation code for students).
   */
  async resetActivation(tenantId: string, userId: string): Promise<TenantUserSummary> {
    const user = await this.requireUser(tenantId, userId);
    if (user.status === 'DISABLED')
      throw new ConflictException({
        code: 'INVALID_STATUS_TRANSITION',
        message: 'Disabled accounts cannot be reset',
      });
    await this.prisma.$transaction(async (db) => {
      await db.user.update({
        where: { id: user.id },
        data: {
          status: 'PENDING_ACTIVATION',
          credentialHash: null,
          credentialType: null,
          failedLoginCount: 0,
          lockoutCount: 0,
          lockedUntil: null,
        },
      });
      await db.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await db.mfaMethod.deleteMany({ where: { userId: user.id } });
      await this.sessions.revokeAll(db, this.owner(user), 'activation_reset');
    });
    await this.rbac.invalidate('TENANT', user.id);
    await this.audit.recordPlatform({
      action: 'USER_ACTIVATION_RESET',
      resourceType: 'user',
      resourceId: userId,
      tenantId,
      changedFields: ['status', 'credential', 'mfa'],
    });
    return this.get(tenantId, userId);
  }

  /** One-time activation code for pending accounts with no OTP channel (students). Shown once. */
  async issueActivationCode(tenantId: string, userId: string): Promise<IssuedActivationCode> {
    const user = await this.requireUser(tenantId, userId);
    if (user.status !== 'PENDING_ACTIVATION')
      throw new ConflictException({
        code: 'NOT_PENDING',
        message: 'Account is not pending activation',
      });
    if (user.email || user.phone) {
      throw new ConflictException({
        code: 'USE_OTP_ACTIVATION',
        message: 'This account activates with a code sent to its email/phone',
      });
    }
    const issued = await this.prisma.$transaction((db) =>
      this.otp.issue(db, {
        tenantId,
        userId: user.id,
        purpose: 'ACCOUNT_ACTIVATION',
        channel: 'ADMIN_ISSUED',
        target: user.loginId ?? user.id,
      }),
    );
    if (!issued.issued)
      throw new ConflictException({ code: 'TRY_LATER', message: 'Please try again later' });
    await this.audit.recordPlatform({
      action: 'ACTIVATION_CODE_ISSUED',
      resourceType: 'user',
      resourceId: userId,
      tenantId,
    });
    return {
      activationCode: `${issued.code.slice(0, 5)}-${issued.code.slice(5)}`,
      expiresAt: issued.challenge.expiresAt.toISOString(),
    };
  }

  private owner(user: { id: string; tenantId: string }): Owner {
    return { scope: 'TENANT', tenantId: user.tenantId, userId: user.id };
  }

  /** The authenticated Platform Admin performing the change (recorded on role assignments). */
  private actorId(): string | null {
    const auth = RequestContext.state()?.auth;
    return auth?.scope === 'PLATFORM' ? auth.platformUserId : null;
  }
}
