import { redirect } from 'next/navigation';
import { SchoolSecurity } from '@/components/school-security';
import { AppShell } from '@/components/shell/app-shell';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { TenantProblem } from '@/components/tenant-problem';
import { setupContext } from '@/lib/setup';
import { currentSession } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

export default async function SecurityPage() {
  const ctx = await setupContext();
  if (!ctx.ok) return <TenantProblem kind={ctx.problem.problem} host={ctx.problem.host} />;
  const session = await currentSession();
  if (!session) redirect('/');
  const auth = session.api.auth('auth');
  const [sessions, devices] = await Promise.all([auth.sessions(), auth.devices()]);
  return (
    <AppShell tenant={ctx.tenant} can={ctx.can}>
      <Breadcrumbs items={[{ label: 'Account' }, { label: 'Security & sessions' }]} />
      <h1 className="text-2xl font-semibold tracking-tight">Account security</h1>
      <SchoolSecurity me={session.me} sessions={sessions} devices={devices} />
    </AppShell>
  );
}
