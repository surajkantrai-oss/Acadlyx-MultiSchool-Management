import { APP_NAME } from '@acadlyx/constants';
import { HEX_COLOR_PATTERN } from '@acadlyx/validation';
import type { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import { loadCurrentTenant } from '@/lib/tenant';
import './globals.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const result = await loadCurrentTenant();
  const name = result.kind === 'ok' ? result.tenant.displayName : APP_NAME;
  const favicon = result.kind === 'ok' ? result.tenant.branding?.faviconUrl : null;
  return {
    title: `${name} · School Admin`,
    description: 'School administration portal',
    robots: { index: false, follow: false },
    ...(favicon ? { icons: { icon: favicon } } : {}),
  };
}

/** Only validated hex colours ever reach CSS — branding cannot inject arbitrary styles. */
function safeColor(value: string | null | undefined, fallback: string): string {
  return value && HEX_COLOR_PATTERN.test(value) ? value : fallback;
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const result = await loadCurrentTenant();
  const branding = result.kind === 'ok' ? result.tenant.branding : null;
  const primary = safeColor(branding?.primaryColor, '#0F172A');
  const style = {
    '--brand-primary': primary,
    '--brand-accent': safeColor(branding?.accentColor, primary),
  } as CSSProperties;

  return (
    <html lang="en">
      <body className="antialiased" style={style}>
        {children}
      </body>
    </html>
  );
}
