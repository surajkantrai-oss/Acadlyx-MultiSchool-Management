import { RecordNotFound } from '@/components/record-not-found';
import { TenantProblem } from '@/components/tenant-problem';
import { loadCurrentTenant } from '@/lib/tenant';

/**
 * HTTP 404 boundary. Distinguishes an unknown school address ("School not found") from a
 * missing page or record inside a known school ("Record not found") — the status stays 404.
 * The tenant lookup is request-cached, so this adds no extra API call in the common case.
 */
export default async function NotFound() {
  const result = await loadCurrentTenant();
  if (result.kind !== 'ok') return <TenantProblem kind="not-found" />;
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center p-6">
      <RecordNotFound back="/" backLabel="Back to the dashboard" />
    </main>
  );
}
