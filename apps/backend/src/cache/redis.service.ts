import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfigService } from '../config/app-config.service.js';

/**
 * Owns the application's shared Redis connection. Future phases build on this for
 * tenant-config caching, rate limiting and session metadata. BullMQ uses its own
 * connections (see QueueModule) because workers require blocking commands.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: AppConfigService) {
    this.client = new Redis(config.get('REDIS_URL'), {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      connectTimeout: 5_000,
    });
    this.client.on('ready', () => {
      this.logger.log('Redis connection ready');
    });
    this.client.on('error', (error: Error) => {
      this.logger.warn(`Redis error: ${error.message}`);
    });
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => {
      this.client.disconnect();
    });
    this.logger.log('Redis connection closed');
  }
}
