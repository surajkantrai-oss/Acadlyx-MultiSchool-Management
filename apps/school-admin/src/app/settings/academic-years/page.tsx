import { AcademicYearsManager } from '@/components/setup/academic-years-manager';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { load, setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

export default async function AcademicYearsPage() {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('academic_year.read')) return <NoAccess what="academic years" />;
  const [years, settings] = await Promise.all([
    load(() => ctx.academic.academicYears()),
    ctx.can('academic_configuration.read')
      ? load(() => ctx.academic.settings())
      : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader title="Academic years">
        Planned → Active → Closed. Exactly one active year is current. Dates can only change while a
        year is planned, and years never overlap.
      </PageHeader>
      {years.ok ? (
        <AcademicYearsManager
          years={years.data}
          canManage={ctx.can('academic_year.manage')}
          startMonth={settings?.ok ? settings.data.academicYearStartMonth : 4}
        />
      ) : (
        <LoadError status={years.status} />
      )}
    </>
  );
}
