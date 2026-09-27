import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BrandedFrame } from '@/components/branded-frame';
import { SchoolSecurity } from '@/components/school-security';
import { SignOutButton } from '@/components/sign-out-button';
import { TenantProblem } from '@/components/tenant-problem';
import { requireSchool } from '@/lib/school-page';
import { currentSession } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

export default async function SecurityPage() {
  const tenant = await requireSchool();
  if ('problem' in tenant) return <TenantProblem kind={tenant.problem} host={tenant.host} />;
  const session = await currentSession();
  if (!session) redirect('/');
  const auth = session.api.auth('auth');
  const [sessions, devices] = await Promise.all([auth.sessions(), auth.devices()]);
  return (
    <BrandedFrame
      tenant={tenant}
      nav={
        <>
          <Link href="/" className="text-white/90 hover:text-white">
            Home
          </Link>
          <SignOutButton className="text-white/90 hover:text-white" />
        </>
      }
    >
      <h1 className="text-2xl font-semibold tracking-tight">Account security</h1>
      <SchoolSecurity me={session.me} sessions={sessions} devices={devices} />
    </BrandedFrame>
  );
}
