import { FeatureToggles } from '@/components/feature-toggles';
import { serverApi } from '@/lib/server/session';
import { loadTenant } from '@/lib/tenant';

export default async function FeaturesPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const tenant = await loadTenant(tenantId);
  const features = await (await serverApi()).platform.listFeatures(tenant.id);
  return <FeatureToggles tenantId={tenant.id} features={features} />;
}
