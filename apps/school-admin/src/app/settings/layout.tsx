import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { SettingsCrumbs } from '@/components/shell/settings-crumbs';
import { TenantProblem } from '@/components/tenant-problem';
import { setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

/** School Setup area inside the shared workspace shell (navigation is permission-filtered). */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const ctx = await setupContext();
  if (!ctx.ok) return <TenantProblem kind={ctx.problem.problem} host={ctx.problem.host} />;
  return (
    <AppShell tenant={ctx.tenant} can={ctx.can}>
      <SettingsCrumbs />
      {children}
    </AppShell>
  );
}
