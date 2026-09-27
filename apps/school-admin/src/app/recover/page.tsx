import Link from 'next/link';
import { BrandedFrame } from '@/components/branded-frame';
import { OtpFlow } from '@/components/otp-flow';
import { TenantProblem } from '@/components/tenant-problem';
import { requireSchool } from '@/lib/school-page';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const tenant = await requireSchool();
  if ('problem' in tenant) return <TenantProblem kind={tenant.problem} host={tenant.host} />;
  return (
    <BrandedFrame tenant={tenant}>
      <div className="mx-auto w-full max-w-sm">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">Reset your PIN or password</h1>
        <OtpFlow flow="recovery" />
        <p className="mt-4 text-center text-sm">
          <Link href="/" className="underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </BrandedFrame>
  );
}
