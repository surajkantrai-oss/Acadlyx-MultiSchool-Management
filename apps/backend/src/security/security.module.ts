import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { RedisService } from '../cache/redis.service.js';
import { AppConfigService } from '../config/app-config.service.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

/**
 * Global rate limiting, Redis-backed (Phase 3) so limits hold across instances and restarts.
 * Default: RATE_LIMIT_MAX per RATE_LIMIT_TTL_MS per client IP; sensitive auth routes apply
 * stricter @Throttle() limits (src/auth/core/throttles.ts).
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService, RedisService],
      useFactory: (config: AppConfigService, redis: RedisService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.get('RATE_LIMIT_TTL_MS'),
            limit: config.get('RATE_LIMIT_MAX'),
          },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class SecurityModule {}
