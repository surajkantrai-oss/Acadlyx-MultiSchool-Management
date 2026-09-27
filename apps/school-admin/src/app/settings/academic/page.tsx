import { AcademicSettingsForm } from '@/components/setup/academic-settings-form';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { load, setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

export default async function AcademicSettingsPage() {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('academic_configuration.read')) return <NoAccess what="academic settings" />;
  const res = await load(() => ctx.academic.settings());
  return (
    <>
      <PageHeader title="Academic settings">
        School-wide academic behaviour used by timetables and attendance in later modules.
      </PageHeader>
      {res.ok ? (
        <AcademicSettingsForm
          settings={res.data}
          canManage={ctx.can('academic_configuration.manage')}
        />
      ) : (
        <LoadError status={res.status} />
      )}
    </>
  );
}
