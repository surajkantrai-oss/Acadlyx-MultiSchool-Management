import type { PermissionKey } from '@acadlyx/permissions';
import type { TenantBootstrap } from '@acadlyx/tenant-config';
import type { ReactNode } from 'react';
import { BrandedFrame } from '@/components/branded-frame';
import { SignOutButton } from '@/components/sign-out-button';
import { buildNav } from '@/lib/nav';
import { GlobalSearch } from './global-search';
import { SideNav } from './side-nav';

/**
 * Authenticated School Admin workspace chrome (Phase 6): tenant branding (Phase 2 BrandedFrame),
 * header search, sign out, and permission-driven grouped navigation. Pages still enforce their
 * own permission — navigation visibility is a convenience, not authorisation.
 */
export function AppShell({
  tenant,
  can,
  children,
}: {
  tenant: TenantBootstrap;
  can: (p: PermissionKey) => boolean;
  children: ReactNode;
}) {
  const searchable = (
    ['student.read', 'parent.read', 'teacher.read', 'enrollment.read'] as const
  ).some((p) => can(p));
  return (
    <BrandedFrame
      tenant={tenant}
      nav={
        <>
          {searchable ? <GlobalSearch /> : null}
          <SignOutButton className="whitespace-nowrap text-white/90 hover:text-white" />
        </>
      }
    >
      <a
        href="#workspace-main"
        className="sr-only rounded bg-white px-3 py-2 text-sm focus:not-sr-only focus:self-start"
      >
        Skip to content
      </a>
      <div className="flex flex-col gap-6 md:flex-row">
        <SideNav groups={buildNav(can)} />
        <div
          id="workspace-main"
          tabIndex={-1}
          className="flex min-w-0 flex-1 flex-col gap-6 outline-none"
        >
          {children}
        </div>
      </div>
    </BrandedFrame>
  );
}
