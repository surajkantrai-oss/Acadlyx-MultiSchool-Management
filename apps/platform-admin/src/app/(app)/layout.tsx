import { APP_NAME } from '@acadlyx/constants';
import { AppShell } from '@acadlyx/web-ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SignOutButton } from '@/components/sign-out-button';
import { serverApi } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/** Authenticated Platform Admin area: every page below requires a valid platform session. */
export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const me = await (await serverApi()).auth('platform/auth').me();
  return (
    <AppShell
      productName={APP_NAME}
      area="Platform Admin"
      nav={
        <>
          <Link href="/dashboard" className="text-slate-700 hover:text-slate-950">
            Dashboard
          </Link>
          <Link href="/schools" className="text-slate-700 hover:text-slate-950">
            Schools
          </Link>
          <Link href="/account/security" className="text-slate-700 hover:text-slate-950">
            Security
          </Link>
          <span className="text-slate-500" aria-label="Signed in as">
            {me.displayName}
          </span>
          <SignOutButton />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
