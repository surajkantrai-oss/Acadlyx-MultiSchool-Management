import {
  TENANT_STATUSES,
  type Paginated,
  type TenantStatus,
  type TenantSummary,
} from '@acadlyx/tenant-config';
import { Alert, EmptyState, inputClassName } from '@acadlyx/web-ui';
import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import { StatusBadge } from '@/components/status-badge';
import { serverApi } from '@/lib/server/session';
import { describeError } from '@/lib/errors';
import { formatDate } from '@/lib/status';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

interface SchoolsPageProps {
  searchParams: Promise<{ search?: string; status?: string; page?: string }>;
}

export default async function SchoolsPage({ searchParams }: SchoolsPageProps) {
  const params = await searchParams;
  const search = params.search?.trim() ?? '';
  const status = TENANT_STATUSES.find((s) => s === params.status);
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  let result: Paginated<TenantSummary> | null = null;
  let error: string | null = null;
  try {
    result = await (
      await serverApi()
    ).platform.listTenants({
      ...(search ? { search } : {}),
      ...(status ? { status } : {}),
      page,
      pageSize: PAGE_SIZE,
    });
  } catch (e) {
    unstable_rethrow(e); // let the /login redirect through
    error = describeError(e);
  }

  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (search) query.set('search', search);
    if (status) query.set('status', status);
    query.set('page', String(target));
    return `/schools?${query.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Schools</h1>
        <Link
          href="/schools/new"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Create school
        </Link>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3" role="search">
        <div className="min-w-64 flex-1">
          <label htmlFor="search" className="text-sm font-medium">
            Search
          </label>
          <input
            id="search"
            name="search"
            defaultValue={search}
            placeholder="Name, key, slug or domain"
            className={inputClassName}
            maxLength={100}
          />
        </div>
        <div>
          <label htmlFor="status" className="text-sm font-medium">
            Status
          </label>
          <select id="status" name="status" defaultValue={status ?? ''} className={inputClassName}>
            <option value="">All statuses</option>
            {TENANT_STATUSES.map((s: TenantStatus) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          Apply
        </button>
      </form>

      {error ? <Alert title="Could not load schools">{error}</Alert> : null}

      {result && result.items.length === 0 ? (
        <EmptyState title={search || status ? 'No schools match these filters' : 'No schools yet'}>
          {search || status
            ? 'Try a different search or status.'
            : 'Create the first tenant to get started.'}
        </EmptyState>
      ) : null}

      {result && result.items.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    School
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Key
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Slug
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Primary domain
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((tenant) => (
                  <tr
                    key={tenant.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                  >
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/schools/${tenant.id}`} className="hover:underline">
                        {tenant.displayName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{tenant.key}</td>
                    <td className="px-4 py-3 font-mono text-xs">{tenant.slug}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={tenant.status} />
                    </td>
                    <td className="px-4 py-3">{tenant.primaryDomain ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(tenant.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav
            aria-label="Pagination"
            className="flex items-center justify-between text-sm text-slate-600"
          >
            <span>
              {result.total} school{result.total === 1 ? '' : 's'} · page {result.page} of{' '}
              {Math.max(result.totalPages, 1)}
            </span>
            <span className="flex gap-3">
              {result.page > 1 ? (
                <Link href={pageHref(result.page - 1)} className="hover:underline">
                  Previous
                </Link>
              ) : null}
              {result.page < result.totalPages ? (
                <Link href={pageHref(result.page + 1)} className="hover:underline">
                  Next
                </Link>
              ) : null}
            </span>
          </nav>
        </>
      ) : null}
    </div>
  );
}
