import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { notFound } from 'next/navigation';
import { ParentDetailView } from '@/components/people/parents';
import { personName } from '@/components/people/shared';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { load, setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

export default async function ParentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('parent.read')) return <NoAccess what="parents" />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const parent = await load(() => ctx.people.parent(id));
  if (!parent.ok) {
    if (parent.status === 404) notFound();
    return <LoadError status={parent.status} />;
  }
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'People' },
          { label: 'Parents / guardians', href: '/people/parents' },
          { label: personName(parent.data) },
        ]}
      />
      <PageHeader title={personName(parent.data)} />
      <ParentDetailView
        parent={parent.data}
        can={{
          manage: ctx.can('parent.manage'),
          accounts: ctx.can('people_account.manage'),
          students: ctx.can('student.read'),
        }}
      />
    </>
  );
}
