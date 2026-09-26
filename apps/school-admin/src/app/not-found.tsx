import { TenantProblem } from '@/components/tenant-problem';

/**
 * HTTP 404 — no school is connected to this host (or the route does not exist).
 * Kept synchronous so the error UI is part of the server-rendered HTML, not only streamed.
 */
export default function NotFound() {
  return <TenantProblem kind="not-found" />;
}
