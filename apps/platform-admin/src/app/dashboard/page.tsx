import { TENANT_STATUSES, type TenantStats } from '@acadlyx/tenant-config';
import { Alert } from '@acadlyx/web-ui';
import Link from 'next/link';
import { StatusBadge } from '@/components/status-badge';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  let stats: TenantStats;
  try {
    stats = await api.platform.tenantStats();
  } catch (error) {
    return <Alert title="Could not load platform statistics">{describeError(error)}</Alert>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <Link
          href="/schools/new"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Create school
        </Link>
      </div>
      <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-sm text-slate-500">Total tenants</dt>
          <dd className="mt-1 text-3xl font-semibold" data-testid="stat-total">
            {stats.total}
          </dd>
        </div>
        {TENANT_STATUSES.map((status) => (
          <div key={status} className="rounded-lg border border-slate-200 bg-white p-4">
            <dt>
              <Link href={`/schools?status=${status}`} className="hover:underline">
                <StatusBadge status={status} />
              </Link>
            </dt>
            <dd className="mt-2 text-3xl font-semibold" data-testid={`stat-${status}`}>
              {stats.byStatus[status]}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
