import { FEATURE_REGISTRY } from '@acadlyx/tenant-config';
import { Card } from '@acadlyx/web-ui';
import Link from 'next/link';
import { LifecycleActions } from '@/components/lifecycle-actions';
import { TenantIdentityForm } from '@/components/tenant-identity-form';
import { formatDate } from '@/lib/status';
import { loadTenant } from '@/lib/tenant';

export default async function TenantOverviewPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const tenant = await loadTenant(tenantId);
  const labels = new Map(FEATURE_REGISTRY.map((f) => [f.key as string, f.label]));

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <Card title="Identity">
          <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Tenant key</dt>
            <dd className="font-mono">
              {tenant.key} <span className="text-xs text-slate-400">(immutable)</span>
            </dd>
            <dt className="text-slate-500">Created</dt>
            <dd>{formatDate(tenant.createdAt)}</dd>
            <dt className="text-slate-500">Updated</dt>
            <dd>{formatDate(tenant.updatedAt)}</dd>
            <dt className="text-slate-500">First activated</dt>
            <dd>{formatDate(tenant.firstActivatedAt)}</dd>
            {tenant.archivedAt ? (
              <>
                <dt className="text-slate-500">Archived</dt>
                <dd>{formatDate(tenant.archivedAt)}</dd>
              </>
            ) : null}
          </dl>
          <TenantIdentityForm tenant={tenant} />
        </Card>
      </div>

      <div className="flex flex-col gap-6">
        <Card title="Lifecycle">
          <LifecycleActions
            tenantId={tenant.id}
            status={tenant.status}
            actions={tenant.availableActions}
          />
        </Card>
        <Card title="Domains">
          {tenant.domains.length === 0 ? (
            <p>No domains assigned.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {tenant.domains.map((d) => (
                <li key={d.id}>
                  {d.domain}{' '}
                  <span className="text-xs text-slate-400">
                    {d.type}
                    {d.isPrimary ? ' · primary' : ''}
                    {d.verifiedAt ? ' · verified' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`/schools/${tenant.id}/domains`}
            className="mt-2 inline-block text-sm underline"
          >
            Manage domains
          </Link>
        </Card>
        <Card title="Branding">
          {tenant.branding ? (
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="h-6 w-6 rounded"
                style={{ backgroundColor: tenant.branding.primaryColor }}
              />
              <span>{tenant.branding.schoolName}</span>
            </div>
          ) : (
            <p>Not configured.</p>
          )}
          <Link
            href={`/schools/${tenant.id}/branding`}
            className="mt-2 inline-block text-sm underline"
          >
            Edit branding
          </Link>
        </Card>
        <Card title="Features">
          <p>
            {tenant.enabledFeatures.length === 0
              ? 'No features enabled.'
              : tenant.enabledFeatures.map((k) => labels.get(k) ?? k).join(', ')}
          </p>
          <Link
            href={`/schools/${tenant.id}/features`}
            className="mt-2 inline-block text-sm underline"
          >
            Manage features
          </Link>
        </Card>
        <Card title="Configuration">
          <p>{tenant.configurationOverrides} setting(s) overridden; others use defaults.</p>
          <Link
            href={`/schools/${tenant.id}/configuration`}
            className="mt-2 inline-block text-sm underline"
          >
            Edit configuration
          </Link>
        </Card>
      </div>
    </div>
  );
}
