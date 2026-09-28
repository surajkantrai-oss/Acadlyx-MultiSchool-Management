import { ClassworkDetailPage } from '@/components/operations/classwork-pages';

export const dynamic = 'force-dynamic';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ClassworkDetailPage kind="assignments" params={params} />;
}
