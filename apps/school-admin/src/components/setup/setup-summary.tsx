import type { SchoolSetupStatus } from '@acadlyx/types';
import { Card } from '@acadlyx/web-ui';
import Link from 'next/link';

const CHECKS: [keyof SchoolSetupStatus['checklist'], string, string][] = [
  ['schoolProfile', 'School profile (board and contact)', '/settings/school'],
  ['primaryBranch', 'Primary branch', '/settings/branches'],
  ['currentAcademicYear', 'Current academic year', '/settings/academic-years'],
  ['grades', 'Grades', '/settings/grades'],
  ['sections', 'Sections', '/settings/grades'],
  ['subjects', 'Subjects', '/settings/subjects'],
];

/** School structure summary + setup checklist (informational; never blocks access). */
export function SetupSummary({ status }: { status: SchoolSetupStatus }) {
  const c = status.counts;
  const done = CHECKS.filter(([k]) => status.checklist[k]).length;
  const tiles: [string, number][] = [
    ['Branches', c.activeBranches],
    ['Academic years', c.academicYears],
    ['Grades', c.grades],
    ['Sections', c.sections],
    ['Subjects', c.subjects],
  ];
  return (
    <section
      aria-labelledby="setup-heading"
      className="grid gap-4 lg:grid-cols-3"
      data-testid="setup-summary"
    >
      <div className="lg:col-span-2">
        <Card title="School structure">
          <h2 id="setup-heading" className="sr-only">
            School structure
          </h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {tiles.map(([label, value]) => (
              <div key={label} className="rounded-md bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="text-xl font-semibold text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm">
            Current academic year: <strong>{status.currentAcademicYear?.name ?? 'not set'}</strong>
          </p>
        </Card>
      </div>
      <Card title={`Setup progress (${String(done)}/${String(CHECKS.length)})`}>
        <ul className="flex flex-col gap-1">
          {CHECKS.map(([key, label, href]) => (
            <li key={key} className="flex items-center gap-2">
              <span aria-hidden="true">{status.checklist[key] ? '✓' : '○'}</span>
              <Link href={href} className="underline-offset-2 hover:underline">
                {label}
              </Link>
              <span className="sr-only">{status.checklist[key] ? 'done' : 'not done'}</span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
