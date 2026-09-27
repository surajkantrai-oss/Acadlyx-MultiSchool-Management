import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../cache/redis.service.js';

/** Session validity snapshot (never contains secrets). */
export interface CachedSession {
  scope: 'TENANT' | 'PLATFORM';
  ownerId: string;
  tenantId: string | null;
  mfaPending: boolean;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
}

export interface CachedGrants {
  roles: string[];
  permissions: string[];
}

export const AUTH_CACHE_TTL_SECONDS = 30;

/**
 * Short-lived Redis cache for session validity and role/permission grants.
 * PostgreSQL stays the source of truth: every miss or Redis error falls back to the database,
 * entries expire after 30 s, and revocations/role changes delete entries explicitly.
 */
@Injectable()
export class AuthCacheService {
  private readonly logger = new Logger(AuthCacheService.name);

  constructor(private readonly redis: RedisService) {}

  getSession(sessionId: string): Promise<CachedSession | undefined> {
    return this.get<CachedSession>(`auth:sess:${sessionId}`);
  }

  setSession(sessionId: string, value: CachedSession): Promise<void> {
    return this.set(`auth:sess:${sessionId}`, value);
  }

  async deleteSessions(sessionIds: readonly string[]): Promise<void> {
    if (sessionIds.length === 0) return;
    await this.del(sessionIds.map((id) => `auth:sess:${id}`));
  }

  getGrants(scope: string, ownerId: string): Promise<CachedGrants | undefined> {
    return this.get<CachedGrants>(`auth:grants:${scope}:${ownerId}`);
  }

  setGrants(scope: string, ownerId: string, value: CachedGrants): Promise<void> {
    return this.set(`auth:grants:${scope}:${ownerId}`, value);
  }

  deleteGrants(scope: string, ownerId: string): Promise<void> {
    return this.del([`auth:grants:${scope}:${ownerId}`]);
  }

  /** Drops every cached grant (after the role/permission catalogue changes). */
  async deleteAllGrants(): Promise<void> {
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.client.scan(
          cursor,
          'MATCH',
          'auth:grants:*',
          'COUNT',
          500,
        );
        cursor = next;
        if (keys.length > 0) await this.redis.client.del(...keys);
      } while (cursor !== '0');
    } catch (error) {
      this.logger.warn(`Grant cache flush failed: ${(error as Error).message}`);
    }
  }

  private async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await this.redis.client.get(key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch {
      return undefined;
    }
  }

  private async set(key: string, value: unknown): Promise<void> {
    try {
      await this.redis.client.set(key, JSON.stringify(value), 'EX', AUTH_CACHE_TTL_SECONDS);
    } catch {
      // Cache is an optimisation only.
    }
  }

  private async del(keys: string[]): Promise<void> {
    try {
      await this.redis.client.del(...keys);
    } catch (error) {
      // Bounded by the 30 s TTL if an explicit invalidation is missed.
      this.logger.warn(`Auth cache invalidation failed: ${(error as Error).message}`);
    }
  }
}
