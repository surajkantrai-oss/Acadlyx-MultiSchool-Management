'use client';

import { Alert, Button, Field, inputClassName } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';
import { bffPost } from '@/lib/bff-client';

type Step =
  | { kind: 'password' }
  | { kind: 'mfa' }
  | { kind: 'enroll-start' }
  | { kind: 'enroll'; secret: string; qrSvg: string }
  | { kind: 'codes'; codes: string[] };

/**
 * Password → TOTP (or recovery code) → dashboard. First sign-in enrolls TOTP (mandatory for
 * Platform Admin). All tokens live in HttpOnly cookies set by the BFF; nothing is stored in
 * localStorage/sessionStorage.
 */
export function LoginFlow() {
  const router = useRouter();
  const done = () => {
    router.replace('/dashboard');
    router.refresh();
  };
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  async function run(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  const form = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    return Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
  };

  async function onPassword(e: FormEvent<HTMLFormElement>) {
    const { email = '', password = '' } = form(e);
    await run(async () => {
      const res = await bffPost<{ status: string }>('/bff/auth/login', { email, password });
      if (res.status === 'AUTHENTICATED') done();
      else if (res.status === 'MFA_REQUIRED') setStep({ kind: 'mfa' });
      else setStep({ kind: 'enroll-start' });
    });
  }

  async function onMfa(e: FormEvent<HTMLFormElement>) {
    const { code = '' } = form(e);
    await run(async () => {
      await bffPost('/bff/auth/mfa', useRecovery ? { recoveryCode: code } : { code });
      done();
    });
  }

  async function startEnrollment() {
    await run(async () => {
      const res = await bffPost<{ secret: string; qrSvg: string }>('/bff/auth/enroll/start');
      setStep({ kind: 'enroll', secret: res.secret, qrSvg: res.qrSvg });
    });
  }

  async function onEnroll(e: FormEvent<HTMLFormElement>) {
    const { code = '' } = form(e);
    await run(async () => {
      const res = await bffPost<{ recoveryCodes: string[] }>('/bff/auth/enroll/confirm', { code });
      setStep({ kind: 'codes', codes: res.recoveryCodes });
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6">
      {error ? (
        <div ref={errorRef} tabIndex={-1}>
          <Alert title="Sign-in problem">{error}</Alert>
        </div>
      ) : null}

      {step.kind === 'password' ? (
        <form
          onSubmit={(e) => void onPassword(e)}
          className="flex flex-col gap-4"
          aria-label="Sign in"
        >
          <Field id="email" label="Email">
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              className={inputClassName}
            />
          </Field>
          <Field id="password" label="Password">
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={inputClassName}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Continue'}
          </Button>
        </form>
      ) : null}

      {step.kind === 'mfa' ? (
        <form
          onSubmit={(e) => void onMfa(e)}
          className="flex flex-col gap-4"
          aria-label="Two-factor verification"
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
              key={useRecovery ? 'recovery' : 'totp'}
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
            className="text-sm text-slate-600 underline"
            onClick={() => {
              setUseRecovery(!useRecovery);
            }}
          >
            {useRecovery ? 'Use authenticator code instead' : 'Use a recovery code instead'}
          </button>
        </form>
      ) : null}

      {step.kind === 'enroll-start' ? (
        <div className="flex flex-col gap-3 text-sm">
          <p>
            Multi-factor authentication is required for Platform Admin. Set up an authenticator app
            to continue.
          </p>
          <Button onClick={() => void startEnrollment()} disabled={busy}>
            {busy ? 'Preparing…' : 'Set up authenticator'}
          </Button>
        </div>
      ) : null}

      {step.kind === 'enroll' ? (
        <form
          onSubmit={(e) => void onEnroll(e)}
          className="flex flex-col gap-4"
          aria-label="Authenticator setup"
        >
          <p className="text-sm">
            Scan this QR code with your authenticator app, then enter the 6-digit code it shows.
          </p>
          {/* Server-rendered SVG from the otpauth URI; shown once, never stored. */}
          <div
            className="mx-auto"
            role="img"
            aria-label="Authenticator setup QR code"
            dangerouslySetInnerHTML={{ __html: step.qrSvg }}
          />
          <p className="text-xs text-slate-500">
            Can’t scan? Enter this key manually:{' '}
            <code className="break-all font-mono">{step.secret}</code>
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
      ) : null}

      {step.kind === 'codes' ? (
        <div className="flex flex-col gap-3 text-sm">
          <Alert tone="success" title="Authenticator activated">
            Save these recovery codes somewhere safe. Each works once, and they will not be shown
            again.
          </Alert>
          <ul className="grid grid-cols-2 gap-1 font-mono" aria-label="Recovery codes">
            {step.codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <Button onClick={done}>I have saved my codes — continue</Button>
        </div>
      ) : null}
    </div>
  );
}
