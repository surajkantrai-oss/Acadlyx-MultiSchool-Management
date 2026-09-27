import 'server-only';
import type { TenantBootstrap } from '@acadlyx/tenant-config';
import { forbidden, notFound } from 'next/navigation';
import { loadCurrentTenant } from './tenant';

/**
 * Resolves the school for a page with the Phase 2 HTTP semantics preserved:
 * unknown host → 404, DRAFT/SUSPENDED/INACTIVE/ARCHIVED → 403. Runs BEFORE any auth logic.
 */
export async function requireSchool(): Promise<
  TenantBootstrap | { problem: 'conflict' | 'error'; host: string }
> {
  const result = await loadCurrentTenant();
  if (result.kind === 'not-found') notFound();
  if (result.kind === 'unavailable') forbidden();
  if (result.kind !== 'ok') return { problem: result.kind, host: result.host };
  return result.tenant;
}
