import { Module } from '@nestjs/common';
import { RedisModule } from '../cache/redis.module.js';
import { CommonModule } from '../common/common.module.js';
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
    HealthModule,
    PlatformModule,
    TenantApiModule,
  ],
})
export class AppModule {}
