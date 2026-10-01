import { ExamDetailPage } from '@/components/assessment/exam-pages';

export const dynamic = 'force-dynamic';

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  return <ExamDetailPage params={params} searchParams={searchParams} />;
}
