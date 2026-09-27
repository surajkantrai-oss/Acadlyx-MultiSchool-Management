import { Badge, EmptyState } from '@acadlyx/web-ui';
import Link from 'next/link';
import { CreateParentForm } from '@/components/people/parents';
import { SearchBox } from '@/components/people/search-box';
import { AccountBadge, Pager, personName } from '@/components/people/shared';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { load, setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

export default async function ParentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('parent.read')) return <NoAccess what="parents" />;
  const sp = await searchParams;
  const q = (sp.q ?? '').slice(0, 100);
  const page = Math.max(1, Number(sp.page) || 1);
  const list = await load(() => ctx.people.parents({ ...(q ? { q } : {}), page, pageSize: 25 }));
  if (!list.ok) return <LoadError status={list.status} />;
  const { items, total, totalPages } = list.data;
  return (
    <>
      <PageHeader title="Parents / guardians">
        Families may share a phone number or email; the optional parent code is the unique key used
        by imports.
      </PageHeader>
      {ctx.can('parent.manage') ? <CreateParentForm /> : null}
      <SearchBox
        base="/people/parents"
        q={q}
        label="Search parents"
        hint="Name, phone, email or parent code"
      />
      {items.length === 0 ? (
        <EmptyState title={q ? 'No parents match your search' : 'No parents yet'} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm" data-testid="parents-table">
            <caption className="sr-only">Parents</caption>
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2">
                  Name
                </th>
                <th scope="col" className="px-4 py-2">
                  Code
                </th>
                <th scope="col" className="px-4 py-2">
                  Mobile
                </th>
                <th scope="col" className="px-4 py-2">
                  Children
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
              {items.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <th scope="row" className="px-4 py-2 font-medium">
                    <Link
                      className="underline-offset-2 hover:underline"
                      href={`/people/parents/${p.id}`}
                    >
                      {personName(p)}
                    </Link>
                  </th>
                  <td className="px-4 py-2 font-mono">{p.parentCode ?? '—'}</td>
                  <td className="px-4 py-2">{p.phone ?? '—'}</td>
                  <td className="px-4 py-2">{p.childrenCount}</td>
                  <td className="px-4 py-2">
                    <Badge tone={p.isActive ? 'success' : 'neutral'}>
                      {p.isActive ? 'active' : 'inactive'}
                    </Badge>
                  </td>
                  <td className="px-4 py-2">
                    <AccountBadge account={p.account} />
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
        base="/people/parents"
        params={{ q }}
      />
    </>
  );
}
