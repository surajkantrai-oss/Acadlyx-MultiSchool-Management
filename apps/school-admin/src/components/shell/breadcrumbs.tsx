import Link from 'next/link';

/** Breadcrumb trail; the last item is the current page (aria-current, not a link). */
export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${String(i)}`} className="flex items-center gap-1">
              {item.href && !last ? (
                <Link href={item.href} className="underline-offset-2 hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? 'page' : undefined}
                  className={last ? 'text-slate-900' : ''}
                >
                  {item.label}
                </span>
              )}
              {last ? null : <span aria-hidden="true">›</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
