'use client';

import type { DeviceInfo, MeResponse, SessionInfo } from '@acadlyx/types';
import { Alert, Badge, Button, Card, Field, inputClassName } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { SignOutButton } from '@/components/sign-out-button';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { formatDate } from '@/lib/status';

/**
 * Self-service security for the signed-in Platform Admin: sessions, devices, MFA state,
 * recovery codes and password change. Never shows hashes, secrets or tokens.
 */
export function AccountSecurity({
  me,
  sessions,
  devices,
}: {
  me: MeResponse;
  sessions: SessionInfo[];
  devices: DeviceInfo[];
}) {
  const router = useRouter();
  const auth = api.auth('platform/auth');
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMessage(null);
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

  async function onPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const form = e.currentTarget;
    if (data.next !== data.confirm) {
      setMessage({ tone: 'danger', text: 'The new passwords do not match' });
      return;
    }
    await act(
      () => auth.changeCredential(data.current ?? '', 'PASSWORD', data.next ?? ''),
      'Password changed. Other sessions were signed out.',
    );
    form.reset();
  }

  async function onRegenerate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code') ?? '');
    await act(
      async () => setCodes((await auth.regenerateRecoveryCodes(code)).recoveryCodes),
      'New recovery codes generated. Previous codes no longer work.',
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {message ? (
        <div className="lg:col-span-2">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      ) : null}

      <Card title="Two-factor authentication">
        <p className="mb-3">
          Status:{' '}
          <Badge tone={me.mfa.enrolled ? 'success' : 'warning'}>
            {me.mfa.enrolled ? 'Authenticator active' : 'Not enrolled'}
          </Badge>{' '}
          <span className="text-xs text-slate-500">
            Required for Platform Admin · {me.mfa.recoveryCodesRemaining} recovery codes left
          </span>
        </p>
        {codes ? (
          <div className="mb-3">
            <p className="mb-1 font-medium">Save these codes now — they will not be shown again:</p>
            <ul className="grid grid-cols-2 gap-1 font-mono" aria-label="New recovery codes">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <form
          onSubmit={(e) => void onRegenerate(e)}
          className="flex items-end gap-2"
          aria-label="Regenerate recovery codes"
        >
          <Field id="regen-code" label="Authenticator code">
            <input
              id="regen-code"
              name="code"
              required
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              className={`${inputClassName} w-32 font-mono`}
            />
          </Field>
          <Button type="submit" variant="secondary" disabled={busy}>
            Regenerate recovery codes
          </Button>
        </form>
      </Card>

      <Card title="Change password">
        <form
          onSubmit={(e) => void onPassword(e)}
          className="flex flex-col gap-3"
          aria-label="Change password"
        >
          <Field id="current" label="Current password">
            <input
              id="current"
              name="current"
              type="password"
              autoComplete="current-password"
              required
              className={inputClassName}
            />
          </Field>
          <Field id="next" label="New password" hint="At least 12 characters.">
            <input
              id="next"
              name="next"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              className={inputClassName}
            />
          </Field>
          <Field id="confirm" label="Confirm new password">
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              className={inputClassName}
            />
          </Field>
          <div>
            <Button type="submit" disabled={busy}>
              Change password
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Active sessions">
        <ul className="flex flex-col divide-y divide-slate-100">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                {s.device?.label ?? s.userAgent ?? 'Unknown device'}{' '}
                {s.current ? <Badge tone="info">This session</Badge> : null}
                <span className="block text-xs text-slate-500">
                  Last active {formatDate(s.lastActiveAt)} · {s.ipAddress ?? 'unknown IP'}
                </span>
              </span>
              {!s.current ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void act(() => auth.revokeSession(s.id), 'Session revoked.')}
                >
                  Revoke
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-4">
          <SignOutButton all label="Sign out everywhere" />
        </div>
      </Card>

      <Card title="Devices">
        {devices.length === 0 ? <p>No registered devices.</p> : null}
        <ul className="flex flex-col divide-y divide-slate-100">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                {d.label ?? d.platform}
                <span className="block text-xs text-slate-500">
                  First seen {formatDate(d.firstSeenAt)} · {d.activeSessions} active session(s)
                </span>
              </span>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void act(() => auth.revokeDevice(d.id), 'Device removed and its sessions ended.')
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
