import { Injectable } from '@nestjs/common';
import { RedisService } from '../../cache/redis.service.js';
import { MemoryWindowCounter } from '../../security/memory-window.js';
import { tooManyAttempts } from './auth-errors.js';
import { sha256 } from './crypto/random.js';

/**
 * Per-identifier attempt limiter (credential-stuffing/brute-force layer independent of IP):
 * at most 10 login attempts per identifier per 15 minutes — applied identically whether or not
 * the account exists, so it reveals nothing. Complements per-IP route throttling and the
 * per-account lockout stored in PostgreSQL.
 */
export const IDENTIFIER_LIMIT = { attempts: 10, windowSeconds: 15 * 60 } as const;

@Injectable()
export class IdentifierLimiterService {
  /** Degraded-mode fallback when Redis is down: per-instance, never unlimited. */
  private readonly fallback = new MemoryWindowCounter();

  constructor(private readonly redis: RedisService) {}

  async hit(scope: string, identifier: string): Promise<void> {
    const key = `auth:ident:${scope}:${sha256(identifier.trim().toLowerCase())}`;
    let count: number;
    try {
      const result = await this.redis.client
        .multi()
        .incr(key)
        .expire(key, IDENTIFIER_LIMIT.windowSeconds, 'NX')
        .exec();
      count = Number(result?.[0]?.[1] ?? 0);
    } catch {
      count = this.fallback.hit(key, IDENTIFIER_LIMIT.windowSeconds * 1000).count;
    }
    if (count > IDENTIFIER_LIMIT.attempts) throw tooManyAttempts();
  }
}
