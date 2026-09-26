import { TenantProblem } from '@/components/tenant-problem';

/**
 * HTTP 403 — the school exists but is DRAFT, SUSPENDED, INACTIVE or ARCHIVED.
 * Kept synchronous so the error UI is part of the server-rendered HTML, not only streamed.
 */
export default function Forbidden() {
  return <TenantProblem kind="unavailable" />;
}
