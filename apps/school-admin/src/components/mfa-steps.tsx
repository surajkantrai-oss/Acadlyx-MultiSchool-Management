'use client';

import { Alert, Button, Field, inputClassName } from '@acadlyx/web-ui';
import { type FormEvent, useState } from 'react';
import { bff } from '@/lib/bff-client';

/** Second-factor step: authenticator code or one-time recovery code. */
export function MfaChallenge({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (factor: { code?: string; recoveryCode?: string }) => void;
}) {
  const [useRecovery, setUseRecovery] = useState(false);
  return (
    <form
      aria-label="Two-factor verification"
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const value = String(new FormData(e.currentTarget).get('code') ?? '');
        onSubmit(useRecovery ? { recoveryCode: value } : { code: value });
      }}
    >
      <Field
        id="code"
        label={useRecovery ? 'Recovery code' : 'Authenticator code'}
        hint={
          useRecovery
            ? 'Each recovery code works once.'
            : 'Enter the 6-digit code from your authenticator app.'
        }
      >
        <input
          key={useRecovery ? 'r' : 't'}
          id="code"
          name="code"
          required
          autoFocus
          className={`${inputClassName} font-mono tracking-widest`}
          {...(useRecovery
            ? { autoComplete: 'off', maxLength: 11 }
            : {
                autoComplete: 'one-time-code',
                inputMode: 'numeric' as const,
                pattern: '\\d{6}',
                maxLength: 6,
              })}
        />
      </Field>
      <Button type="submit" disabled={busy}>
        {busy ? 'Verifying…' : 'Verify'}
      </Button>
      <button
        type="button"
        className="text-sm underline"
        onClick={() => {
          setUseRecovery(!useRecovery);
        }}
      >
        {useRecovery ? 'Use authenticator code instead' : 'Use a recovery code instead'}
      </button>
    </form>
  );
}

/** Authenticator enrollment (QR + manual key, shown once) then recovery codes shown once. */
export function MfaEnrollment({ onDone, intro }: { onDone: () => void; intro: string }) {
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code') ?? '');
    await go(async () =>
      setCodes(
        (await bff<{ recoveryCodes: string[] }>('/bff/auth/enroll/confirm', { body: { code } }))
          .recoveryCodes,
      ),
    );
  }

  if (codes) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <Alert tone="success" title="Authenticator activated">
          Save these recovery codes somewhere safe. Each works once; they will not be shown again.
        </Alert>
        <ul className="grid grid-cols-2 gap-1 font-mono" aria-label="Recovery codes">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Button onClick={onDone}>I have saved my codes — continue</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 text-sm">
      {error ? <Alert>{error}</Alert> : null}
      {!setup ? (
        <>
          <p>{intro}</p>
          <Button
            disabled={busy}
            onClick={() =>
              void go(async () =>
                setSetup(await bff<{ secret: string; qrSvg: string }>('/bff/auth/enroll/start')),
              )
            }
          >
            {busy ? 'Preparing…' : 'Set up authenticator'}
          </Button>
        </>
      ) : (
        <form
          onSubmit={(e) => void confirm(e)}
          className="flex flex-col gap-4"
          aria-label="Authenticator setup"
        >
          <p>
            Scan this QR code with your authenticator app, then enter the 6-digit code it shows.
          </p>
          <div
            className="mx-auto"
            role="img"
            aria-label="Authenticator setup QR code"
            dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
          />
          <p className="text-xs text-slate-500">
            Can’t scan? Enter this key manually:{' '}
            <code className="break-all font-mono">{setup.secret}</code>
          </p>
          <Field id="enroll-code" label="Authenticator code">
            <input
              id="enroll-code"
              name="code"
              required
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              className={`${inputClassName} font-mono tracking-widest`}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? 'Verifying…' : 'Activate'}
          </Button>
        </form>
      )}
    </div>
  );
}
