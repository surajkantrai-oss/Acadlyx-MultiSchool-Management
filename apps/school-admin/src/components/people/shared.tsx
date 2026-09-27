import type { ProfileAccount } from '@acadlyx/types';
import { Badge } from '@acadlyx/web-ui';
import Link from 'next/link';

export const personName = (p: {
  firstName: string;
  middleName: string | null;
  lastName: string | null;
}) => [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ');

const ACCOUNT_LABEL: Record<
  ProfileAccount['status'],
  [string, 'neutral' | 'success' | 'warning' | 'danger' | 'info']
> = {
  PENDING_ACTIVATION: ['Pending activation', 'warning'],
  ACTIVE: ['Active', 'success'],
  SUSPENDED: ['Suspended', 'danger'],
  DISABLED: ['Disabled', 'neutral'],
};

/** Login account state — a different lifecycle from the profile status. */
export function AccountBadge({ account }: { account: ProfileAccount | null }) {
  if (!account) return <Badge>No login</Badge>;
  const [label, tone] = ACCOUNT_LABEL[account.status];
  return <Badge tone={tone}>{label}</Badge>;
}

/** Accessible server-side pagination (keeps the other query parameters). */
export function Pager({
  page,
  totalPages,
  total,
  base,
  params,
}: {
  page: number;
  totalPages: number;
  total: number;
  base: string;
  params: Record<string, string | undefined>;
}) {
  const href = (p: number) => {
    const q = new URLSearchParams(
      Object.entries({ ...params, page: String(p) }).filter(([, v]) => v) as [string, string][],
    );
    return `${base}?${q.toString()}`;
  };
  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between text-sm text-slate-600"
    >
      <span>
        {total} result{total === 1 ? '' : 's'} · page {page} of {totalPages}
      </span>
      <span className="flex gap-3">
        {page > 1 ? (
          <Link className="underline" href={href(page - 1)}>
            Previous
          </Link>
        ) : null}
        {page < totalPages ? (
          <Link className="underline" href={href(page + 1)}>
            Next
          </Link>
        ) : null}
      </span>
    </nav>
  );
}

export function Dl({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-slate-500">{k}</dt>
          <dd className="text-slate-900">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
