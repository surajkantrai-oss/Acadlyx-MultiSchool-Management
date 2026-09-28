import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { TenantProblem } from '@/components/tenant-problem';
import { setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

/** Homework area inside the shared workspace shell (navigation is permission-filtered). */
export default async function Layout({ children }: { children: ReactNode }) {
  const ctx = await setupContext();
  if (!ctx.ok) return <TenantProblem kind={ctx.problem.problem} host={ctx.problem.host} />;
  return (
    <AppShell tenant={ctx.tenant} can={ctx.can}>
      {children}
    </AppShell>
  );
}
