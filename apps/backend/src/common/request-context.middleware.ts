import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from './request-context.js';

/** Opens the per-request context store (applied to every route, before tenant resolution). */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    // Idempotent: applied globally and again ahead of tenant resolution.
    if (RequestContext.state()) {
      next();
      return;
    }
    const userAgent = req.headers['user-agent'];
    RequestContext.run(
      {
        requestId: typeof req.id === 'string' ? req.id : null,
        ip: req.ip ?? null,
        userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 255) : null,
      },
      () => {
        next();
      },
    );
  }
}
