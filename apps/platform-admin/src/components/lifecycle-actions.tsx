'use client';

import type { TenantLifecycleAction, TenantStatus } from '@acadlyx/tenant-config';
import { Alert, Button } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';

const LABELS: Record<TenantLifecycleAction, { label: string; confirm: string }> = {
  activate: {
    label: 'Activate',
    confirm: 'Activate this school? It becomes reachable on its domains.',
  },
  suspend: {
    label: 'Suspend',
    confirm: 'Suspend this school? All school users lose access until reactivated.',
  },
  deactivate: {
    label: 'Deactivate',
    confirm: 'Deactivate this school? It will be disabled until reactivated.',
  },
  archive: {
    label: 'Archive',
    confirm: 'Archive this school permanently? Archiving cannot be undone.',
  },
};

/**
 * Lifecycle transitions are not optimistic: the UI waits for the server's confirmed state
 * (the server also re-checks the transition atomically) and then refreshes.
 */
export function LifecycleActions({
  tenantId,
  status,
  actions,
}: {
  tenantId: string;
  status: TenantStatus;
  actions: TenantLifecycleAction[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<TenantLifecycleAction | null>(null);
  const [confirming, setConfirming] = useState<TenantLifecycleAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: TenantLifecycleAction) {
    setConfirming(null);
    setError(null);
    setPending(action);
    try {
      await api.platform.transitionTenant(tenantId, action);
      router.refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p>
        Current status: <strong>{status}</strong>
        {status === 'ACTIVE'
          ? ' — school users can reach this tenant.'
          : ' — tenant routes return 403.'}
      </p>
      {error ? <Alert>{error}</Alert> : null}
      {actions.length === 0 ? (
        <p className="text-slate-500">
          Archived tenants are retained for history and cannot change status.
        </p>
      ) : confirming ? (
        <div
          role="group"
          aria-label="Confirm status change"
          className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3"
        >
          <p className="text-amber-900">{LABELS[confirming].confirm}</p>
          <div className="flex gap-2">
            <Button onClick={() => void run(confirming)}>
              Confirm {LABELS[confirming].label.toLowerCase()}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button
              key={action}
              variant={action === 'activate' ? 'primary' : 'secondary'}
              disabled={pending !== null}
              onClick={() => {
                setConfirming(action);
              }}
            >
              {pending === action ? `${LABELS[action].label}…` : LABELS[action].label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
