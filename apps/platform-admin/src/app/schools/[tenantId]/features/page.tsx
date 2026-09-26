import { FeatureToggles } from '@/components/feature-toggles';
import { api } from '@/lib/api';
import { loadTenant } from '@/lib/tenant';

export default async function FeaturesPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const tenant = await loadTenant(tenantId);
  const features = await api.platform.listFeatures(tenant.id);
  return <FeatureToggles tenantId={tenant.id} features={features} />;
}
