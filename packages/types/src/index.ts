/**
 * Foundation-level types shared by the backend and client applications.
 * Business/domain entities are introduced in the phases that own them.
 */

export type AppEnvironment = 'development' | 'test' | 'staging' | 'production';

export type DependencyStatus = 'up' | 'down';

export interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  checks: {
    application: DependencyStatus;
    database: DependencyStatus;
    redis: DependencyStatus;
  };
}

/** Shape of every error response returned by the Acadlyx API. */
export interface ApiErrorResponse {
  statusCode: number;
  error: string;
  /** Stable machine-readable code for domain errors, e.g. TENANT_NOT_FOUND. */
  code?: string;
  message: string | string[];
  requestId: string | null;
  timestamp: string;
  path: string;
}

export * from './auth.js';
export * from './academic.js';
export * from './people.js';
export * from './workspace.js';
export * from './operations.js';
export * from './mobile.js';
export * from './assessment.js';
