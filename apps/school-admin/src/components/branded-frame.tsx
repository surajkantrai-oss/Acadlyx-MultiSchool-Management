import { APP_NAME } from '@acadlyx/constants';
import type { TenantBootstrap } from '@acadlyx/tenant-config';
import type { ReactNode } from 'react';

/** School-branded page chrome (logo, name, colours from the Phase 2 tenant bootstrap). */
export function BrandedFrame({
  tenant,
  nav,
  children,
}: {
  tenant: TenantBootstrap;
  nav?: ReactNode;
  children: ReactNode;
}) {
  const name = tenant.branding?.schoolName ?? tenant.displayName;
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 print:bg-white">
      <header
        className="text-white print:hidden"
        style={{ backgroundColor: 'var(--brand-primary)' }}
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4">
          {tenant.branding?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- tenant logos are arbitrary external https URLs
            <img
              src={tenant.branding.logoUrl}
              alt=""
              className="h-8 w-8 rounded bg-white object-contain"
            />
          ) : null}
          <span className="text-lg font-semibold tracking-tight" data-testid="school-name">
            {name}
          </span>
          <span className="rounded bg-white/20 px-2 py-0.5 text-sm">School Admin</span>
          {nav ? (
            <nav aria-label="Main" className="ml-auto flex items-center gap-4 text-sm">
              {nav}
            </nav>
          ) : null}
        </div>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 print:max-w-none print:p-0">
        {children}
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-slate-500 print:hidden">
        {tenant.branding?.footerText ?? `${name} · Powered by ${APP_NAME}`}
        {tenant.branding?.supportEmail ? ` · ${tenant.branding.supportEmail}` : ''}
      </footer>
    </div>
  );
}
