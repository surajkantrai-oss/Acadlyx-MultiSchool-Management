import { createApiClient } from '@acadlyx/api-client';
import { env } from '../config/env';

/** Shared API client. Auth and tenant headers are attached via `getHeaders` in later phases. */
export const api = createApiClient({ baseUrl: env.apiBaseUrl });
