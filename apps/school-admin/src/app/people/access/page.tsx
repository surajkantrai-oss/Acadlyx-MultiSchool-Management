import type { AccessQuery, ProfileKind } from '@acadlyx/types';
import { EmptyState } from '@acadlyx/web-ui';
import Link from 'next/link';
import { AccountBadge, Pager, personName } from '@/components/people/shared';
import { SearchBox } from '@/components/people/search-box';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { load, setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

const KINDS: [ProfileKind, string][] = [
  ['students', 'Students'],
  ['parents', 'Parents / guardians'],
  ['teachers', 'Teachers'],
];
const STATES: [NonNullable<AccessQuery['state']> | '', string][] = [
  ['', 'Needs attention (any)'],
  ['NONE', 'No login'],
  ['PENDING_ACTIVATION', 'Pending activation'],
  ['SUSPENDED', 'Suspended'],
  ['DISABLED', 'Disabled'],
];

/**
 * Central "login access" list (approved decision D): profiles with no login or a login that is not
 * active. Actions (create / link / activation) stay on each profile's page — the same Phase 5
 * workflows, no duplicate identity administration and no default passwords.
 */
export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; state?: string; q?: string; page?: string }>;
}) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('people_account.manage')) return <NoAccess what="login access" />;
  const sp = await searchParams;
  const kind = KINDS.find(([k]) => k === sp.kind)?.[0] ?? 'students';
  const state = STATES.find(([s]) => s && s === sp.state)?.[0] || undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? '').slice(0, 100);
  const list = await load(() =>
    ctx.admin.access({
      kind,
      ...(state ? { state } : {}),
      ...(q ? { q } : {}),
      page,
      pageSize: 25,
    }),
  );
  const tab = (k: ProfileKind) =>
    `/people/access?${new URLSearchParams({ kind: k, ...(state ? { state } : {}) }).toString()}`;
  return (
    <>
      <Breadcrumbs items={[{ label: 'People' }, { label: 'Login access' }]} />
      <PageHeader title="Login access">
        Profiles without an active login. Many students and guardians never need one — create
        accounts only for people who will sign in.
      </PageHeader>
      <nav aria-label="Profile type" className="flex flex-wrap gap-2 text-sm">
        {KINDS.map(([k, label]) => (
          <Link
            key={k}
            href={tab(k)}
            aria-current={k === kind ? 'page' : undefined}
            className={`rounded-full px-3 py-1 ring-1 ring-slate-200 ${k === kind ? 'bg-slate-900 text-white' : 'bg-white'}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <SearchBox
        base={`/people/access`}
        q={q}
        label="Search"
        hint="Name or ID"
        hidden={{ kind }}
        status={{
          value: state ?? '',
          label: 'Login state',
          options: STATES.map(([v, l]) => ({ value: v, label: l })),
        }}
        statusName="state"
      />
      {!list.ok ? (
        <LoadError status={list.status} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title="Nothing needs attention here" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm" data-testid="access-table">
              <caption className="sr-only">Profiles without an active login</caption>
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2">
                    Name
                  </th>
                  <th scope="col" className="px-4 py-2">
                    ID
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Login
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Contact on file
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <th scope="row" className="px-4 py-2 font-medium">
                      <Link
                        href={`/people/${r.kind}/${r.id}#login-account`}
                        className="underline-offset-2 hover:underline"
                      >
                        {personName(r)}
                      </Link>
                    </th>
                    <td className="px-4 py-2 font-mono">{r.code ?? '—'}</td>
                    <td className="px-4 py-2">
                      <AccountBadge account={r.account} />
                    </td>
                    <td className="px-4 py-2">
                      {r.kind === 'students'
                        ? 'Uses a one-time activation code'
                        : [r.hasEmail && 'email', r.hasPhone && 'mobile']
                            .filter(Boolean)
                            .join(' and ') || 'None — activation code'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            page={page}
            totalPages={list.data.totalPages}
            total={list.data.total}
            base="/people/access"
            params={{ kind, state, q }}
          />
        </>
      )}
    </>
  );
}
