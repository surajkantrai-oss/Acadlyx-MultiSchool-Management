import { ConfigurationEditor } from '@/components/configuration-editor';
import { serverApi } from '@/lib/server/session';
import { loadTenant } from '@/lib/tenant';

export default async function ConfigurationPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const tenant = await loadTenant(tenantId);
  const entries = await (await serverApi()).platform.listConfiguration(tenant.id);
  return <ConfigurationEditor tenantId={tenant.id} entries={entries} />;
}
