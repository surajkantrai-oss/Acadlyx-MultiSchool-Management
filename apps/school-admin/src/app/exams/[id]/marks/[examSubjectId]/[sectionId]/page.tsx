import { MarkSheetPage } from '@/components/assessment/exam-pages';

export const dynamic = 'force-dynamic';

export default function Page({
  params,
}: {
  params: Promise<{ id: string; examSubjectId: string; sectionId: string }>;
}) {
  return <MarkSheetPage params={params} />;
}
