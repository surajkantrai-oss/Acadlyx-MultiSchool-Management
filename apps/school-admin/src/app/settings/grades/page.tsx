import type { Section } from '@acadlyx/types';
import { GradesManager } from '@/components/setup/grades-manager';
import { SectionsManager } from '@/components/setup/sections-manager';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { load, setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

export default async function GradesPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; year?: string }>;
}) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('grade.read')) return <NoAccess what="grades and sections" />;
  const params = await searchParams;
  const grades = await load(() => ctx.academic.grades());
  if (!grades.ok) return <LoadError status={grades.status} />;

  const canSections =
    ctx.can('section.read') && ctx.can('branch.read') && ctx.can('academic_year.read');
  let sectionsView: React.ReactNode = null;
  if (canSections) {
    const [branches, years] = await Promise.all([
      load(() => ctx.academic.branches()),
      load(() => ctx.academic.academicYears()),
    ]);
    if (!branches.ok || !years.ok) {
      sectionsView = (
        <LoadError status={branches.ok ? (years.ok ? 500 : years.status) : branches.status} />
      );
    } else {
      const branch =
        branches.data.find((b) => b.id === params.branch) ??
        branches.data.find((b) => b.isPrimary) ??
        branches.data[0];
      const year =
        years.data.find((y) => y.id === params.year) ??
        years.data.find((y) => y.isCurrent) ??
        years.data[0];
      const sections =
        branch && year
          ? await load(() =>
              ctx.academic.sections({ branchId: branch.id, academicYearId: year.id }),
            )
          : { ok: true as const, data: [] as Section[] };
      sectionsView = sections.ok ? (
        <SectionsManager
          grades={grades.data}
          branches={branches.data}
          years={years.data}
          branchId={branch?.id ?? null}
          yearId={year?.id ?? null}
          sections={sections.data}
          canManage={ctx.can('section.manage')}
        />
      ) : (
        <LoadError status={sections.status} />
      );
    }
  }

  return (
    <>
      <PageHeader title="Grades & sections">
        Grades are the school’s permanent class list in explicit order. Sections belong to a grade
        at one branch for one academic year.
      </PageHeader>
      <GradesManager grades={grades.data} canManage={ctx.can('grade.manage')} />
      {sectionsView}
    </>
  );
}
