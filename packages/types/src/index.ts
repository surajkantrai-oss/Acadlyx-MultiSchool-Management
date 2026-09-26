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
  message: string | string[];
  requestId: string | null;
  timestamp: string;
  path: string;
}
