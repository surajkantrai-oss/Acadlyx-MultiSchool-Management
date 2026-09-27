import { FEATURE_REGISTRY } from '@acadlyx/tenant-config';
import { Card } from '@acadlyx/web-ui';
import Link from 'next/link';
import { BrandedFrame } from '@/components/branded-frame';
import { SchoolLogin } from '@/components/school-login';
import { SetupSummary } from '@/components/setup/setup-summary';
import { SignOutButton } from '@/components/sign-out-button';
import { TenantProblem } from '@/components/tenant-problem';
import { requireSchool } from '@/lib/school-page';
import { currentSession } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/**
 * School home. Tenant resolution first (404/403 as in Phase 2); then either the branded sign-in
 * (no session) or the authenticated shell (identity, roles, school) with the Phase 4 school-setup
 * summary for users who may read the school structure. Real counts only — no invented metrics.
 */
export default async function HomePage() {
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

  const { me } = session;
  const labels = new Map(FEATURE_REGISTRY.map((f) => [f.key as string, f.label]));
  const canSetup = me.permissions.includes('school.read');
  const setup = canSetup ? await session.api.academic.setupStatus().catch(() => null) : null;
  return (
    <BrandedFrame
      tenant={tenant}
      nav={
        <>
          {canSetup ? (
            <Link href="/settings/school" className="text-white/90 hover:text-white">
              School setup
            </Link>
          ) : null}
          <Link href="/security" className="text-white/90 hover:text-white">
            Security
          </Link>
          <SignOutButton className="text-white/90 hover:text-white" />
        </>
      }
    >
      <h1 className="text-2xl font-semibold tracking-tight">Welcome, {me.displayName}</h1>
      {setup ? <SetupSummary status={setup} /> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card title="Signed in as">
          <p data-testid="me-name">{me.displayName}</p>
          <p className="text-xs">
            {[me.identifiers.email, me.identifiers.phone, me.identifiers.loginId]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </Card>
        <Card title="Your roles">
          <ul data-testid="me-roles" className="flex flex-wrap gap-2">
            {me.roles.map((r) => (
              <li key={r} className="rounded bg-slate-100 px-2 py-0.5 text-xs">
                {r}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="School">
          <p className="font-mono" data-testid="tenant-key">
            {tenant.key}
          </p>
          <p className="text-xs">
            {tenant.enabledFeatures.map((k) => labels.get(k) ?? k).join(', ') ||
              'No modules enabled yet'}
          </p>
          <p className="mt-2 text-xs text-slate-400">
            Student, attendance and other module screens are delivered in later phases.
          </p>
        </Card>
      </div>
    </BrandedFrame>
  );
}
