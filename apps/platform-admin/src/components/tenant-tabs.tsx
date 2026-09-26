'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '', label: 'Overview' },
  { href: '/branding', label: 'Branding' },
  { href: '/domains', label: 'Domains' },
  { href: '/features', label: 'Features' },
  { href: '/configuration', label: 'Configuration' },
];

export function TenantTabs({ tenantId }: { tenantId: string }) {
  const pathname = usePathname();
  const base = `/schools/${tenantId}`;
  return (
    <nav
      aria-label="School sections"
      className="flex gap-1 overflow-x-auto border-b border-slate-200"
    >
      {TABS.map((tab) => {
        const href = `${base}${tab.href}`;
        const active = pathname === href;
        return (
          <Link
            key={tab.label}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
              active
                ? 'border-slate-900 font-medium text-slate-900'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
