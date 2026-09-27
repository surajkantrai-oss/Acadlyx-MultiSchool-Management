'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { bff } from '@/lib/bff-client';

export function SignOutButton({
  all = false,
  label,
  className,
}: {
  all?: boolean;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className={className ?? 'underline disabled:opacity-50'}
      onClick={() => {
        setBusy(true);
        void bff(`/bff/auth/logout${all ? '?all=1' : ''}`).finally(() => {
          router.replace('/');
          router.refresh();
        });
      }}
    >
      {busy ? 'Signing out…' : (label ?? 'Sign out')}
    </button>
  );
}
