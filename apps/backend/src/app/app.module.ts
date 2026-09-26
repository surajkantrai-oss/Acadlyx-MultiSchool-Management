import { Module } from '@nestjs/common';
import { RedisModule } from '../cache/redis.module.js';
import { CommonModule } from '../common/common.module.js';
import { AppConfigModule } from '../config/config.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { HealthModule } from '../health/health.module.js';
import { LoggingModule } from '../logging/logging.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { SecurityModule } from '../security/security.module.js';

/**
 * Root module of the Acadlyx modular monolith.
 * Phase 1: infrastructure only. Feature modules are added phase by phase.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    CommonModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    SecurityModule,
    HealthModule,
  ],
})
export class AppModule {}
