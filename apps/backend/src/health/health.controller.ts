import { HEALTH_PATH } from '@acadlyx/constants';
import type { HealthResponse } from '@acadlyx/types';
import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../cache/redis.service.js';

const CHECK_TIMEOUT_MS = 2_000;

function withTimeout(check: Promise<boolean>): Promise<boolean> {
  return Promise.race([
    check,
    new Promise<boolean>((resolve) =>
      setTimeout(() => {
        resolve(false);
      }, CHECK_TIMEOUT_MS),
    ),
  ]);
}

@SkipThrottle()
@Controller(HEALTH_PATH)
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Liveness + dependency readiness. Returns 503 when any dependency is down. */
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([
      withTimeout(this.prisma.isHealthy()),
      withTimeout(this.redis.isHealthy()),
    ]);
    const healthy = database && redis;
    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return {
      status: healthy ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      checks: {
        application: 'up',
        database: database ? 'up' : 'down',
        redis: redis ? 'up' : 'down',
      },
    };
  }
}
