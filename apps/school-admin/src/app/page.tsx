import { Card } from '@acadlyx/web-ui';
import Link from 'next/link';
import { BrandedFrame } from '@/components/branded-frame';
import { Dashboard } from '@/components/dashboard/dashboard';
import { SchoolLogin } from '@/components/school-login';
import { SetupSummary } from '@/components/setup/setup-summary';
import { LoadError } from '@/components/setup/states';
import { AppShell } from '@/components/shell/app-shell';
import { ContextBar } from '@/components/shell/context-bar';
import { TenantProblem } from '@/components/tenant-problem';
import { academicContext, contextQuery } from '@/lib/context';
import { requireSchool } from '@/lib/school-page';
import { currentSession } from '@/lib/server/session';
import { load, setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

/**
 * School home. Tenant resolution first (404/403 as in Phase 2); then either the branded sign-in
 * (no session) or the operational dashboard inside the workspace shell (Phase 6): academic
 * context, real counts, login access, records to review, recent imports and setup progress.
 * Blocks follow the user's permissions — no invented metrics, no later-phase modules.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; branch?: string }>;
}) {
  const tenant = await requireSchool();
  if ('problem' in tenant) return <TenantProblem kind={tenant.problem} host={tenant.host} />;
  const session = await currentSession();
  const name = tenant.branding?.schoolName ?? tenant.displayName;

  if (!session) {
    return (
      <BrandedFrame tenant={tenant}>
        <div className="mx-auto w-full max-w-sm">
          <h1 className="mb-4 text-2xl font-semibold tracking-tight">Sign in to {name}</h1>
          <SchoolLogin />
          <p className="mt-4 text-center text-sm">
            <Link href="/activate" className="underline">
              Activate your account
            </Link>{' '}
            ·{' '}
            <Link href="/recover" className="underline">
              Forgot PIN or password?
            </Link>
          </p>
        </div>
      </BrandedFrame>
    );
  }

  const ctx = await setupContext();
  if (!ctx.ok) return <TenantProblem kind={ctx.problem.problem} host={ctx.problem.host} />;
  const { me } = ctx;
  const academic = await academicContext(ctx, await searchParams);
  const query = contextQuery(academic);
  const [dashboard, setup] = await Promise.all([
    load(() => ctx.admin.dashboard(query)),
    ctx.can('school.read') ? ctx.academic.setupStatus().catch(() => null) : null,
  ]);
  const contextParams = new URLSearchParams({
    ...(academic.year ? { year: academic.year.id } : {}),
    branch: academic.branch?.id ?? 'all',
  }).toString();
  return (
    <AppShell tenant={tenant} can={ctx.can}>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">Welcome, {me.displayName}</p>
      </header>
      {academic.selectable ? (
        <ContextBar
          years={academic.years.map((y) => ({
            id: y.id,
            label: `${y.name}${y.isCurrent ? ' (current)' : ''}`,
          }))}
          branches={academic.branches.map((b) => ({
            id: b.id,
            label: `${b.name}${b.isActive ? '' : ' (inactive)'}`,
          }))}
          yearId={academic.year?.id ?? null}
          branchId={academic.branch?.id ?? null}
          noCurrentYear={academic.noCurrentYear}
          canConfigureYears={ctx.can('academic_year.manage')}
        />
      ) : null}
      {dashboard.ok ? (
        <Dashboard d={dashboard.data} contextParams={contextParams} />
      ) : (
        <LoadError status={dashboard.status} />
      )}
      {setup ? <SetupSummary status={setup} /> : null}
      <div>
        <Card title="Your account">
          <p data-testid="me-name">{me.displayName}</p>
          <ul data-testid="me-roles" className="mt-2 flex flex-wrap gap-2">
            {me.roles.map((r) => (
              <li key={r} className="rounded bg-slate-100 px-2 py-0.5 text-xs">
                {r.replace('_', ' ').toLowerCase()}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            <Link href="/security" className="underline">
              Security & sessions
            </Link>
          </p>
        </Card>
      </div>
    </AppShell>
  );
}
