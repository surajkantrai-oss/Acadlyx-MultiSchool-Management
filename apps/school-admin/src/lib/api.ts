import { createApiClient } from '@acadlyx/api-client';
import { appConfig } from './config';

/** Shared API client. Auth/tenant headers are attached via `getHeaders` in later phases. */
export const api = createApiClient({ baseUrl: appConfig.apiBaseUrl });
