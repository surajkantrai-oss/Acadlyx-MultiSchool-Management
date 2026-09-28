import { PeriodsManager } from '@/components/operations/timetable-editor';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { ContextBar } from '@/components/shell/context-bar';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { academicContext } from '@/lib/context';
import { load, setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

/**
 * Bell schedule for one branch + academic year (named periods incl. breaks/lunch/assembly).
 * With "All branches" selected, the primary branch is shown — periods are branch-specific.
 */
export default async function PeriodsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; branch?: string }>;
}) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('timetable.read')) return <NoAccess what="timetables" />;
  const academic = await academicContext(ctx, await searchParams);
  const branch =
    academic.branch ?? academic.branches.find((b) => b.isPrimary) ?? academic.branches[0];
  const year = academic.year;
  const periods = branch && year ? await load(() => ctx.ops.periods(branch.id, year.id)) : null;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Academics' },
          { label: 'Timetable', href: '/timetable' },
          { label: 'Periods' },
        ]}
      />
      <PageHeader title="Periods (bell schedule)">
        Each branch has its own periods per academic year. Lessons can only be placed in lesson
        periods; breaks, lunch and assembly appear in the weekly grid as labelled rows.
      </PageHeader>
      {academic.selectable ? (
        <ContextBar
          years={academic.years.map((y) => ({
            id: y.id,
            label: `${y.name}${y.isCurrent ? ' (current)' : ''}`,
          }))}
          branches={academic.branches.map((b) => ({ id: b.id, label: b.name }))}
          yearId={year?.id ?? null}
          branchId={academic.branch?.id ?? null}
          noCurrentYear={academic.noCurrentYear}
          canConfigureYears={ctx.can('academic_year.manage')}
        />
      ) : null}
      {!branch || !year ? (
        <p className="text-sm text-slate-600">Configure a branch and an academic year first.</p>
      ) : !periods?.ok ? (
        <LoadError status={periods?.status ?? 500} />
      ) : (
        <section aria-labelledby="periods-heading" className="flex flex-col gap-3">
          <h2 id="periods-heading" className="text-lg font-semibold">
            {branch.name} · {year.name}
          </h2>
          <PeriodsManager
            branchId={branch.id}
            academicYearId={year.id}
            periods={periods.data}
            editable={ctx.can('timetable.manage') && year.status !== 'CLOSED'}
          />
        </section>
      )}
    </>
  );
}
