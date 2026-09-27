import { SchoolProfileForm } from '@/components/setup/school-profile-form';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { load, setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

export default async function SchoolProfilePage() {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('school.read')) return <NoAccess what="the school profile" />;
  const res = await load(() => ctx.academic.school());
  return (
    <>
      <PageHeader title="School profile">
        Academic and contact identity of the school. Logo, colours and domains are managed as
        white-label branding by Acadlyx.
      </PageHeader>
      {res.ok ? (
        <SchoolProfileForm school={res.data} canManage={ctx.can('school.manage')} />
      ) : (
        <LoadError status={res.status} />
      )}
    </>
  );
}
