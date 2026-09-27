'use client';

import { Alert, Button, Field, inputClassName } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';
import { bff } from '@/lib/bff-client';
import { MfaChallenge, MfaEnrollment } from './mfa-steps';

/**
 * Branded school sign-in. The school comes from the address (no school picker). Identifier may be
 * email, mobile, or student/employee ID; secret is password or 6-digit PIN. Privileged roles
 * complete MFA (enrolling on first sign-in). Tokens stay in HttpOnly cookies.
 */
export function SchoolLogin() {
  const router = useRouter();
  const [step, setStep] = useState<'credentials' | 'mfa' | 'enroll'>('credentials');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const done = () => {
    router.refresh();
  };

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  async function onCredentials(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    await run(async () => {
      const res = await bff<{ status: string }>('/bff/auth/login', {
        body: { identifier: data.identifier, secret: data.secret },
      });
      if (res.status === 'AUTHENTICATED') done();
      else setStep(res.status === 'MFA_REQUIRED' ? 'mfa' : 'enroll');
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6">
      {error ? (
        <div ref={errorRef} tabIndex={-1}>
          <Alert title="Sign-in problem">{error}</Alert>
        </div>
      ) : null}
      {step === 'credentials' ? (
        <form
          onSubmit={(e) => void onCredentials(e)}
          className="flex flex-col gap-4"
          aria-label="Sign in"
        >
          <Field
            id="identifier"
            label="Email, mobile or ID"
            hint="Staff: email or employee ID · Parents: mobile · Students: admission ID"
          >
            <input
              id="identifier"
              name="identifier"
              autoComplete="username"
              required
              maxLength={254}
              className={inputClassName}
            />
          </Field>
          <Field id="secret" label="Password or PIN">
            <input
              id="secret"
              name="secret"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              className={inputClassName}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      ) : null}
      {step === 'mfa' ? (
        <MfaChallenge
          busy={busy}
          onSubmit={(factor) =>
            void run(async () => {
              await bff('/bff/auth/mfa', { body: factor });
              done();
            })
          }
        />
      ) : null}
      {step === 'enroll' ? (
        <MfaEnrollment
          onDone={done}
          intro="Your role requires multi-factor authentication. Set up an authenticator app to continue."
        />
      ) : null}
    </div>
  );
}
