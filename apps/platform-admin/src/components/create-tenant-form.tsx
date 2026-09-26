'use client';

import { ApiError } from '@acadlyx/api-client';
import { createTenantSchema } from '@acadlyx/validation';
import { Alert, Button, Field, inputClassName } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { describeError, type FieldErrors, zodFieldErrors } from '@/lib/errors';

function suggestKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^A-Z]+/, '')
    .slice(0, 40);
}
function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

export function CreateTenantForm() {
  const router = useRouter();
  const [values, setValues] = useState({
    displayName: '',
    legalName: '',
    key: '',
    slug: '',
    initialStatus: 'DRAFT' as 'DRAFT' | 'ACTIVE',
  });
  const [touchedIds, setTouchedIds] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (field: keyof typeof values, value: string) => {
    setValues((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'displayName' && !touchedIds) {
        next.key = suggestKey(value);
        next.slug = suggestSlug(value);
      }
      return next;
    });
    if (field === 'key' || field === 'slug') setTouchedIds(true);
  };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const parsed = createTenantSchema.safeParse({
      ...values,
      legalName: values.legalName.trim() || undefined,
    });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const tenant = await api.platform.createTenant(parsed.data);
      router.push(`/schools/${tenant.id}`);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'TENANT_KEY_TAKEN')
        setErrors({ key: error.message });
      else if (error instanceof ApiError && error.code === 'TENANT_SLUG_TAKEN')
        setErrors({ slug: error.message });
      else setFormError(describeError(error));
      setSubmitting(false);
    }
  }

  const control = (field: keyof typeof values) => ({
    id: field,
    name: field,
    value: values[field],
    onChange: (e: { target: { value: string } }) => {
      update(field, e.target.value);
    },
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `${field}-error` : undefined,
    className: inputClassName,
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6"
    >
      {formError ? <Alert title="Could not create school">{formError}</Alert> : null}
      <Field id="displayName" label="Display name" error={errors.displayName}>
        <input {...control('displayName')} maxLength={120} required />
      </Field>
      <Field id="legalName" label="Legal name (optional)" error={errors.legalName}>
        <input {...control('legalName')} maxLength={200} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="key" label="Tenant key" hint="Permanent. e.g. WORLD_WAY" error={errors.key}>
          <input {...control('key')} className={`${inputClassName} font-mono`} maxLength={40} />
        </Field>
        <Field
          id="slug"
          label="Slug"
          hint="Locked after first activation. e.g. world-way"
          error={errors.slug}
        >
          <input {...control('slug')} className={`${inputClassName} font-mono`} maxLength={63} />
        </Field>
      </div>
      <Field id="initialStatus" label="Initial status" error={errors.initialStatus}>
        <select {...control('initialStatus')}>
          <option value="DRAFT">DRAFT — not reachable by school users yet</option>
          <option value="ACTIVE">ACTIVE — reachable immediately</option>
        </select>
      </Field>
      <div>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create school'}
        </Button>
      </div>
    </form>
  );
}
