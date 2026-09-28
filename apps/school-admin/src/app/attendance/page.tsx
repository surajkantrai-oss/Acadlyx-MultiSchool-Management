import { Badge, EmptyState } from '@acadlyx/web-ui';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { ContextBar } from '@/components/shell/context-bar';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { academicContext, contextQuery } from '@/lib/context';
import { load, setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

/**
 * Attendance home: the classes the user may take attendance for (teachers: their assigned
 * classes only — enforced by the API) with today's state per class. Dates are school-local.
 */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; branch?: string }>;
}) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('attendance.read')) return <NoAccess what="attendance" />;
  const academic = await academicContext(ctx, await searchParams);
  const list = await load(() => ctx.ops.attendanceClasses(contextQuery(academic)));
  const pending = list.ok
    ? list.data.filter((c) => !c.markedToday && c.studentCount > 0).length
    : 0;
  return (
    <>
      <Breadcrumbs items={[{ label: 'Academics' }, { label: 'Attendance' }]} />
      <PageHeader title="Attendance">
        Daily class attendance. Open a class to mark today, or pick an earlier date to review or
        correct it.
      </PageHeader>
      {academic.selectable ? (
        <ContextBar
          years={academic.years.map((y) => ({
            id: y.id,
            label: `${y.name}${y.isCurrent ? ' (current)' : ''}`,
          }))}
          branches={academic.branches.map((b) => ({ id: b.id, label: b.name }))}
          yearId={academic.year?.id ?? null}
          branchId={academic.branch?.id ?? null}
          noCurrentYear={academic.noCurrentYear}
          canConfigureYears={ctx.can('academic_year.manage')}
        />
      ) : null}
      {!list.ok ? (
        <LoadError status={list.status} />
      ) : list.data.length === 0 ? (
        <EmptyState title="No classes to show">
          {ctx.can('people.read_all')
            ? 'No classes are configured for this academic year.'
            : 'You are not assigned to any class in this academic year.'}
        </EmptyState>
      ) : (
        <>
          <p role="status" className="text-sm text-slate-600" data-testid="attendance-pending">
            {pending === 0
              ? 'Attendance has been recorded today for every class shown.'
              : `${String(pending)} class${pending === 1 ? '' : 'es'} still to mark today.`}
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm" data-testid="attendance-classes">
              <caption className="sr-only">Classes and today’s attendance state</caption>
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2">
                    Class
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Branch
                  </th>
                  <th scope="col" className="px-4 py-2 text-right">
                    Students
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Today
                  </th>
                  <th scope="col" className="px-4 py-2">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((c) => (
                  <tr key={c.sectionId} className="border-t border-slate-100">
                    <th scope="row" className="px-4 py-2 font-medium">
                      {c.sectionName}
                    </th>
                    <td className="px-4 py-2">{c.branchName}</td>
                    <td className="px-4 py-2 text-right">{c.studentCount}</td>
                    <td className="px-4 py-2">
                      {c.markedToday ? (
                        <Badge tone="success">Recorded</Badge>
                      ) : (
                        <Badge tone="warning">Not yet</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        className="underline-offset-2 hover:underline"
                        href={`/attendance/${c.sectionId}?date=${c.today}`}
                      >
                        {c.markedToday ? 'View / correct' : 'Take attendance'}
                        <span className="sr-only"> for {c.sectionName}</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
