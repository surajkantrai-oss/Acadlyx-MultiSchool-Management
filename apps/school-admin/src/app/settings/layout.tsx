import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandedFrame } from '@/components/branded-frame';
import { SetupNav, type SetupLink } from '@/components/setup/setup-nav';
import { SignOutButton } from '@/components/sign-out-button';
import { TenantProblem } from '@/components/tenant-problem';
import { setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

/** School Setup area: branded frame + section navigation limited to what the user may read. */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const ctx = await setupContext();
  if (!ctx.ok) return <TenantProblem kind={ctx.problem.problem} host={ctx.problem.host} />;
  const links: SetupLink[] = [
    ctx.can('school.read') && { href: '/settings/school', label: 'School profile' },
    ctx.can('branch.read') && { href: '/settings/branches', label: 'Branches' },
    ctx.can('academic_year.read') && { href: '/settings/academic-years', label: 'Academic years' },
    ctx.can('grade.read') && { href: '/settings/grades', label: 'Grades & sections' },
    ctx.can('subject.read') && { href: '/settings/subjects', label: 'Subjects' },
    ctx.can('academic_configuration.read') && {
      href: '/settings/academic',
      label: 'Academic settings',
    },
  ].filter((l): l is SetupLink => Boolean(l));
  return (
    <BrandedFrame
      tenant={ctx.tenant}
      nav={
        <>
          <Link href="/" className="text-white/90 hover:text-white">
            Dashboard
          </Link>
          <Link href="/security" className="text-white/90 hover:text-white">
            Security
          </Link>
          <SignOutButton className="text-white/90 hover:text-white" />
        </>
      }
    >
      <div className="flex flex-col gap-6 md:flex-row">
        <SetupNav links={links} />
        <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
      </div>
    </BrandedFrame>
  );
}
