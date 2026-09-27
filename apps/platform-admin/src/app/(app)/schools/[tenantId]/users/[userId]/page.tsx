import { ApiError } from '@acadlyx/api-client';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { UserAdmin } from '@/components/user-admin';
import { serverApi } from '@/lib/server/session';
import { loadTenant } from '@/lib/tenant';

export default async function UserPage({
  params,
}: {
  params: Promise<{ tenantId: string; userId: string }>;
}) {
  const { tenantId, userId } = await params;
  const tenant = await loadTenant(tenantId);
  const user = await (await serverApi()).platform.getUser(tenant.id, userId).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  });
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/schools/${tenant.id}/users`} className="text-sm text-slate-500 hover:underline">
        ← Users
      </Link>
      <UserAdmin tenantId={tenant.id} user={user} />
    </div>
  );
}
