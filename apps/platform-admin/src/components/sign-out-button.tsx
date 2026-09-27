'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { bffPost } from '@/lib/bff-client';

export function SignOutButton({ all = false, label }: { all?: boolean; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void bffPost(`/bff/auth/logout${all ? '?all=1' : ''}`).finally(() => {
          router.replace('/login');
          router.refresh();
        });
      }}
      className="text-slate-700 underline-offset-2 hover:text-slate-950 hover:underline disabled:opacity-50"
    >
      {busy ? 'Signing out…' : (label ?? 'Sign out')}
    </button>
  );
}
