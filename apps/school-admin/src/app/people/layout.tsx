import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandedFrame } from '@/components/branded-frame';
import { SetupNav, type SetupLink } from '@/components/setup/setup-nav';
import { SignOutButton } from '@/components/sign-out-button';
import { TenantProblem } from '@/components/tenant-problem';
import { setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

/** People area: students, parents/guardians, teachers and bulk import (permission-filtered). */
export default async function PeopleLayout({ children }: { children: ReactNode }) {
  const ctx = await setupContext();
  if (!ctx.ok) return <TenantProblem kind={ctx.problem.problem} host={ctx.problem.host} />;
  const links: SetupLink[] = [
    ctx.can('student.read') && { href: '/people/students', label: 'Students' },
    ctx.can('parent.read') && { href: '/people/parents', label: 'Parents / guardians' },
    ctx.can('teacher.read') && { href: '/people/teachers', label: 'Teachers' },
    ctx.can('bulk_import.read') && { href: '/people/imports', label: 'Bulk import' },
  ].filter((l): l is SetupLink => Boolean(l));
  return (
    <BrandedFrame
      tenant={ctx.tenant}
      nav={
        <>
          <Link href="/" className="text-white/90 hover:text-white">
            Dashboard
          </Link>
          {ctx.can('school.read') ? (
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
      <div className="flex flex-col gap-6 md:flex-row">
        <SetupNav links={links} label="People" />
        <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
      </div>
    </BrandedFrame>
  );
}
