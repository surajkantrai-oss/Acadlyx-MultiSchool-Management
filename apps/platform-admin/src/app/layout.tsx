import { APP_NAME } from '@acadlyx/constants';
import { AppShell } from '@acadlyx/web-ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: `${APP_NAME} Platform Admin`,
  description: 'Internal Acadlyx portal for managing tenants/schools.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
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
            </>
          }
        >
          <p className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Development surface: Platform Admin authentication arrives in Phase 3. Do not expose
            this portal publicly.
          </p>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
