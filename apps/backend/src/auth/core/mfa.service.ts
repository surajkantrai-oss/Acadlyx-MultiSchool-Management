import type { MfaEnrollmentStart } from '@acadlyx/types';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { mfaAlreadyEnrolled, mfaNotEnrolled } from './auth-errors.js';
import { KeysService } from './crypto/keys.service.js';
import { normalizeHumanCode, recoveryCode } from './crypto/random.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from './crypto/totp.js';
import { type Owner, ownerColumns, ownerId, ownerWhere } from './owner.js';

type Db = Prisma.TransactionClient;

export const RECOVERY_CODE_COUNT = 10;

/**
 * TOTP MFA (RFC 6238) with AES-256-GCM-encrypted secrets and HMAC'd one-time recovery codes.
 * The method table supports further types (WEBAUTHN is reserved in the enum) for passkeys later.
 */
@Injectable()
export class MfaService {
  constructor(private readonly keys: KeysService) {}

  private aad(owner: Owner): string {
    return `mfa:${owner.scope}:${ownerId(owner)}`;
  }

  async status(
    db: Db,
    owner: Owner,
  ): Promise<{ enrolled: boolean; recoveryCodesRemaining: number }> {
    const method = await db.mfaMethod.findFirst({
      where: { ...ownerWhere(owner), type: 'TOTP', verifiedAt: { not: null } },
    });
    const remaining = await db.mfaRecoveryCode.count({
      where: { ...ownerWhere(owner), usedAt: null },
    });
    return { enrolled: method !== null, recoveryCodesRemaining: method ? remaining : 0 };
  }

  /** Starts (or restarts) enrollment. The method stays inactive until confirmed with a code. */
  async startEnrollment(
    db: Db,
    owner: Owner,
    account: string,
    issuer: string,
  ): Promise<MfaEnrollmentStart> {
    const existing = await db.mfaMethod.findFirst({
      where: { ...ownerWhere(owner), type: 'TOTP' },
    });
    if (existing?.verifiedAt) throw mfaAlreadyEnrolled();
    const secret = generateTotpSecret();
    const secretEncrypted = this.keys.encrypt(secret, this.aad(owner));
    if (existing) {
      await db.mfaMethod.update({
        where: { id: existing.id },
        data: { secretEncrypted, lastUsedStep: null },
      });
    } else {
      await db.mfaMethod.create({
        data: { ...ownerColumns(owner), type: 'TOTP', secretEncrypted },
      });
    }
    return { secret, otpauthUri: otpauthUri(secret, issuer, account) };
  }

  /** Confirms enrollment with a valid code; only then is MFA active. Returns recovery codes. */
  async confirmEnrollment(db: Db, owner: Owner, code: string): Promise<string[] | null> {
    const method = await db.mfaMethod.findFirst({
      where: { ...ownerWhere(owner), type: 'TOTP', verifiedAt: null },
    });
    if (!method) throw mfaNotEnrolled();
    const step = verifyTotp(
      this.keys.decrypt(method.secretEncrypted, this.aad(owner)),
      code,
      Date.now(),
    );
    if (step === null) return null;
    await db.mfaMethod.update({
      where: { id: method.id },
      data: { verifiedAt: new Date(), lastUsedStep: BigInt(step) },
    });
    return this.replaceRecoveryCodes(db, owner);
  }

  /**
   * Verifies a TOTP code (each time-step accepted once) or a one-time recovery code.
   * Returns which factor succeeded, or null.
   */
  async verify(
    db: Db,
    owner: Owner,
    input: { code?: string; recoveryCode?: string },
  ): Promise<'totp' | 'recovery' | null> {
    const method = await db.mfaMethod.findFirst({
      where: { ...ownerWhere(owner), type: 'TOTP', verifiedAt: { not: null } },
    });
    if (!method) return null;
    if (input.code) {
      const step = verifyTotp(
        this.keys.decrypt(method.secretEncrypted, this.aad(owner)),
        input.code,
        Date.now(),
      );
      if (step === null) return null;
      if (method.lastUsedStep !== null && BigInt(step) <= method.lastUsedStep) return null; // replay
      const claimed = await db.mfaMethod.updateMany({
        where: {
          id: method.id,
          OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(step) } }],
        },
        data: { lastUsedStep: BigInt(step) },
      });
      return claimed.count === 1 ? 'totp' : null;
    }
    if (input.recoveryCode) {
      const normalized = normalizeHumanCode(input.recoveryCode);
      const codes = await db.mfaRecoveryCode.findMany({
        where: { ...ownerWhere(owner), usedAt: null },
      });
      const match = codes.find((c) =>
        this.keys.hmacMatches(c.codeHmac, `recovery:${ownerId(owner)}:${normalized}`),
      );
      if (!match) return null;
      const used = await db.mfaRecoveryCode.updateMany({
        where: { id: match.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      return used.count === 1 ? 'recovery' : null;
    }
    return null;
  }

  async replaceRecoveryCodes(db: Db, owner: Owner): Promise<string[]> {
    await db.mfaRecoveryCode.deleteMany({ where: ownerWhere(owner) });
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => recoveryCode());
    await db.mfaRecoveryCode.createMany({
      data: codes.map((code) => ({
        ...ownerColumns(owner),
        codeHmac: this.keys.hmac(`recovery:${ownerId(owner)}:${normalizeHumanCode(code)}`),
      })),
    });
    return codes;
  }

  async remove(db: Db, owner: Owner): Promise<void> {
    await db.mfaRecoveryCode.deleteMany({ where: ownerWhere(owner) });
    await db.mfaMethod.deleteMany({ where: { ...ownerWhere(owner), type: 'TOTP' } });
  }
}
