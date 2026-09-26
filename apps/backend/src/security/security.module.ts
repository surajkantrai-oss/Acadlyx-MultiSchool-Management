import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigService } from '../config/app-config.service.js';

/**
 * Global rate-limit foundation. Uses in-memory storage for now; switch to Redis-backed
 * storage before running more than one backend instance. Per-route limits (login, OTP)
 * are added with @Throttle() in Phase 3.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => [
        { ttl: config.get('RATE_LIMIT_TTL_MS'), limit: config.get('RATE_LIMIT_MAX') },
      ],
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class SecurityModule {}
