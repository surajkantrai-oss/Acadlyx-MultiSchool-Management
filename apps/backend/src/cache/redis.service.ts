import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfigService } from '../config/app-config.service.js';

/**
 * Owns the application's shared Redis connection. Future phases build on this for
 * tenant-config caching, rate limiting and session metadata. BullMQ uses its own
 * connections (see QueueModule) because workers require blocking commands.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: AppConfigService) {
    this.client = new Redis(config.get('REDIS_URL'), {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      connectTimeout: 5_000,
      // Fail fast while disconnected instead of queueing: every Redis use (session cache, rate
      // limits) has a correct fallback, and requests must not stall during an outage.
      enableOfflineQueue: false,
    });
    this.client.on('ready', () => {
      this.logger.log('Redis connection ready');
    });
    this.client.on('error', (error: Error) => {
      this.logger.warn(`Redis error: ${error.message}`);
    });
  }

  /** Waits briefly for the first connection so startup work can use Redis; never fatal. */
  async onModuleInit(): Promise<void> {
    if (this.client.status === 'ready') return;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.client.off('ready', done);
        resolve();
      };
      const timer = setTimeout(done, 2_000);
      this.client.once('ready', done);
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
    // quit() resolves on Redis' OK reply; the socket closes (status 'end') slightly later.
    // Wait for the real close — bounded, so an unreachable Redis never stalls shutdown.
    const ended = new Promise<void>((resolve) => {
      this.client.once('end', () => {
        resolve();
      });
    });
    await this.client.quit().catch(() => {
      this.client.disconnect();
    });
    const status = (): string => this.client.status; // re-read (no stale narrowing)
    if (status() !== 'end') {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        ended,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 2_000);
        }),
      ]);
      clearTimeout(timer);
      if (status() !== 'end') this.client.disconnect();
    }
    this.logger.log('Redis connection closed');
  }
}
