import { Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from '../cache/redis.service.js';
import { MemoryWindowCounter } from './memory-window.js';

interface StorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Redis-backed throttler storage (Phase 3): limits hold across backend instances and restarts.
 * Fixed window per key.
 *
 * Degraded mode: if Redis is unavailable, limits fall back to per-instance in-memory windows —
 * weaker (not shared across instances) but never unlimited. PostgreSQL lockout counters keep
 * protecting credentials regardless.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly fallback = new MemoryWindowCounter();

  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<StorageRecord> {
    const hitKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `${hitKey}:blocked`;
    try {
      const blockedTtl = await this.redis.client.pttl(blockKey);
      if (blockedTtl > 0) {
        return {
          totalHits: limit + 1,
          timeToExpire: Math.ceil(blockedTtl / 1000),
          isBlocked: true,
          timeToBlockExpire: Math.ceil(blockedTtl / 1000),
        };
      }
      const results = await this.redis.client
        .multi()
        .incr(hitKey)
        .pexpire(hitKey, ttl, 'NX')
        .pttl(hitKey)
        .exec();
      const totalHits = Number(results?.[0]?.[1] ?? 0);
      const remainingMs = Number(results?.[2]?.[1] ?? ttl);
      if (totalHits > limit) {
        const blockMs = blockDuration > 0 ? blockDuration : remainingMs;
        await this.redis.client.set(blockKey, '1', 'PX', blockMs);
        return {
          totalHits,
          timeToExpire: Math.ceil(remainingMs / 1000),
          isBlocked: true,
          timeToBlockExpire: Math.ceil(blockMs / 1000),
        };
      }
      return {
        totalHits,
        timeToExpire: Math.ceil(remainingMs / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    } catch (error) {
      this.logger.warn(
        `Rate-limit storage unavailable, using per-instance fallback: ${(error as Error).message}`,
      );
      const { count, remainingMs } = this.fallback.hit(hitKey, ttl);
      const seconds = Math.ceil(remainingMs / 1000);
      return {
        totalHits: count,
        timeToExpire: seconds,
        isBlocked: count > limit,
        timeToBlockExpire: count > limit ? seconds : 0,
      };
    }
  }
}
