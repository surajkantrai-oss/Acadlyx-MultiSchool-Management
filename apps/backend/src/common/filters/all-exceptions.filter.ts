import type { ApiErrorResponse } from '@acadlyx/types';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import type { Request, Response } from 'express';

/**
 * Converts every thrown error into the standard ApiErrorResponse shape.
 * Unexpected errors are logged with their stack but returned as a generic 500 —
 * stack traces, SQL and driver details never reach the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    // Assigned by pino-http (see LoggingModule); absent only if logging middleware did not run.
    const requestId = typeof req.id === 'string' ? req.id : null;
    const res = ctx.getResponse<Response>();

    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let code: string | undefined;

    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      message =
        typeof payload === 'object' && 'message' in payload
          ? (payload.message as string | string[])
          : exception.message;
      if (typeof payload === 'object' && 'code' in payload && typeof payload.code === 'string') {
        code = payload.code;
      }
    }

    if (statusCode >= 500) {
      this.logger.error(
        { err: exception, requestId },
        exception instanceof Error ? exception.message : 'Unhandled non-error exception',
      );
    }

    const body: ApiErrorResponse = {
      statusCode,
      error: STATUS_CODES[statusCode] ?? 'Error',
      ...(code ? { code } : {}),
      message,
      requestId,
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
    };
    res.status(statusCode).json(body);
  }
}
