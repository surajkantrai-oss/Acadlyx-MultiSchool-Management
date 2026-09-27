import { Injectable } from '@nestjs/common';
import type {
  OtpChallenge,
  OtpChannel,
  OtpPurpose,
  Prisma,
} from '../../../generated/prisma/client.js';
import { humanCode, normalizeHumanCode, numericCode } from '../crypto/random.js';
import { KeysService } from '../crypto/keys.service.js';

type Db = Prisma.TransactionClient;

/**
 * Approved OTP policy: 6-digit codes, 5-minute expiry, 5 verification attempts per challenge,
 * single use, purpose- and tenant-bound, HMAC-SHA256 at rest. Resend: 60 s cooldown and at most
 * 5 sends per user+purpose per hour (per-IP limits are enforced by the route throttler).
 * Admin-issued activation codes (students, no OTP channel): 10 characters, 7 days, 5 attempts.
 */
export const OTP_POLICY = {
  expiryMinutes: 5,
  maxAttempts: 5,
  cooldownSeconds: 60,
  maxSendsPerHour: 5,
  adminIssued: { expiryDays: 7, maxAttempts: 5, length: 10 },
} as const;

export type IssueResult =
  | { issued: true; challenge: OtpChallenge; code: string }
  | { issued: false; reason: 'cooldown' | 'hourly-limit' };

@Injectable()
export class OtpService {
  constructor(private readonly keys: KeysService) {}

  /** Creates a challenge (superseding older open ones). The caller delivers `code` after commit. */
  async issue(
    db: Db,
    input: {
      tenantId: string;
      userId: string;
      purpose: OtpPurpose;
      channel: OtpChannel;
      target: string;
    },
  ): Promise<IssueResult> {
    const now = new Date();
    const adminIssued = input.channel === 'ADMIN_ISSUED';
    if (!adminIssued) {
      const recent = await db.otpChallenge.findMany({
        where: {
          userId: input.userId,
          purpose: input.purpose,
          createdAt: { gt: new Date(now.getTime() - 3_600_000) },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const latest = recent[0];
      if (
        latest &&
        now.getTime() - latest.createdAt.getTime() < OTP_POLICY.cooldownSeconds * 1000
      ) {
        return { issued: false, reason: 'cooldown' };
      }
      if (recent.length >= OTP_POLICY.maxSendsPerHour)
        return { issued: false, reason: 'hourly-limit' };
    }
    await db.otpChallenge.updateMany({
      where: { userId: input.userId, purpose: input.purpose, verifiedAt: null, supersededAt: null },
      data: { supersededAt: now },
    });
    const code = adminIssued ? humanCode(OTP_POLICY.adminIssued.length) : numericCode(6);
    const expiresAt = adminIssued
      ? new Date(now.getTime() + OTP_POLICY.adminIssued.expiryDays * 86_400_000)
      : new Date(now.getTime() + OTP_POLICY.expiryMinutes * 60_000);
    const challenge = await db.otpChallenge.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        purpose: input.purpose,
        channel: input.channel,
        target: input.target,
        codeHmac: this.keys.hmac(this.material(input.purpose, input.userId, code)),
        expiresAt,
        maxAttempts: adminIssued ? OTP_POLICY.adminIssued.maxAttempts : OTP_POLICY.maxAttempts,
      },
    });
    return { issued: true, challenge, code };
  }

  /**
   * Verifies against the user's latest open challenge for `purpose`. Every attempt counts; the
   * challenge dies at max attempts. Returns the verified challenge or null (always generic).
   */
  async verify(
    db: Db,
    input: { userId: string; purpose: OtpPurpose; code: string },
  ): Promise<OtpChallenge | null> {
    const now = new Date();
    const challenge = await db.otpChallenge.findFirst({
      where: {
        userId: input.userId,
        purpose: input.purpose,
        verifiedAt: null,
        supersededAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge || challenge.attempts >= challenge.maxAttempts) return null;
    // Count the attempt first (compare-and-set) so parallel guesses cannot exceed the limit.
    const counted = await db.otpChallenge.updateMany({
      where: { id: challenge.id, attempts: challenge.attempts, verifiedAt: null },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0) return null;
    const code =
      challenge.channel === 'ADMIN_ISSUED' ? normalizeHumanCode(input.code) : input.code.trim();
    if (
      !this.keys.hmacMatches(challenge.codeHmac, this.material(input.purpose, input.userId, code))
    ) {
      return null;
    }
    const verified = await db.otpChallenge.updateMany({
      where: { id: challenge.id, verifiedAt: null },
      data: { verifiedAt: now },
    });
    return verified.count === 1 ? { ...challenge, verifiedAt: now } : null;
  }

  /** Single use: marks a verified challenge's follow-up step done. False if already used/stale. */
  async complete(
    db: Db,
    challengeId: string,
    userId: string,
    purpose: OtpPurpose,
  ): Promise<OtpChallenge | null> {
    const challenge = await db.otpChallenge.findFirst({
      where: { id: challengeId, userId, purpose, completedAt: null, verifiedAt: { not: null } },
    });
    if (!challenge) return null;
    const done = await db.otpChallenge.updateMany({
      where: { id: challengeId, completedAt: null },
      data: { completedAt: new Date() },
    });
    return done.count === 1 ? challenge : null;
  }

  /** Binds the code to purpose and user so a code can never be replayed across either. */
  private material(purpose: OtpPurpose, userId: string, code: string): string {
    return `${purpose}:${userId}:${code}`;
  }
}
