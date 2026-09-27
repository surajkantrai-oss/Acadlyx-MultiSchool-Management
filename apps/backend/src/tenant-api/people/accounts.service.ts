import type { CreatedAccount, ProfileAccount, ProfileKind } from '@acadlyx/types';
import { fullName } from '@acadlyx/validation';
import { Injectable } from '@nestjs/common';
import { normalizeEmail, normalizeLoginId, normalizePhone } from '../../auth/core/identifiers.js';
import { OtpService } from '../../auth/core/otp/otp.service.js';
import { RbacService } from '../../auth/core/rbac.service.js';
import { uuidv7 } from '../../common/ids/uuid.js';
import type { Prisma, School } from '../../generated/prisma/client.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import { AcademicStore } from '../academic/academic-store.js';
import { PEOPLE_ERRORS } from './people-errors.js';

const ROLE: Record<ProfileKind, 'STUDENT' | 'PARENT' | 'TEACHER'> = {
  students: 'STUDENT',
  parents: 'PARENT',
  teachers: 'TEACHER',
};

interface ProfileRow {
  id: string;
  userId: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  admissionNumber?: string;
  employeeId?: string;
  email?: string | null;
  phone?: string | null;
}

/**
 * Login accounts for profiles (approved Phase 5 decision J).
 *
 *  - createAccount: School Admin creates a PENDING_ACTIVATION tenant User holding EXACTLY the
 *    matching role, linked to the profile, via the `app_create_profile_account` database function
 *    (the tenant role has no raw INSERT on users). No password/PIN is ever set: activation uses
 *    the Phase 3 flow — self-service OTP when the account has an email/phone, otherwise a
 *    one-time admin-issued code shown once (students).
 *  - linkAccount: link an EXISTING User only if it already holds the matching role (no silent
 *    role grants) — e.g. a Teacher who is also a Parent keeps one login.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly store: AcademicStore,
    private readonly otp: OtpService,
    private readonly rbac: RbacService,
  ) {}

  createAccount(kind: ProfileKind, profileId: string): Promise<CreatedAccount> {
    return this.store.transact(async (tx, school, events) => {
      const profile = await this.profile(tx, school, kind, profileId);
      if (profile.userId) throw PEOPLE_ERRORS.profileAlreadyLinked();
      const ids = this.identifiers(kind, profile);
      const userId = uuidv7();
      try {
        await tx.$queryRaw`SELECT app_create_profile_account(
          ${userId}::uuid, ${uuidv7()}::uuid, ${fullName(profile)}, ${ids.email}, ${ids.phone},
          ${ids.loginId}, ${ids.loginIdKind}::login_id_kind, ${ROLE[kind]})`;
      } catch (error) {
        throw mapIdentifierConflict(error);
      }
      await this.setUser(tx, kind, profile.id, userId);
      events.push({
        action: 'PROFILE_ACCOUNT_CREATED',
        resourceType: resourceType(kind),
        resourceId: profile.id,
        metadata: { userId, role: ROLE[kind] },
      });
      const activation = await this.startActivation(tx, school, userId, ids, events);
      return { account: { userId, status: 'PENDING_ACTIVATION' }, activation };
    });
  }

  linkAccount(kind: ProfileKind, profileId: string, userId: string): Promise<ProfileAccount> {
    return this.store.transact(async (tx, school, events) => {
      const profile = await this.profile(tx, school, kind, profileId);
      if (profile.userId) throw PEOPLE_ERRORS.profileAlreadyLinked();
      const user = await tx.user.findFirst({
        where: { id: userId },
        include: { roles: { include: { role: true } } },
      });
      if (!user) throw PEOPLE_ERRORS.userNotFound();
      if (!user.roles.some((r) => r.role.key === ROLE[kind]))
        throw PEOPLE_ERRORS.roleRequired(ROLE[kind]);
      try {
        await this.setUser(tx, kind, profile.id, user.id);
      } catch (error) {
        throw mapLinkConflict(error);
      }
      events.push({
        action: 'PROFILE_ACCOUNT_LINKED',
        resourceType: resourceType(kind),
        resourceId: profile.id,
        metadata: { userId: user.id, role: ROLE[kind] },
      });
      return { userId: user.id, status: user.status };
    });
  }

  /** New one-time code for a PENDING account without an OTP channel (Phase 3 rule). */
  issueActivationCode(kind: ProfileKind, profileId: string): Promise<CreatedAccount> {
    return this.store.transact(async (tx, school, events) => {
      const profile = await this.profile(tx, school, kind, profileId);
      if (!profile.userId) throw PEOPLE_ERRORS.noAccount();
      const user = await tx.user.findFirst({ where: { id: profile.userId } });
      if (!user) throw PEOPLE_ERRORS.noAccount();
      if (user.status !== 'PENDING_ACTIVATION') throw PEOPLE_ERRORS.accountNotPending();
      if (user.email || user.phone) throw PEOPLE_ERRORS.useOtpActivation();
      const activation = await this.startActivation(
        tx,
        school,
        user.id,
        { email: null, phone: null, loginId: user.loginId, loginIdKind: user.loginIdKind },
        events,
      );
      return { account: { userId: user.id, status: user.status }, activation };
    });
  }

  private async startActivation(
    tx: TenantTransaction,
    school: School,
    userId: string,
    ids: Identifiers,
    events: {
      action: string;
      resourceType: string;
      resourceId?: string;
      metadata?: Record<string, unknown>;
    }[],
  ): Promise<CreatedAccount['activation']> {
    await this.rbac.invalidate('TENANT', userId);
    if (ids.email || ids.phone) return { method: 'OTP' };
    const issued = await this.otp.issue(tx as unknown as Prisma.TransactionClient, {
      tenantId: school.tenantId,
      userId,
      purpose: 'ACCOUNT_ACTIVATION',
      channel: 'ADMIN_ISSUED',
      target: ids.loginId ?? userId,
    });
    if (!issued.issued) throw PEOPLE_ERRORS.tryLater();
    events.push({ action: 'ACTIVATION_CODE_ISSUED', resourceType: 'user', resourceId: userId });
    return {
      method: 'CODE',
      code: `${issued.code.slice(0, 5)}-${issued.code.slice(5)}`,
      expiresAt: issued.challenge.expiresAt.toISOString(),
    };
  }

  /** Identifiers the new account needs for its role (Phase 3 requiredIdentifiers). */
  private identifiers(kind: ProfileKind, p: ProfileRow): Identifiers {
    if (kind === 'students') {
      const loginId = normalizeLoginId(p.admissionNumber ?? '');
      if (!loginId)
        throw PEOPLE_ERRORS.identifierRequired('The admission number cannot be used as a login ID');
      return { email: null, phone: null, loginId, loginIdKind: 'STUDENT_ID' };
    }
    const email = p.email ? normalizeEmail(p.email) : null;
    const phone = p.phone ? normalizePhone(p.phone) : null;
    if (kind === 'parents') {
      if (!phone)
        throw PEOPLE_ERRORS.identifierRequired(
          'A parent account needs a mobile number on the profile',
        );
      return { email, phone, loginId: null, loginIdKind: null };
    }
    const loginId = normalizeLoginId(p.employeeId ?? '');
    if (!loginId && !email)
      throw PEOPLE_ERRORS.identifierRequired('A teacher account needs an employee ID or email');
    return { email, phone: null, loginId, loginIdKind: loginId ? 'EMPLOYEE_ID' : null };
  }

  private async profile(
    tx: TenantTransaction,
    school: School,
    kind: ProfileKind,
    id: string,
  ): Promise<ProfileRow> {
    const where = { id, schoolId: school.id };
    const row =
      kind === 'students'
        ? await tx.student.findFirst({ where })
        : kind === 'parents'
          ? await tx.parent.findFirst({ where })
          : await tx.teacher.findFirst({ where });
    if (!row)
      throw kind === 'students'
        ? PEOPLE_ERRORS.studentNotFound()
        : kind === 'parents'
          ? PEOPLE_ERRORS.parentNotFound()
          : PEOPLE_ERRORS.teacherNotFound();
    return row;
  }

  private async setUser(
    tx: TenantTransaction,
    kind: ProfileKind,
    id: string,
    userId: string,
  ): Promise<void> {
    if (kind === 'students') await tx.student.update({ where: { id }, data: { userId } });
    else if (kind === 'parents') await tx.parent.update({ where: { id }, data: { userId } });
    else await tx.teacher.update({ where: { id }, data: { userId } });
  }
}

interface Identifiers {
  email: string | null;
  phone: string | null;
  loginId: string | null;
  loginIdKind: 'STUDENT_ID' | 'EMPLOYEE_ID' | null;
}

function resourceType(kind: ProfileKind): string {
  return kind === 'students' ? 'student' : kind === 'parents' ? 'parent' : 'teacher';
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The function's INSERT hits the Phase 3 per-tenant identifier unique indexes. */
function mapIdentifierConflict(error: unknown): unknown {
  const m = message(error);
  if (m.includes('users_tenant_email_key')) return PEOPLE_ERRORS.identifierTaken('email');
  if (m.includes('users_tenant_phone_key')) return PEOPLE_ERRORS.identifierTaken('mobile number');
  if (m.includes('users_tenant_login_id_key')) return PEOPLE_ERRORS.identifierTaken('login ID');
  return error;
}

function mapLinkConflict(error: unknown): unknown {
  const m = message(error);
  if (
    /(students|parents|teachers)_user_id_tenant_id_key/.test(m) ||
    (error as { code?: string }).code === 'P2002'
  )
    return PEOPLE_ERRORS.userAlreadyLinked();
  return error;
}
