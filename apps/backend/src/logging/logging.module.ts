import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { REQUEST_ID_HEADER } from '@acadlyx/constants';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** Paths redacted from every log line. Extend as new sensitive fields appear. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.pin',
  '*.otp',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
];

/** Accepts a well-formed incoming request id, otherwise generates one, and echoes it back. */
export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          genReqId: resolveRequestId,
          // Tenant identity (never configuration values) for tenant-scoped requests.
          customProps: (req: IncomingMessage & { tenantLog?: Record<string, string> }) =>
            req.tenantLog ?? {},
          redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
          // Structured JSON in staging/production (CloudWatch-ready); pretty output locally.
          ...(config.get('NODE_ENV') === 'development'
            ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
            : {}),
          autoLogging: { ignore: (req: IncomingMessage) => req.url?.endsWith('/health') ?? false },
          customLogLevel: (_req: IncomingMessage, res: ServerResponse, error?: Error) =>
            error || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
          serializers: {
            req: (req: { id: string; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
        },
      }),
    }),
  ],
})
export class LoggingModule {}
