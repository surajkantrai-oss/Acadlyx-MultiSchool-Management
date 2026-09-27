import { AccountSecurity } from '@/components/account-security';
import { serverApi } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

export default async function SecurityPage() {
  const auth = (await serverApi()).auth('platform/auth');
  const [me, sessions, devices] = await Promise.all([auth.me(), auth.sessions(), auth.devices()]);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Account security</h1>
      <AccountSecurity me={me} sessions={sessions} devices={devices} />
    </div>
  );
}
