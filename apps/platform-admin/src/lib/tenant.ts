import { ApiError } from '@acadlyx/api-client';
import type { TenantDetail } from '@acadlyx/tenant-config';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { api } from './api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Loads a tenant for a /schools/[tenantId] route (deduplicated per request); 404 page if missing. */
export const loadTenant = cache(async (tenantId: string): Promise<TenantDetail> => {
  if (!UUID.test(tenantId)) notFound();
  try {
    return await api.platform.getTenant(tenantId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
});
