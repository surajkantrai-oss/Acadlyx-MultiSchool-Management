import { Badge, EmptyState } from '@acadlyx/web-ui';
import Link from 'next/link';
import { SearchBox } from '@/components/people/search-box';
import {
  ACCOUNT_FILTER_OPTIONS,
  accountFilter,
  AccountBadge,
  Pager,
  personName,
} from '@/components/people/shared';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { CreateTeacherForm } from '@/components/people/teachers';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { load, setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

export default async function TeachersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;
    status?: string;
    account?: string;
    quality?: string;
  }>;
}) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('teacher.read')) return <NoAccess what="teachers" />;
  const sp = await searchParams;
  const q = (sp.q ?? '').slice(0, 100);
  const status = sp.status === 'ACTIVE' || sp.status === 'INACTIVE' ? sp.status : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const account = accountFilter(sp.account);
  const quality = sp.quality === 'NO_ASSIGNMENT' ? sp.quality : undefined;
  const list = await load(() =>
    ctx.people.teachers({
      ...(q ? { q } : {}),
      ...(status ? { status } : {}),
      ...(account ? { account } : {}),
      ...(quality ? { quality } : {}),
      page,
      pageSize: 25,
    }),
  );
  if (!list.ok) return <LoadError status={list.status} />;
  const { items, total, totalPages } = list.data;
  return (
    <>
      <Breadcrumbs items={[{ label: 'People' }, { label: 'Teachers' }]} />
      <PageHeader title="Teachers">
        Teacher profiles and their class/subject assignments. No HR or payroll data.
      </PageHeader>
      {ctx.can('teacher.manage') ? <CreateTeacherForm /> : null}
      <SearchBox
        base="/people/teachers"
        q={q}
        label="Search teachers"
        hint="Name, employee ID or email"
        status={{
          value: status ?? '',
          options: [
            { value: '', label: 'Any' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'INACTIVE', label: 'Inactive' },
          ],
        }}
        filters={[
          {
            name: 'account',
            label: 'Login',
            value: account ?? '',
            options: ACCOUNT_FILTER_OPTIONS,
          },
          {
            name: 'quality',
            label: 'Classes',
            value: quality ?? '',
            options: [
              { value: '', label: 'Any' },
              { value: 'NO_ASSIGNMENT', label: 'No current class' },
            ],
          },
        ]}
      />
      {items.length === 0 ? (
        <EmptyState
          title={
            q || status || account || quality ? 'No teachers match your search' : 'No teachers yet'
          }
        >
          {!(q || status || account || quality) && ctx.can('teacher.manage') ? (
            <>
              Add a teacher above
              {ctx.can('bulk_import.manage') ? (
                <>
                  {' '}
                  or{' '}
                  <Link className="underline" href="/people/imports">
                    import a CSV/XLSX file
                  </Link>
                </>
              ) : null}
              .
            </>
          ) : null}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm" data-testid="teachers-table">
            <caption className="sr-only">Teachers</caption>
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2">
                  Name
                </th>
                <th scope="col" className="px-4 py-2">
                  Employee ID
                </th>
                <th scope="col" className="px-4 py-2">
                  Email
                </th>
                <th scope="col" className="px-4 py-2">
                  Assignments
                </th>
                <th scope="col" className="px-4 py-2">
                  Status
                </th>
                <th scope="col" className="px-4 py-2">
                  Login
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} className="border-t border-slate-100">
                  <th scope="row" className="px-4 py-2 font-medium">
                    <Link
                      className="underline-offset-2 hover:underline"
                      href={`/people/teachers/${t.id}`}
                    >
                      {personName(t)}
                    </Link>
                  </th>
                  <td className="px-4 py-2 font-mono">{t.employeeId}</td>
                  <td className="px-4 py-2">{t.email ?? '—'}</td>
                  <td className="px-4 py-2">{t.activeAssignments}</td>
                  <td className="px-4 py-2">
                    <Badge tone={t.status === 'ACTIVE' ? 'success' : 'neutral'}>
                      {t.status.toLowerCase()}
                    </Badge>
                  </td>
                  <td className="px-4 py-2">
                    <AccountBadge account={t.account} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager
        page={page}
        totalPages={totalPages}
        total={total}
        base="/people/teachers"
        params={{ q, status, account, quality }}
      />
    </>
  );
}
