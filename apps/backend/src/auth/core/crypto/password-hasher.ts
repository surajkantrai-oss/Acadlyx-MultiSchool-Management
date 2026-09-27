import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/**
 * Argon2id (approved Phase 3 policy): 19 MiB memory, 2 iterations, parallelism 1.
 * Only the encoded hash (which embeds its own parameters and salt) is stored.
 */
export const ARGON2_POLICY = { memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordHasher {
  /** Pre-computed hash used to spend equal time when the account does not exist. */
  private dummyHash: Promise<string> | null = null;

  hash(secret: string): Promise<string> {
    return argon2.hash(secret, { type: argon2.argon2id, ...ARGON2_POLICY });
  }

  async verify(encodedHash: string, secret: string): Promise<boolean> {
    try {
      return await argon2.verify(encodedHash, secret);
    } catch {
      return false;
    }
  }

  /** True when the stored hash was produced with weaker/outdated parameters (rehash on login). */
  needsRehash(encodedHash: string): boolean {
    return argon2.needsRehash(encodedHash, ARGON2_POLICY);
  }

  /** Burns comparable CPU for unknown identifiers so timing does not reveal account existence. */
  async verifyDummy(secret: string): Promise<false> {
    this.dummyHash ??= this.hash('acadlyx-timing-equaliser');
    await this.verify(await this.dummyHash, secret);
    return false;
  }
}
