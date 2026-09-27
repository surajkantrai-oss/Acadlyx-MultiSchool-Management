'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface SetupLink {
  href: string;
  label: string;
}

/** School Setup section navigation (only links the user may open are passed in). */
export function SetupNav({
  links,
  label = 'School setup',
}: {
  links: SetupLink[];
  label?: string;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="md:w-56 md:shrink-0">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <ul className="flex flex-wrap gap-1 md:flex-col">
        {links.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={`block rounded-md px-3 py-2 text-sm ${
                  active
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
    </nav>
  );
}
