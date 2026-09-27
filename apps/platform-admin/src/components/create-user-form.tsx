'use client';

import { Alert, Button, Field, inputClassName } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { SCHOOL_ROLES } from '@/lib/roles';

/**
 * Creates a school identity with only the identifiers its roles need. No passwords are ever set
 * here: the account starts PENDING_ACTIVATION and the user activates it (OTP, or a one-time code
 * for students).
 */
export function CreateUserForm({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [roles, setRoles] = useState<string[]>([]);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (roles.length === 0) {
      setMessage({ tone: 'danger', text: 'Select at least one role' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const created = await api.platform.createUser(tenantId, {
        displayName: data.displayName ?? '',
        roles,
        ...(data.email ? { email: data.email } : {}),
        ...(data.phone ? { phone: data.phone } : {}),
        ...(data.loginId
          ? {
              loginId: data.loginId,
              loginIdKind: roles.includes('STUDENT') ? 'STUDENT_ID' : 'EMPLOYEE_ID',
            }
          : {}),
      });
      setMessage({ tone: 'success', text: `${created.displayName} created (pending activation).` });
      form.reset();
      setRoles([]);
      router.refresh();
    } catch (err) {
      setMessage({ tone: 'danger', text: describeError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      noValidate
      className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6"
      aria-label="Create school user"
    >
      <h2 className="font-semibold">Create school user</h2>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 text-sm font-medium">Roles</legend>
        {SCHOOL_ROLES.map((r) => (
          <label key={r.key} className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={roles.includes(r.key)}
              onChange={(e) => {
                setRoles(e.target.checked ? [...roles, r.key] : roles.filter((x) => x !== r.key));
              }}
            />
            {r.name}
          </label>
        ))}
      </fieldset>
      <Field id="displayName" label="Display name">
        <input
          id="displayName"
          name="displayName"
          required
          maxLength={120}
          className={inputClassName}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="email" label="Email" hint="Principal, admins, staff.">
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="off"
            maxLength={254}
            className={inputClassName}
          />
        </Field>
        <Field id="phone" label="Mobile" hint="Parents (10-digit or +country).">
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="off"
            maxLength={20}
            className={inputClassName}
          />
        </Field>
        <Field id="loginId" label="Student / employee ID" hint="Students: admission ID.">
          <input
            id="loginId"
            name="loginId"
            autoComplete="off"
            maxLength={64}
            className={inputClassName}
          />
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create user'}
        </Button>
      </div>
    </form>
  );
}
