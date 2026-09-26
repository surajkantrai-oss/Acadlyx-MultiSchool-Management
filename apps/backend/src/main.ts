import 'reflect-metadata';
import { API_BASE_PATH } from '@acadlyx/constants';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app/app.module.js';
import { configureApp } from './app/configure-app.js';
import { AppConfigService } from './config/app-config.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  configureApp(app);

  const config = app.get(AppConfigService);
  const port = config.get('PORT');
  await app.listen(port);

  app
    .get(Logger)
    .log(`Acadlyx API listening on port ${port} (${config.get('NODE_ENV')}) at ${API_BASE_PATH}`);
}

bootstrap().catch((error: unknown) => {
  // Logger may not exist yet (e.g. invalid environment) — write directly to stderr.
  process.stderr.write(
    `Acadlyx API failed to start:\n${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
