'use client';

import type { TenantUserSummary } from '@acadlyx/types';
import { Alert, Badge, Button, Card, inputClassName } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { roleName, SCHOOL_ROLES } from '@/lib/roles';
import { formatDate } from '@/lib/status';

type Action = 'suspend' | 'reactivate' | 'disable' | 'reset-activation';

const ACTIONS: Record<
  Action,
  { label: string; confirm: string; allowed: (u: TenantUserSummary) => boolean }
> = {
  suspend: {
    label: 'Suspend',
    confirm: 'Suspend this account? All of its sessions end immediately.',
    allowed: (u) => u.status === 'ACTIVE',
  },
  reactivate: {
    label: 'Reactivate',
    confirm: 'Reactivate this account?',
    allowed: (u) => u.status === 'SUSPENDED',
  },
  disable: {
    label: 'Disable',
    confirm: 'Disable this account? It can no longer sign in.',
    allowed: (u) => u.status !== 'DISABLED',
  },
  'reset-activation': {
    label: 'Reset activation',
    confirm:
      'Reset activation? The password/PIN and MFA are removed and all sessions end; the user must activate again. No default password is set.',
    allowed: (u) => u.status !== 'DISABLED',
  },
};

/** One school identity: roles (built-in only), lifecycle actions, activation code for students. */
export function UserAdmin({ tenantId, user }: { tenantId: string; user: TenantUserSummary }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [addRole, setAddRole] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [activation, setActivation] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMessage(null);
    setConfirming(null);
    try {
      await fn();
      setMessage({ tone: 'success', text: ok });
      router.refresh();
    } catch (e) {
      setMessage({ tone: 'danger', text: describeError(e) });
    } finally {
      setBusy(false);
    }
  }

  const available = SCHOOL_ROLES.filter((r) => !user.roles.includes(r.key));
  const channelLess = !user.email && !user.phone;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <h1 className="text-2xl font-semibold tracking-tight">{user.displayName}</h1>
        <p className="text-sm text-slate-600">
          <Badge>{user.status}</Badge>{' '}
          {user.locked ? <Badge tone="warning">Temporarily locked</Badge> : null}{' '}
          {user.mfaEnrolled ? <Badge tone="success">MFA enrolled</Badge> : null}
        </p>
      </div>
      {message ? (
        <div className="lg:col-span-2">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      ) : null}

      <Card title="Identity">
        <dl className="grid grid-cols-2 gap-y-1">
          <dt>Email</dt>
          <dd>{user.email ?? '—'}</dd>
          <dt>Mobile</dt>
          <dd>{user.phone ?? '—'}</dd>
          <dt>Login ID</dt>
          <dd>
            {user.loginId
              ? `${user.loginId} (${user.loginIdKind === 'STUDENT_ID' ? 'student' : 'employee'})`
              : '—'}
          </dd>
          <dt>Last sign-in</dt>
          <dd>{formatDate(user.lastLoginAt)}</dd>
          <dt>Created</dt>
          <dd>{formatDate(user.createdAt)}</dd>
        </dl>
      </Card>

      <Card title="Roles">
        <ul className="mb-3 flex flex-wrap gap-2">
          {user.roles.map((r) => (
            <li key={r} className="flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs">
              {roleName(r)}
              <button
                type="button"
                aria-label={`Remove role ${roleName(r)}`}
                disabled={busy || user.roles.length === 1}
                onClick={() =>
                  void act(
                    () => api.platform.removeRole(tenantId, user.id, r),
                    `Removed ${roleName(r)}.`,
                  )
                }
                className="ml-1 text-slate-500 hover:text-red-700 disabled:opacity-30"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        {available.length > 0 ? (
          <div className="flex items-end gap-2">
            <label htmlFor="add-role" className="sr-only">
              Add role
            </label>
            <select
              id="add-role"
              value={addRole}
              onChange={(e) => {
                setAddRole(e.target.value);
              }}
              className={inputClassName}
            >
              <option value="">Add a role…</option>
              {available.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              disabled={busy || !addRole}
              onClick={() =>
                void act(
                  () => api.platform.assignRole(tenantId, user.id, addRole),
                  `Assigned ${roleName(addRole)}. Existing sessions were ended so the new policy applies.`,
                )
              }
            >
              Assign
            </Button>
          </div>
        ) : null}
      </Card>

      <Card title="Account status">
        {confirming ? (
          <div
            role="group"
            aria-label="Confirm account change"
            className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3"
          >
            <p className="text-amber-900">{ACTIONS[confirming].confirm}</p>
            <div className="flex gap-2">
              <Button
                onClick={() =>
                  void act(
                    () => api.platform.userAction(tenantId, user.id, confirming),
                    `${ACTIONS[confirming].label} done.`,
                  )
                }
              >
                Confirm
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
            {(Object.keys(ACTIONS) as Action[])
              .filter((a) => ACTIONS[a].allowed(user))
              .map((a) => (
                <Button
                  key={a}
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setConfirming(a);
                  }}
                >
                  {ACTIONS[a].label}
                </Button>
              ))}
          </div>
        )}
      </Card>

      {user.status === 'PENDING_ACTIVATION' && channelLess ? (
        <Card title="Activation code">
          <p className="mb-2">
            This account has no email or mobile. Issue a one-time activation code and give it to the
            user in person.
          </p>
          {activation ? (
            <p role="status" className="font-mono text-lg">
              {activation.code}{' '}
              <span className="block text-xs text-slate-500">
                Expires {formatDate(activation.expiresAt)} · shown once
              </span>
            </p>
          ) : (
            <Button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const issued = await api.platform.issueActivationCode(tenantId, user.id);
                  setActivation({ code: issued.activationCode, expiresAt: issued.expiresAt });
                }, 'Activation code issued.')
              }
            >
              Issue activation code
            </Button>
          )}
        </Card>
      ) : null}
    </div>
  );
}
