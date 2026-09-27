import { BrandingForm } from '@/components/branding-form';
import { loadTenant } from '@/lib/tenant';

export default async function BrandingPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const tenant = await loadTenant(tenantId);
  return (
    <BrandingForm
      tenantId={tenant.id}
      initial={tenant.branding}
      fallbackName={tenant.displayName}
    />
  );
}
