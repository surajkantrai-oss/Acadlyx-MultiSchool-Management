'use client';

import type { TenantBranding } from '@acadlyx/tenant-config';
import { HEX_COLOR_PATTERN, tenantBrandingSchema } from '@acadlyx/validation';
import { Alert, Button, Field, inputClassName } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { describeError, type FieldErrors, zodFieldErrors } from '@/lib/errors';

type Values = Record<keyof TenantBranding, string>;

const TEXT_FIELDS: {
  key: keyof TenantBranding;
  label: string;
  hint?: string;
  type?: string;
  max: number;
}[] = [
  { key: 'schoolName', label: 'School name', max: 120 },
  { key: 'shortName', label: 'Short name', max: 40 },
  {
    key: 'logoUrl',
    label: 'Logo URL',
    hint: 'https:// only. Uploads arrive in a later phase.',
    type: 'url',
    max: 2048,
  },
  { key: 'faviconUrl', label: 'Favicon URL', type: 'url', max: 2048 },
  { key: 'backgroundImageUrl', label: 'Background image URL', type: 'url', max: 2048 },
  { key: 'loginImageUrl', label: 'Login image URL', type: 'url', max: 2048 },
  { key: 'supportEmail', label: 'Support email', type: 'email', max: 254 },
  { key: 'supportPhone', label: 'Support phone', type: 'tel', max: 20 },
  { key: 'websiteUrl', label: 'Website URL', type: 'url', max: 2048 },
  { key: 'footerText', label: 'Footer text', hint: 'Plain text only.', max: 200 },
];

const COLOR_FIELDS: { key: 'primaryColor' | 'secondaryColor' | 'accentColor'; label: string }[] = [
  { key: 'primaryColor', label: 'Primary colour' },
  { key: 'secondaryColor', label: 'Secondary colour' },
  { key: 'accentColor', label: 'Accent colour' },
];

function toValues(branding: TenantBranding | null, fallbackName: string): Values {
  const empty = Object.fromEntries(
    [...TEXT_FIELDS.map((f) => f.key), ...COLOR_FIELDS.map((f) => f.key)].map((k) => [k, '']),
  ) as Values;
  if (!branding) return { ...empty, schoolName: fallbackName, primaryColor: '#1D4ED8' };
  const values = { ...empty };
  for (const key of Object.keys(empty) as (keyof TenantBranding)[])
    values[key] = branding[key] ?? '';
  return values;
}

export function BrandingForm({
  tenantId,
  initial,
  fallbackName,
}: {
  tenantId: string;
  initial: TenantBranding | null;
  fallbackName: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(() => toValues(initial, fallbackName));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof TenantBranding, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
  };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const payload = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()]),
    );
    const parsed = tenantBrandingSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await api.platform.updateBranding(tenantId, parsed.data);
      setMessage({ tone: 'success', text: 'Branding saved.' });
      router.refresh();
    } catch (error) {
      setMessage({ tone: 'danger', text: describeError(error) });
    } finally {
      setSaving(false);
    }
  }

  const primary = HEX_COLOR_PATTERN.test(values.primaryColor) ? values.primaryColor : '#64748B';
  const accent = HEX_COLOR_PATTERN.test(values.accentColor) ? values.accentColor : primary;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 lg:col-span-2"
      >
        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-3">
          {COLOR_FIELDS.map((f) => (
            <Field key={f.key} id={f.key} label={f.label} hint="#RRGGBB" error={errors[f.key]}>
              <div className="flex gap-2">
                <input
                  type="color"
                  aria-label={`${f.label} picker`}
                  value={HEX_COLOR_PATTERN.test(values[f.key]) ? values[f.key] : '#000000'}
                  onChange={(e) => {
                    set(f.key, e.target.value.toUpperCase());
                  }}
                  className="h-9 w-10 rounded border border-slate-300"
                />
                <input
                  id={f.key}
                  className={`${inputClassName} font-mono`}
                  value={values[f.key]}
                  maxLength={7}
                  aria-invalid={errors[f.key] ? true : undefined}
                  onChange={(e) => {
                    set(f.key, e.target.value);
                  }}
                />
              </div>
            </Field>
          ))}
        </div>
        {TEXT_FIELDS.map((f) => (
          <Field
            key={f.key}
            id={f.key}
            label={f.label}
            {...(f.hint ? { hint: f.hint } : {})}
            error={errors[f.key]}
          >
            <input
              id={f.key}
              type={f.type ?? 'text'}
              className={inputClassName}
              value={values[f.key]}
              maxLength={f.max}
              aria-invalid={errors[f.key] ? true : undefined}
              onChange={(e) => {
                set(f.key, e.target.value);
              }}
            />
          </Field>
        ))}
        <div>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save branding'}
          </Button>
        </div>
      </form>

      <aside
        aria-label="Preview"
        className="h-fit overflow-hidden rounded-lg border border-slate-200 bg-white"
      >
        <div className="px-4 py-3 text-white" style={{ backgroundColor: primary }}>
          <p className="text-sm opacity-80">School Admin preview</p>
          <p className="text-lg font-semibold">
            {values.shortName || values.schoolName || 'School name'}
          </p>
        </div>
        <div className="flex flex-col gap-3 p-4 text-sm text-slate-600">
          <span
            className="w-fit rounded px-3 py-1.5 text-white"
            style={{ backgroundColor: accent }}
          >
            Accent button
          </span>
          <p>{values.footerText || 'Footer text'}</p>
        </div>
      </aside>
    </div>
  );
}
