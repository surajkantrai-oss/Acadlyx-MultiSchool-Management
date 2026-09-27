'use client';

import { Alert, Button, Field, inputClassName } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { bff } from '@/lib/bff-client';
import { MfaEnrollment } from './mfa-steps';

type Flow = 'activation' | 'recovery';

/**
 * Activation (first PIN/password) and recovery (forgotten PIN/password). The code arrives on the
 * registered mobile/email — or, for students, is a one-time code issued by the school. The
 * verified grant is kept in an HttpOnly cookie by the BFF; nothing is stored in the browser.
 */
export function OtpFlow({ flow }: { flow: Flow }) {
  const router = useRouter();
  const [step, setStep] = useState<'identify' | 'code' | 'secret' | 'enroll' | 'done'>('identify');
  const [identifier, setIdentifier] = useState('');
  const [kind, setKind] = useState<'PIN' | 'PASSWORD'>('PIN');
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
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
  const data = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    return Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6">
      {error ? <Alert title="Problem">{error}</Alert> : null}
      {info ? <Alert tone="info">{info}</Alert> : null}

      {step === 'identify' ? (
        <form
          aria-label="Identify account"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            const d = data(e);
            void run(async () => {
              setIdentifier(d.identifier ?? '');
              if (d.mode !== 'school-code') {
                const res = await bff<{ message: string }>(`/bff/api/auth/${flow}/start`, {
                  body: { identifier: d.identifier },
                });
                setInfo(res.message);
              }
              setStep('code');
            });
          }}
        >
          <Field
            id="identifier"
            label={
              flow === 'activation'
                ? 'Registered mobile, email or student ID'
                : 'Registered mobile or email'
            }
          >
            <input
              id="identifier"
              name="identifier"
              required
              autoComplete="username"
              maxLength={254}
              className={inputClassName}
            />
          </Field>
          {flow === 'activation' ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="mode" value="school-code" /> I have an activation code
              from my school (students)
            </label>
          ) : null}
          <Button type="submit" disabled={busy}>
            {busy ? 'Please wait…' : 'Continue'}
          </Button>
        </form>
      ) : null}

      {step === 'code' ? (
        <form
          aria-label="Verify code"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            const d = data(e);
            void run(async () => {
              await bff('/bff/auth/otp/verify', { body: { flow, identifier, code: d.code } });
              setInfo(null);
              setStep('secret');
            });
          }}
        >
          <Field id="code" label="Verification code">
            <input
              id="code"
              name="code"
              required
              autoComplete="one-time-code"
              maxLength={16}
              className={`${inputClassName} font-mono tracking-widest`}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? 'Verifying…' : 'Verify code'}
          </Button>
        </form>
      ) : null}

      {step === 'secret' ? (
        <form
          aria-label="Set PIN or password"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            const d = data(e);
            if (d.secret !== d.confirm) {
              setError('The two entries do not match');
              return;
            }
            void run(async () => {
              const res = await bff<{ status: string }>('/bff/auth/otp/complete', {
                body: { credentialType: kind, secret: d.secret },
              });
              if (res.status === 'RESET') setStep('done');
              else if (res.status === 'AUTHENTICATED') {
                router.replace('/');
                router.refresh();
              } else setStep('enroll');
            });
          }}
        >
          <fieldset className="flex gap-4 text-sm">
            <legend className="mb-1 font-medium">Sign in with</legend>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={kind === 'PIN'}
                onChange={() => {
                  setKind('PIN');
                }}
              />{' '}
              6-digit PIN (parents, students)
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
          <Field
            id="secret"
            label={kind === 'PIN' ? 'New PIN' : 'New password'}
            hint={
              kind === 'PIN'
                ? 'Exactly 6 digits; not a sequence or repeated digit.'
                : 'At least 8 characters.'
            }
          >
            <input
              id="secret"
              name="secret"
              type="password"
              required
              autoComplete="new-password"
              {...(kind === 'PIN'
                ? { inputMode: 'numeric' as const, pattern: '\\d{6}', maxLength: 6 }
                : { minLength: 8, maxLength: 128 })}
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
              maxLength={128}
              className={inputClassName}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </form>
      ) : null}

      {step === 'enroll' ? (
        <MfaEnrollment
          onDone={() => {
            router.replace('/');
            router.refresh();
          }}
          intro="Your role requires multi-factor authentication. Set up an authenticator app to finish activation."
        />
      ) : null}

      {step === 'done' ? (
        <Alert tone="success" title="Updated">
          Your PIN/password has been reset and all devices were signed out. You can now sign in.
        </Alert>
      ) : null}
    </div>
  );
}
