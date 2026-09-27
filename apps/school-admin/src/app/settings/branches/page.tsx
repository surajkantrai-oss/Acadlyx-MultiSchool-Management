import { BranchesManager } from '@/components/setup/branches-manager';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { load, setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

export default async function BranchesPage() {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('branch.read')) return <NoAccess what="branches" />;
  const [branches, settings] = await Promise.all([
    load(() => ctx.academic.branches()),
    ctx.can('academic_configuration.read')
      ? load(() => ctx.academic.settings())
      : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader title="Branches">
        Campuses of the school. One branch is always the primary branch; branches are deactivated,
        never deleted.
      </PageHeader>
      {branches.ok ? (
        <BranchesManager
          branches={branches.data}
          canManage={ctx.can('branch.manage')}
          defaultTimezone={settings?.ok ? settings.data.timezone : 'Asia/Kolkata'}
        />
      ) : (
        <LoadError status={branches.status} />
      )}
    </>
  );
}
