import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';

/**
 * BullMQ foundation: a shared connection configuration and sensible job defaults.
 *
 * No queues are registered in Phase 1. Feature modules register their own queues
 * with `BullModule.registerQueue({ name })` (e.g. notifications, imports,
 * payment-webhooks) in the phase that introduces them.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const url = new URL(config.get('REDIS_URL'));
        return {
          connection: {
            host: url.hostname,
            port: url.port ? Number(url.port) : 6379,
            db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
            ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
            ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
            ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
          },
          prefix: 'acadlyx',
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 1_000 },
            removeOnComplete: 1_000,
            removeOnFail: 5_000,
          },
        };
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
