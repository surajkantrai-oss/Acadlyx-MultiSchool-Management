'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavGroup } from '@/lib/nav';

/** Grouped workspace navigation; the current page is marked with aria-current. */
export function SideNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const active = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <nav aria-label="Workspace" className="md:w-56 md:shrink-0 print:hidden" data-testid="side-nav">
      <div className="flex flex-wrap gap-x-6 gap-y-3 md:flex-col">
        {groups.map((group) => (
          <div key={group.label}>
            <p
              id={`nav-${group.label.replace(/\W+/g, '-').toLowerCase()}`}
              className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              {group.label}
            </p>
            <ul
              aria-labelledby={`nav-${group.label.replace(/\W+/g, '-').toLowerCase()}`}
              className="flex flex-wrap gap-1 md:flex-col"
            >
              {group.links.map((link) => {
                const on = active(link.href);
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      aria-current={on ? 'page' : undefined}
                      className={`block rounded-md px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)] ${
                        on
                          ? 'bg-white font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200'
                          : 'text-slate-600 hover:bg-white hover:text-slate-900'
                      }`}
                    >
                      {link.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
