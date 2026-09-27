import Link from 'next/link';
import type { ReactNode } from 'react';
import { StatusBadge } from '@/components/status-badge';
import { TenantTabs } from '@/components/tenant-tabs';
import { loadTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export default async function TenantLayout({
  params,
  children,
}: {
  params: Promise<{ tenantId: string }>;
  children: ReactNode;
}) {
  const { tenantId } = await params;
  const tenant = await loadTenant(tenantId);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/schools" className="text-sm text-slate-500 hover:underline">
          ← Schools
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{tenant.displayName}</h1>
          <StatusBadge status={tenant.status} />
          <span className="font-mono text-xs text-slate-500">{tenant.key}</span>
        </div>
      </div>
      <TenantTabs tenantId={tenant.id} />
      {children}
    </div>
  );
}
