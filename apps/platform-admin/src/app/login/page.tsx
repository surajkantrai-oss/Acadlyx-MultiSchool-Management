import { APP_NAME } from '@acadlyx/constants';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LoginFlow } from '@/components/login-flow';
import { apiWithToken, COOKIE } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  // Already signed in (verified against the API, not just the cookie)? Go to the dashboard.
  const token = (await cookies()).get(COOKIE.access)?.value;
  if (token) {
    const valid = await apiWithToken(token)
      .auth('platform/auth')
      .me()
      .then(
        () => true,
        () => false,
      );
    if (valid) redirect('/dashboard');
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <p className="mb-1 text-center text-sm text-slate-500">{APP_NAME}</p>
        <h1 className="mb-6 text-center text-2xl font-semibold tracking-tight">
          Platform Admin sign in
        </h1>
        <LoginFlow />
      </div>
    </main>
  );
}
