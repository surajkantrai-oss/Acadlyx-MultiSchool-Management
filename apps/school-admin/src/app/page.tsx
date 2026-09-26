import { APP_NAME } from '@acadlyx/constants';
import { FEATURE_REGISTRY } from '@acadlyx/tenant-config';
import { Card } from '@acadlyx/web-ui';
import { forbidden, notFound } from 'next/navigation';
import { TenantProblem } from '@/components/tenant-problem';
import { loadCurrentTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const result = await loadCurrentTenant();

  // Real HTTP semantics: unknown school → 404, known but unavailable school → 403.
  if (result.kind === 'not-found') notFound();
  if (result.kind === 'unavailable') forbidden();
  if (result.kind !== 'ok') return <TenantProblem kind={result.kind} host={result.host} />;

  const { tenant } = result;
  const labels = new Map(FEATURE_REGISTRY.map((f) => [f.key as string, f.label]));
  const name = tenant.branding?.schoolName ?? tenant.displayName;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="text-white" style={{ backgroundColor: 'var(--brand-primary)' }}>
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4">
          {tenant.branding?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- tenant logos are arbitrary external https URLs
            <img
              src={tenant.branding.logoUrl}
              alt=""
              className="h-8 w-8 rounded bg-white object-contain"
            />
          ) : null}
          <span className="text-lg font-semibold tracking-tight" data-testid="school-name">
            {name}
          </span>
          <span className="rounded bg-white/20 px-2 py-0.5 text-sm">School Admin</span>
        </div>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to {name}</h1>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card title="Your school">
            <dl className="grid grid-cols-2 gap-y-1">
              <dt>School key</dt>
              <dd className="font-mono" data-testid="tenant-key">
                {tenant.key}
              </dd>
              <dt>Time zone</dt>
              <dd>{String(tenant.settings['general.timezone'] ?? '—')}</dd>
            </dl>
          </Card>
          <Card title="Enabled modules">
            {tenant.enabledFeatures.length === 0 ? (
              <p>No modules enabled yet.</p>
            ) : (
              <ul className="flex flex-wrap gap-2" data-testid="enabled-features">
                {tenant.enabledFeatures.map((key) => (
                  <li
                    key={key}
                    className="rounded px-2 py-0.5 text-xs text-white"
                    style={{ backgroundColor: 'var(--brand-accent)' }}
                  >
                    {labels.get(key) ?? key}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-slate-400">
              Module screens are delivered in later phases.
            </p>
          </Card>
        </div>
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-slate-500">
        {tenant.branding?.footerText ?? `${name} · Powered by ${APP_NAME}`}
        {tenant.branding?.supportEmail ? ` · ${tenant.branding.supportEmail}` : ''}
      </footer>
    </div>
  );
}
