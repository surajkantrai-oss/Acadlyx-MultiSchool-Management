import { API_BASE_PATH } from '@acadlyx/constants';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter.js';
import { AppConfigService } from '../config/app-config.service.js';
import { buildCorsOptions, securityHeaders } from '../security/http-security.js';

/**
 * Applies global HTTP configuration. Shared by main.ts and e2e tests so tests exercise
 * the same pipeline as production.
 */
export function configureApp(app: NestExpressApplication): INestApplication {
  const config = app.get(AppConfigService);

  app.useLogger(app.get(Logger));
  app.set('trust proxy', config.get('TRUST_PROXY'));
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: config.get('BODY_LIMIT') });
  app.useBodyParser('urlencoded', { limit: config.get('BODY_LIMIT'), extended: false });

  app.use(securityHeaders());
  app.enableCors(buildCorsOptions(config.get('CORS_ORIGINS')));

  app.setGlobalPrefix(API_BASE_PATH.slice(1));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      disableErrorMessages: config.isProduction,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  return app;
}
