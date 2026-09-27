import { sessionPolicyForRoles } from '@acadlyx/permissions';
import type { AuthTokens, DeviceDescriptor, DeviceInfo, SessionInfo } from '@acadlyx/types';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/request-context.js';
import type { Prisma, Session } from '../../generated/prisma/client.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { AuthCacheService, type CachedSession } from './auth-cache.service.js';
import { invalidRefresh } from './auth-errors.js';
import { AuthStore } from './auth-store.service.js';
import { randomToken, sha256 } from './crypto/random.js';
import { ACCESS_TOKEN_TTL_SECONDS, AUDIENCES, TokenService } from './crypto/token.service.js';
import { type Owner, ownerColumns, ownerId, ownerWhere } from './owner.js';

type Db = Prisma.TransactionClient;

/** A pending-MFA session must complete its second factor within this window. */
const MFA_PENDING_MINUTES = 10;

export type SessionCheck =
  | { ok: true; session: CachedSession }
  | { ok: false; reason: 'revoked' | 'expired' | 'mfa-pending' | 'inactive' };

/**
 * Session lifecycle. The session is the refresh-token family:
 *   - every refresh rotates the token (old token marked rotated, new token issued);
 *   - presenting a rotated token again = reuse → the whole session is revoked + audited;
 *   - idle deadline slides on refresh but never beyond the fixed absolute deadline;
 *   - access tokens (10 min) are only honoured while the session row is valid (checked on every
 *     request via a ≤30 s cache that revocations clear immediately).
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly store: AuthStore,
    private readonly tokens: TokenService,
    private readonly cache: AuthCacheService,
    private readonly audit: AuditService,
  ) {}

  /** Finds or creates the device for this owner; the raw installation id is never stored. */
  async resolveDevice(
    db: Db,
    owner: Owner,
    device: DeviceDescriptor | undefined,
  ): Promise<{ id: string; isNew: boolean } | null> {
    if (!device) return null;
    const installationHash = sha256(`${owner.scope}:${ownerId(owner)}:${device.installationId}`);
    const existing = await db.userDevice.findFirst({
      where: { ...ownerWhere(owner), installationHash },
    });
    if (existing) {
      await db.userDevice.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: new Date(),
          revokedAt: null,
          platform: device.platform,
          ...(device.label ? { label: device.label } : {}),
        },
      });
      return { id: existing.id, isNew: false };
    }
    const created = await db.userDevice.create({
      data: {
        ...ownerColumns(owner),
        installationHash,
        platform: device.platform,
        label: device.label ?? null,
      },
    });
    return { id: created.id, isNew: true };
  }

  async create(
    db: Db,
    owner: Owner,
    input: { roles: string[]; mfaPending: boolean; deviceId: string | null },
  ): Promise<{ session: Session; refreshToken: string | null }> {
    const now = new Date();
    const policy = sessionPolicyForRoles(input.roles);
    const absoluteExpiresAt = new Date(now.getTime() + policy.absoluteMinutes * 60_000);
    const idleMinutes = input.mfaPending ? MFA_PENDING_MINUTES : policy.idleMinutes;
    const idleExpiresAt = new Date(
      Math.min(now.getTime() + idleMinutes * 60_000, absoluteExpiresAt.getTime()),
    );
    const meta = RequestContext.meta();
    const session = await db.session.create({
      data: {
        ...ownerColumns(owner),
        deviceId: input.deviceId,
        mfaPending: input.mfaPending,
        idleExpiresAt,
        absoluteExpiresAt,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    const refreshToken = input.mfaPending ? null : await this.issueRefresh(db, session);
    return { session, refreshToken };
  }

  /** Marks a pending-MFA session complete and starts its normal idle window. */
  async completeMfa(
    db: Db,
    session: Session,
    roles: string[],
  ): Promise<{ session: Session; refreshToken: string }> {
    const policy = sessionPolicyForRoles(roles);
    const now = Date.now();
    const updated = await db.session.update({
      where: { id: session.id },
      data: {
        mfaPending: false,
        mfaFailedAttempts: 0,
        lastActiveAt: new Date(now),
        idleExpiresAt: new Date(
          Math.min(now + policy.idleMinutes * 60_000, session.absoluteExpiresAt.getTime()),
        ),
      },
    });
    await this.cache.deleteSessions([session.id]);
    return { session: updated, refreshToken: await this.issueRefresh(db, updated) };
  }

  async issueTokens(session: Session, refreshToken: string): Promise<AuthTokens> {
    const isTenant = session.scope === 'TENANT';
    const sub = (isTenant ? session.userId : session.platformUserId) ?? '';
    const { token, expiresAt } = await this.tokens.sign(
      isTenant ? AUDIENCES.tenantAccess : AUDIENCES.platformAccess,
      {
        sub,
        scope: session.scope,
        sid: session.id,
        ...(isTenant && session.tenantId ? { tid: session.tenantId } : {}),
      },
      ACCESS_TOKEN_TTL_SECONDS,
    );
    return {
      status: 'AUTHENTICATED',
      accessToken: token,
      accessTokenExpiresAt: expiresAt.toISOString(),
      refreshToken,
      sessionId: session.id,
      sessionExpiresAt: session.absoluteExpiresAt.toISOString(),
    };
  }

  private async issueRefresh(db: Db, session: Session): Promise<string> {
    const raw = randomToken();
    await db.refreshToken.create({
      data: { sessionId: session.id, tenantId: session.tenantId, tokenHash: sha256(raw) },
    });
    return raw;
  }

  /**
   * Rotates a refresh token for `scope`. The token must belong to that scope (and, on the tenant
   * path, to the resolved tenant — enforced by RLS). Reuse revokes the session family.
   */
  async rotate(
    scope: 'TENANT' | 'PLATFORM',
    rawToken: string,
    roles: (owner: Owner) => Promise<string[]>,
  ): Promise<AuthTokens> {
    const outcome = await this.store.run(scope, async (db) => {
      const token = await db.refreshToken.findUnique({
        where: { tokenHash: sha256(rawToken) },
        include: { session: true },
      });
      const session = token?.session;
      if (!token || !session || session.scope !== scope) return { kind: 'invalid' as const };
      if (token.rotatedAt !== null) return { kind: 'reuse' as const, session };
      const now = new Date();
      if (session.revokedAt !== null || session.mfaPending) return { kind: 'invalid' as const };
      if (session.idleExpiresAt <= now || session.absoluteExpiresAt <= now) {
        await this.revokeInDb(db, [session.id], 'expired');
        return { kind: 'invalid' as const };
      }
      const owner = sessionOwner(session);
      if (!(await this.ownerIsActive(db, owner))) {
        await this.revokeInDb(db, [session.id], 'account_inactive');
        return { kind: 'invalid' as const };
      }
      // Compare-and-set: concurrent use of the same token can succeed only once.
      const claimed = await db.refreshToken.updateMany({
        where: { id: token.id, rotatedAt: null },
        data: { rotatedAt: now },
      });
      if (claimed.count === 0) return { kind: 'reuse' as const, session };
      const policy = sessionPolicyForRoles(await roles(owner));
      const updated = await db.session.update({
        where: { id: session.id },
        data: {
          lastActiveAt: now,
          idleExpiresAt: new Date(
            Math.min(
              now.getTime() + policy.idleMinutes * 60_000,
              session.absoluteExpiresAt.getTime(),
            ),
          ),
        },
      });
      return {
        kind: 'ok' as const,
        session: updated,
        refreshToken: await this.issueRefresh(db, updated),
      };
    });

    if (outcome.kind === 'reuse') {
      await this.store.run(scope, (db) =>
        this.revokeInDb(db, [outcome.session.id], 'refresh_token_reuse'),
      );
      await this.cache.deleteSessions([outcome.session.id]);
      await this.audit.recordSecurity(sessionOwner(outcome.session), {
        action: 'REFRESH_TOKEN_REUSE',
        resourceType: 'session',
        resourceId: outcome.session.id,
      });
      throw invalidRefresh();
    }
    if (outcome.kind === 'invalid') throw invalidRefresh();
    await this.cache.deleteSessions([outcome.session.id]);
    return this.issueTokens(outcome.session, outcome.refreshToken);
  }

  /** Validates the session behind an access token (cache ≤30 s, database on miss/error). */
  async check(
    scope: 'TENANT' | 'PLATFORM',
    sessionId: string,
    subject: string,
  ): Promise<SessionCheck> {
    const now = Date.now();
    let snapshot = await this.cache.getSession(sessionId);
    if (!snapshot) {
      const loaded = await this.store.run(scope, async (db) => {
        const session = await db.session.findUnique({ where: { id: sessionId } });
        if (!session || session.scope !== scope) return { missing: true as const };
        if (session.revokedAt !== null) return { missing: true as const };
        const owner = sessionOwner(session);
        if (!(await this.ownerIsActive(db, owner))) return { inactive: true as const };
        return {
          snapshot: {
            scope: session.scope,
            ownerId: ownerId(owner),
            tenantId: session.tenantId,
            mfaPending: session.mfaPending,
            idleExpiresAt: session.idleExpiresAt.getTime(),
            absoluteExpiresAt: session.absoluteExpiresAt.getTime(),
          } satisfies CachedSession,
        };
      });
      if ('missing' in loaded) return { ok: false, reason: 'revoked' };
      if ('inactive' in loaded) return { ok: false, reason: 'inactive' };
      snapshot = loaded.snapshot;
      await this.cache.setSession(sessionId, snapshot);
    }
    if (snapshot.ownerId !== subject || snapshot.scope !== scope)
      return { ok: false, reason: 'revoked' };
    if (snapshot.idleExpiresAt <= now || snapshot.absoluteExpiresAt <= now)
      return { ok: false, reason: 'expired' };
    if (snapshot.mfaPending) return { ok: false, reason: 'mfa-pending' };
    return { ok: true, session: snapshot };
  }

  async revoke(scope: 'TENANT' | 'PLATFORM', sessionIds: string[], reason: string): Promise<void> {
    await this.store.run(scope, (db) => this.revokeInDb(db, sessionIds, reason));
    await this.cache.deleteSessions(sessionIds);
  }

  /** Revokes every live session of the owner (optionally keeping one). Returns revoked ids. */
  async revokeAll(
    db: Db,
    owner: Owner,
    reason: string,
    exceptSessionId?: string,
  ): Promise<string[]> {
    const live = await db.session.findMany({
      where: {
        ...ownerWhere(owner),
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      select: { id: true },
    });
    const ids = live.map((s) => s.id);
    await this.revokeInDb(db, ids, reason);
    await this.cache.deleteSessions(ids);
    return ids;
  }

  async revokeInDb(db: Db, sessionIds: string[], reason: string): Promise<void> {
    if (sessionIds.length === 0) return;
    await db.session.updateMany({
      where: { id: { in: sessionIds }, revokedAt: null },
      data: { revokedAt: new Date(), revocationReason: reason },
    });
  }

  async listSessions(db: Db, owner: Owner, currentSessionId: string): Promise<SessionInfo[]> {
    const now = new Date();
    const rows = await db.session.findMany({
      where: {
        ...ownerWhere(owner),
        revokedAt: null,
        mfaPending: false,
        idleExpiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
      },
      include: { device: true },
      orderBy: { lastActiveAt: 'desc' },
    });
    return rows.map((s) => ({
      id: s.id,
      current: s.id === currentSessionId,
      createdAt: s.createdAt.toISOString(),
      lastActiveAt: s.lastActiveAt.toISOString(),
      expiresAt: new Date(
        Math.min(s.idleExpiresAt.getTime(), s.absoluteExpiresAt.getTime()),
      ).toISOString(),
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      device: s.device
        ? { id: s.device.id, platform: s.device.platform, label: s.device.label }
        : null,
    }));
  }

  async listDevices(db: Db, owner: Owner): Promise<DeviceInfo[]> {
    const now = new Date();
    const rows = await db.userDevice.findMany({
      where: { ...ownerWhere(owner), revokedAt: null },
      include: {
        sessions: {
          where: { revokedAt: null, absoluteExpiresAt: { gt: now } },
          select: { id: true },
        },
      },
      orderBy: { lastSeenAt: 'desc' },
    });
    return rows.map((d) => ({
      id: d.id,
      platform: d.platform,
      label: d.label,
      firstSeenAt: d.firstSeenAt.toISOString(),
      lastSeenAt: d.lastSeenAt.toISOString(),
      activeSessions: d.sessions.length,
    }));
  }

  /** Revokes a device and every session on it. Returns false if it is not the owner's device. */
  async revokeDevice(db: Db, owner: Owner, deviceId: string): Promise<boolean> {
    const device = await db.userDevice.findFirst({
      where: { id: deviceId, ...ownerWhere(owner), revokedAt: null },
    });
    if (!device) return false;
    await db.userDevice.update({ where: { id: device.id }, data: { revokedAt: new Date() } });
    const sessions = await db.session.findMany({
      where: { deviceId: device.id, revokedAt: null },
      select: { id: true },
    });
    const ids = sessions.map((s) => s.id);
    await this.revokeInDb(db, ids, 'device_revoked');
    await this.cache.deleteSessions(ids);
    return true;
  }

  private async ownerIsActive(db: Db, owner: Owner): Promise<boolean> {
    const row =
      owner.scope === 'TENANT'
        ? await db.user.findUnique({ where: { id: owner.userId }, select: { status: true } })
        : await db.platformUser.findUnique({
            where: { id: owner.platformUserId },
            select: { status: true },
          });
    return row?.status === 'ACTIVE';
  }
}

export function sessionOwner(
  session: Pick<Session, 'scope' | 'tenantId' | 'userId' | 'platformUserId'>,
): Owner {
  if (session.scope === 'TENANT' && session.tenantId && session.userId) {
    return { scope: 'TENANT', tenantId: session.tenantId, userId: session.userId };
  }
  if (session.scope === 'PLATFORM' && session.platformUserId) {
    return { scope: 'PLATFORM', platformUserId: session.platformUserId };
  }
  throw new Error('Session has no valid owner');
}
