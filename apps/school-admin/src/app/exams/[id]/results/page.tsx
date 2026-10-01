import { ResultsPage } from '@/components/assessment/result-pages';

export const dynamic = 'force-dynamic';

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; sectionId?: string }>;
}) {
  return <ResultsPage params={params} searchParams={searchParams} />;
}
