import { ReportCardPage } from '@/components/assessment/result-pages';

export const dynamic = 'force-dynamic';

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; studentId: string }>;
  searchParams: Promise<{ publication?: string }>;
}) {
  return <ReportCardPage params={params} searchParams={searchParams} />;
}
