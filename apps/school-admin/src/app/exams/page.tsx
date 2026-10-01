import { ExamListPage } from '@/components/assessment/exam-pages';

export const dynamic = 'force-dynamic';

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; academicYearId?: string }>;
}) {
  return <ExamListPage searchParams={searchParams} />;
}
