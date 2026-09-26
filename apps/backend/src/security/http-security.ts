import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';
import { REQUEST_ID_HEADER } from '@acadlyx/constants';
import helmet from 'helmet';

/** Exact-match CORS allow-list from CORS_ORIGINS. Requests without an Origin (curl, mobile) pass. */
export function buildCorsOptions(allowedOrigins: readonly string[]): CorsOptions {
  const allowed = new Set(allowedOrigins);
  return {
    origin: (origin, callback) => {
      callback(null, origin === undefined || allowed.has(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: [REQUEST_ID_HEADER],
    maxAge: 600,
  };
}

/** API-appropriate security headers: the API serves JSON only, so lock the CSP down fully. */
export function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
}
