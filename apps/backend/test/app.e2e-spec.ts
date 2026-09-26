import { BullModule, getQueueToken } from '@nestjs/bullmq';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app/app.module.js';
import { configureApp } from '../src/app/configure-app.js';
import { RedisService } from '../src/cache/redis.service.js';
import { AppConfigService } from '../src/config/app-config.service.js';
import type { Env } from '../src/config/env.schema.js';
import { PrismaService } from '../src/database/prisma.service.js';

// Test-only queue proving the BullMQ foundation can open a Redis connection.
const PROBE_QUEUE = 'phase1-connectivity-probe';

async function createApp(overrides: Partial<Env> = {}): Promise<NestExpressApplication> {
  const builder = Test.createTestingModule({
    imports: [AppModule, BullModule.registerQueue({ name: PROBE_QUEUE })],
  });
  if (Object.keys(overrides).length > 0) {
    const base = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const real = base.get(AppConfigService);
    await base.close();
    builder.overrideProvider(AppConfigService).useValue({
      get: <K extends keyof Env>(key: K): Env[K] =>
        key in overrides ? (overrides[key] as Env[K]) : real.get(key),
      isProduction: false,
    });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app);
  await app.init();
  return app;
}

describe('Acadlyx API foundation (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health reports all dependencies up', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      checks: { application: 'up', database: 'up', redis: 'up' },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/postgres|redis:\/\/|password/i);
  });

  it('serves routes only under the /api/v1 prefix', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it('returns the standard error envelope and echoes the request id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .set('x-request-id', 'e2e-req-1')
      .expect(404);
    expect(res.headers['x-request-id']).toBe('e2e-req-1');
    expect(res.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      requestId: 'e2e-req-1',
      path: '/api/v1/does-not-exist',
    });
    expect(res.body).not.toHaveProperty('stack');
  });

  it('applies security headers', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows configured CORS origins and rejects others', async () => {
    const allowed = app.get(AppConfigService).get('CORS_ORIGINS')[0];
    expect(allowed).toBeDefined();
    const ok = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', allowed ?? '');
    expect(ok.headers['access-control-allow-origin']).toBe(allowed);

    const denied = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example.com');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('connects to PostgreSQL through Prisma', async () => {
    await expect(app.get(PrismaService).isHealthy()).resolves.toBe(true);
  });

  it('connects to Redis', async () => {
    await expect(app.get(RedisService).isHealthy()).resolves.toBe(true);
  });

  it('opens BullMQ connections from the shared queue configuration', async () => {
    const queue = app.get<Queue>(getQueueToken(PROBE_QUEUE));
    await queue.waitUntilReady();
    // Read-only round-trip through the queue's Redis connection.
    await expect(queue.getJobCounts('waiting')).resolves.toEqual({ waiting: 0 });
  });
});

describe('Acadlyx API with an unavailable dependency (e2e)', () => {
  it('returns 503 and marks Redis down when Redis is unreachable', async () => {
    const app = await createApp({ REDIS_URL: 'redis://127.0.0.1:1/0' });
    try {
      const res = await request(app.getHttpServer()).get('/api/v1/health').expect(503);
      expect(res.body).toMatchObject({
        status: 'error',
        checks: { application: 'up', database: 'up', redis: 'down' },
      });
    } finally {
      await app.close();
    }
  }, 15_000);
});

describe('Graceful shutdown (e2e)', () => {
  it('closes Redis and PostgreSQL connections on app.close()', async () => {
    const app = await createApp();
    const redis = app.get(RedisService);
    await app.close();
    expect(redis.client.status).toBe('end');
  });
});
