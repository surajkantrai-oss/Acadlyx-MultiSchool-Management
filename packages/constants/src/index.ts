/**
 * Technical constants shared across Acadlyx applications.
 * Business constants (roles, statuses, fee types, ...) belong to their own phases.
 */

export const APP_NAME = 'Acadlyx';
export const APP_TAGLINE = 'School Operating Platform';

/** REST API is versioned and served under `/api/v1`. */
export const API_GLOBAL_PREFIX = 'api';
export const API_VERSION = 'v1';
export const API_BASE_PATH = `/${API_GLOBAL_PREFIX}/${API_VERSION}` as const;

export const HEALTH_PATH = 'health';

/** Header used to correlate a request across logs and error responses. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Default local development ports (see docs/development/local-setup.md). */
export const DEFAULT_DEV_PORTS = {
  backend: 4000,
  platformAdmin: 4001,
  schoolAdmin: 4002,
} as const;
