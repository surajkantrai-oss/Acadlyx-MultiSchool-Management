import { Alert, EmptyState, inputClassName } from '@acadlyx/web-ui';
import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import { CreateUserForm } from '@/components/create-user-form';
import { describeError } from '@/lib/errors';
import { roleName, SCHOOL_ROLES } from '@/lib/roles';
import { serverApi } from '@/lib/server/session';
import { loadTenant } from '@/lib/tenant';

const STATUSES = ['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'DISABLED'];

export default async function UsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ search?: string; status?: string; role?: string; page?: string }>;
}) {
  const { tenantId } = await params;
  const q = await searchParams;
  const tenant = await loadTenant(tenantId);
  const search = q.search?.trim() ?? '';
  const status = STATUSES.includes(q.status ?? '') ? q.status : undefined;
  const role = SCHOOL_ROLES.some((r) => r.key === q.role) ? q.role : undefined;
  const page = Math.max(1, Number.parseInt(q.page ?? '1', 10) || 1);

  let error: string | null = null;
  let result: Awaited<
    ReturnType<Awaited<ReturnType<typeof serverApi>>['platform']['listUsers']>
  > | null = null;
  try {
    result = await (
      await serverApi()
    ).platform.listUsers(tenant.id, {
      ...(search ? { search } : {}),
      ...(status ? { status } : {}),
      ...(role ? { role } : {}),
      page,
      pageSize: 20,
    });
  } catch (e) {
    unstable_rethrow(e);
    error = describeError(e);
  }

  return (
    <div className="flex flex-col gap-6">
      <form method="get" role="search" className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="search" className="text-sm font-medium">
            Search
          </label>
          <input
            id="search"
            name="search"
            defaultValue={search}
            placeholder="Name, email, mobile or login ID"
            maxLength={100}
            className={inputClassName}
          />
        </div>
        <div>
          <label htmlFor="status" className="text-sm font-medium">
            Status
          </label>
          <select id="status" name="status" defaultValue={status ?? ''} className={inputClassName}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="role" className="text-sm font-medium">
            Role
          </label>
          <select id="role" name="role" defaultValue={role ?? ''} className={inputClassName}>
            <option value="">All roles</option>
            {SCHOOL_ROLES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
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

      {error ? <Alert title="Could not load users">{error}</Alert> : null}
      {result && result.items.length === 0 ? (
        <EmptyState title="No users match">Create the school’s first accounts below.</EmptyState>
      ) : null}
      {result && result.items.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Name
                </th>
                <th scope="col" className="px-4 py-3">
                  Login identifiers
                </th>
                <th scope="col" className="px-4 py-3">
                  Roles
                </th>
                <th scope="col" className="px-4 py-3">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/schools/${tenant.id}/users/${u.id}`} className="hover:underline">
                      {u.displayName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {[u.email, u.phone, u.loginId].filter(Boolean).join(' · ')}
                  </td>
                  <td className="px-4 py-3 text-xs">{u.roles.map(roleName).join(', ')}</td>
                  <td className="px-4 py-3 text-xs">
                    {u.status}
                    {u.locked ? ' · locked' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-xs text-slate-500">
            {result.total} account(s) · page {result.page} of {Math.max(1, result.totalPages)}
          </p>
        </div>
      ) : null}

      <CreateUserForm tenantId={tenant.id} />
    </div>
  );
}
