import { GradingPage } from '@/components/assessment/result-pages';

export const dynamic = 'force-dynamic';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <GradingPage params={params} />;
}
