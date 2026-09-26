'use client';

import type { TenantDetail } from '@acadlyx/tenant-config';
import { updateTenantSchema } from '@acadlyx/validation';
import { Alert, Button, Field, inputClassName } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { describeError, type FieldErrors, zodFieldErrors } from '@/lib/errors';

export function TenantIdentityForm({ tenant }: { tenant: TenantDetail }) {
  const router = useRouter();
  const [values, setValues] = useState({
    displayName: tenant.displayName,
    legalName: tenant.legalName ?? '',
    slug: tenant.slug,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const input = {
      displayName: values.displayName,
      legalName: values.legalName.trim() === '' ? null : values.legalName,
      ...(tenant.slugLocked ? {} : { slug: values.slug }),
    };
    const parsed = updateTenantSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await api.platform.updateTenant(tenant.id, parsed.data);
      setMessage({ tone: 'success', text: 'Saved.' });
      router.refresh();
    } catch (error) {
      setMessage({ tone: 'danger', text: describeError(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <Field id="displayName" label="Display name" error={errors.displayName}>
        <input
          id="displayName"
          className={inputClassName}
          value={values.displayName}
          maxLength={120}
          aria-invalid={errors.displayName ? true : undefined}
          onChange={(e) => {
            setValues({ ...values, displayName: e.target.value });
          }}
        />
      </Field>
      <Field id="legalName" label="Legal name" error={errors.legalName}>
        <input
          id="legalName"
          className={inputClassName}
          value={values.legalName}
          maxLength={200}
          onChange={(e) => {
            setValues({ ...values, legalName: e.target.value });
          }}
        />
      </Field>
      <Field
        id="slug"
        label="Slug"
        hint={
          tenant.slugLocked
            ? 'Locked: the tenant has been activated.'
            : 'Can be changed until first activation.'
        }
        error={errors.slug}
      >
        <input
          id="slug"
          className={`${inputClassName} font-mono disabled:bg-slate-100`}
          value={values.slug}
          disabled={tenant.slugLocked}
          maxLength={63}
          onChange={(e) => {
            setValues({ ...values, slug: e.target.value });
          }}
        />
      </Field>
      <div>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save identity'}
        </Button>
      </div>
    </form>
  );
}
