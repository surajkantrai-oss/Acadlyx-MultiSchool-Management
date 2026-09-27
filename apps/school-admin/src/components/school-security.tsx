'use client';

import type { DeviceInfo, MeResponse, SessionInfo } from '@acadlyx/types';
import { Alert, Badge, Button, Card, Field, inputClassName } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { bff } from '@/lib/bff-client';
import { MfaEnrollment } from './mfa-steps';
import { SignOutButton } from './sign-out-button';

const when = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

/** Self-service security for a school user. Never shows hashes, secrets or tokens. */
export function SchoolSecurity({
  me,
  sessions,
  devices,
}: {
  me: MeResponse;
  sessions: SessionInfo[];
  devices: DeviceInfo[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<'PASSWORD' | 'PIN'>(me.credentialType ?? 'PASSWORD');

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: 'success', text: ok });
      router.refresh();
    } catch (e) {
      setMessage({ tone: 'danger', text: e instanceof Error ? e.message : 'Something went wrong' });
    } finally {
      setBusy(false);
    }
  }
  const fields = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    return Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {message ? (
        <div className="lg:col-span-2">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      ) : null}

      <Card title="Two-factor authentication">
        <p className="mb-3">
          <Badge tone={me.mfa.enrolled ? 'success' : 'neutral'}>
            {me.mfa.enrolled ? 'Authenticator active' : 'Not enrolled'}
          </Badge>{' '}
          <span className="text-xs text-slate-500">
            {me.mfa.required ? 'Required for your role' : 'Optional'}
            {me.mfa.enrolled
              ? ` · ${String(me.mfa.recoveryCodesRemaining)} recovery codes left`
              : ''}
          </span>
        </p>
        {!me.mfa.enrolled ? (
          enrolling ? (
            <MfaEnrollment
              intro="Set up an authenticator app."
              onDone={() => {
                setEnrolling(false);
                router.refresh();
              }}
            />
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                setEnrolling(true);
              }}
            >
              Set up authenticator
            </Button>
          )
        ) : (
          <div className="flex flex-col gap-4">
            {codes ? (
              <ul className="grid grid-cols-2 gap-1 font-mono" aria-label="New recovery codes">
                {codes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            ) : null}
            <form
              aria-label="Regenerate recovery codes"
              className="flex items-end gap-2"
              onSubmit={(e) => {
                const d = fields(e);
                void act(
                  async () =>
                    setCodes(
                      (
                        await bff<{ recoveryCodes: string[] }>(
                          '/bff/api/auth/mfa/recovery-codes/regenerate',
                          { body: { code: d.code } },
                        )
                      ).recoveryCodes,
                    ),
                  'New recovery codes generated.',
                );
              }}
            >
              <Field id="regen" label="Authenticator code">
                <input
                  id="regen"
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
                New recovery codes
              </Button>
            </form>
            {!me.mfa.required ? (
              <form
                aria-label="Remove authenticator"
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  const d = fields(e);
                  void act(
                    () =>
                      bff('/bff/api/auth/mfa/totp/remove', {
                        body: { currentSecret: d.current, code: d.code },
                      }),
                    'Authenticator removed; other sessions were signed out.',
                  );
                }}
              >
                <Field id="rm-secret" label="Current password/PIN">
                  <input
                    id="rm-secret"
                    name="current"
                    type="password"
                    required
                    autoComplete="current-password"
                    className={inputClassName}
                  />
                </Field>
                <Field id="rm-code" label="Authenticator code">
                  <input
                    id="rm-code"
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
                  Remove
                </Button>
              </form>
            ) : null}
          </div>
        )}
      </Card>

      <Card title="Change password or PIN">
        <form
          aria-label="Change password or PIN"
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            const d = fields(e);
            const form = e.currentTarget;
            if (d.next !== d.confirm) {
              setMessage({ tone: 'danger', text: 'The new entries do not match' });
              return;
            }
            void act(async () => {
              await bff('/bff/api/auth/credentials/change', {
                body: { currentSecret: d.current, credentialType: kind, newSecret: d.next },
              });
              form.reset();
            }, 'Updated. Other sessions were signed out.');
          }}
        >
          {me.pinAllowed ? (
            <fieldset className="flex gap-4 text-sm">
              <legend className="mb-1 font-medium">New credential</legend>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={kind === 'PIN'}
                  onChange={() => {
                    setKind('PIN');
                  }}
                />{' '}
                PIN
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={kind === 'PASSWORD'}
                  onChange={() => {
                    setKind('PASSWORD');
                  }}
                />{' '}
                Password
              </label>
            </fieldset>
          ) : null}
          <Field id="current" label="Current password or PIN">
            <input
              id="current"
              name="current"
              type="password"
              required
              autoComplete="current-password"
              className={inputClassName}
            />
          </Field>
          <Field id="next" label={kind === 'PIN' ? 'New PIN' : 'New password'}>
            <input
              id="next"
              name="next"
              type="password"
              required
              autoComplete="new-password"
              className={inputClassName}
            />
          </Field>
          <Field id="confirm" label="Confirm">
            <input
              id="confirm"
              name="confirm"
              type="password"
              required
              autoComplete="new-password"
              className={inputClassName}
            />
          </Field>
          <div>
            <Button type="submit" disabled={busy}>
              Save
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Active sessions">
        <ul className="flex flex-col divide-y divide-slate-100">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                {s.device?.label ?? 'Unknown device'}{' '}
                {s.current ? <Badge tone="info">This session</Badge> : null}
                <span className="block text-xs text-slate-500">
                  Last active {when(s.lastActiveAt)}
                </span>
              </span>
              {!s.current ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => bff(`/bff/api/auth/sessions/${s.id}`, { method: 'DELETE' }),
                      'Session revoked.',
                    )
                  }
                >
                  Revoke
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="mt-3">
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
                  First seen {when(d.firstSeenAt)}
                </span>
              </span>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => bff(`/bff/api/auth/devices/${d.id}`, { method: 'DELETE' }),
                    'Device removed and its sessions ended.',
                  )
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
