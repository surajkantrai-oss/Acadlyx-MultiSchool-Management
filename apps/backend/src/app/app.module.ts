import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { AuthCoreModule } from '../auth/core/auth-core.module.js';
import { RedisModule } from '../cache/redis.module.js';
import { CommonModule } from '../common/common.module.js';
import { RequestContextMiddleware } from '../common/request-context.middleware.js';
import { AppConfigModule } from '../config/config.module.js';
import { HealthModule } from '../health/health.module.js';
import { LoggingModule } from '../logging/logging.module.js';
import { PlatformModule } from '../platform/platform.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { SecurityModule } from '../security/security.module.js';
import { TenantApiModule } from '../tenant-api/tenant-api.module.js';

/**
 * Root module of the Acadlyx modular monolith.
 * Scopes: platform (/api/v1/platform, PlatformModule) and tenant (/api/v1/tenant,
 * TenantApiModule). Feature modules are added phase by phase.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    CommonModule,
    RedisModule,
    QueueModule,
    SecurityModule,
    AuthCoreModule,
    HealthModule,
    PlatformModule,
    TenantApiModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
