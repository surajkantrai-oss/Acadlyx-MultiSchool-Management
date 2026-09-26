import { DomainManager } from '@/components/domain-manager';
import { loadTenant } from '@/lib/tenant';

export default async function DomainsPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const tenant = await loadTenant(tenantId);
  return <DomainManager tenantId={tenant.id} domains={tenant.domains} />;
}
