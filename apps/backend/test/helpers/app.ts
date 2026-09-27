import type { DynamicModule } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app/app.module.js';
import { configureApp } from '../../src/app/configure-app.js';
import { AppConfigService } from '../../src/config/app-config.service.js';
import type { Env } from '../../src/config/env.schema.js';

export interface TestAppOptions {
  overrides?: Partial<Env>;
  /** Simulate production rules (e.g. only verified domains resolve). */
  production?: boolean;
  extraImports?: DynamicModule[];
}

/** Boots the full application with the same HTTP pipeline as main.ts. */
export async function createTestApp(options: TestAppOptions = {}): Promise<NestExpressApplication> {
  const builder = Test.createTestingModule({
    imports: [AppModule, ...(options.extraImports ?? [])],
  });
  const overrides = options.overrides ?? {};
  if (Object.keys(overrides).length > 0 || options.production) {
    const base = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const real = base.get(AppConfigService);
    await base.close();
    builder.overrideProvider(AppConfigService).useValue({
      get: <K extends keyof Env>(key: K): Env[K] =>
        key in overrides ? (overrides[key] as Env[K]) : real.get(key),
      isProduction: options.production ?? false,
    });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app);
  await app.init();
  // Listen ONCE on an ephemeral loopback port for the app's lifetime. Otherwise supertest calls
  // listen(0)/close() around every request, and under load a client can connect to a port that
  // was just released and end up TCP-self-connected (seen as "Parse Error: Expected HTTP/").
  await app.listen(0, '127.0.0.1');
  return app;
}
