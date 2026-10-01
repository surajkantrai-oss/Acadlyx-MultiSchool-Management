import { GradeScalesPage } from '@/components/assessment/exam-pages';

export const dynamic = 'force-dynamic';

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ academicYearId?: string }>;
}) {
  return <GradeScalesPage searchParams={searchParams} />;
}
