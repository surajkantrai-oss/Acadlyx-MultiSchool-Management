import { ClassworkListPage } from '@/components/operations/classwork-pages';

export const dynamic = 'force-dynamic';

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; sectionId?: string }>;
}) {
  return <ClassworkListPage kind="homework" searchParams={searchParams} />;
}
