import type { PeopleCounts } from '@acadlyx/types';
import { Card } from '@acadlyx/web-ui';
import Link from 'next/link';

/** Real people counts (no attendance/fee/exam metrics — those modules come later). */
export function PeopleSummary({ counts }: { counts: PeopleCounts }) {
  const tiles: [string, number, string][] = [
    ['Active students', counts.activeStudents, '/people/students?status=ACTIVE'],
    ['Parents', counts.parents, '/people/parents'],
    ['Guardian links', counts.guardianLinks, '/people/parents'],
    ['Active teachers', counts.activeTeachers, '/people/teachers?status=ACTIVE'],
    ['Pending imports', counts.pendingImports, '/people/imports'],
  ];
  return (
    <section aria-labelledby="people-heading" data-testid="people-summary">
      <Card title="People">
        <h2 id="people-heading" className="sr-only">
          People
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {tiles.map(([label, value, href]) => (
            <div key={label} className="rounded-md bg-slate-50 p-3">
              <dt className="text-xs text-slate-500">
                <Link href={href} className="underline-offset-2 hover:underline">
                  {label}
                </Link>
              </dt>
              <dd className="text-xl font-semibold text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </section>
  );
}
