'use client';

import { validateConfigurationValue, type TenantConfigurationEntry } from '@acadlyx/tenant-config';
import { Alert, Badge, Button, Field, inputClassName } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';

/** Typed configuration editor: one control per registered key — no raw JSON editing. */
function EntryForm({ tenantId, entry }: { tenantId: string; entry: TenantConfigurationEntry }) {
  const router = useRouter();
  const [raw, setRaw] = useState(String(entry.value));
  const [error, setError] = useState<string | undefined>();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setStatus(null);
    const value: unknown = entry.input === 'number' ? Number(raw) : raw;
    const check = validateConfigurationValue(entry.key, value);
    if (!check.success) {
      setError(check.errors[0]);
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await api.platform.setConfiguration(tenantId, entry.key, check.value);
      setStatus('Saved');
      router.refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      const updated = await api.platform.resetConfiguration(tenantId, entry.key);
      setRaw(String(updated.value));
      setStatus('Reset to default');
      router.refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const id = `config-${entry.key.replace(/\./g, '-')}`;
  return (
    <form
      onSubmit={save}
      noValidate
      className="flex flex-col gap-3 border-b border-slate-100 py-4 last:border-0"
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-slate-500">{entry.key}</span>
        {entry.isDefault ? <Badge>default</Badge> : <Badge tone="info">overridden</Badge>}
        {status ? (
          <span role="status" className="text-xs text-emerald-700">
            {status}
          </span>
        ) : null}
      </div>
      <Field id={id} label={entry.label} hint={entry.description} error={error}>
        {entry.input === 'select' && entry.options ? (
          <select
            id={id}
            className={inputClassName}
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
            }}
          >
            {entry.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            type={entry.input === 'number' ? 'number' : 'text'}
            className={inputClassName}
            value={raw}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setRaw(e.target.value);
            }}
          />
        )}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          Save
        </Button>
        {!entry.isDefault ? (
          <Button variant="secondary" disabled={busy} onClick={() => void reset()}>
            Reset to default
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function ConfigurationEditor({
  tenantId,
  entries,
}: {
  tenantId: string;
  entries: TenantConfigurationEntry[];
}) {
  const categories = [...new Set(entries.map((e) => e.category))];
  return (
    <div className="flex flex-col gap-6">
      <Alert tone="info">
        Only registered, validated settings can be stored. New settings are added to the shared
        registry in the phase that needs them.
      </Alert>
      {categories.map((category) => (
        <section key={category} className="rounded-lg border border-slate-200 bg-white px-6 py-2">
          <h2 className="pt-3 text-sm font-semibold capitalize">{category}</h2>
          {entries
            .filter((e) => e.category === category)
            .map((entry) => (
              <EntryForm
                key={`${entry.key}:${String(entry.value)}`}
                tenantId={tenantId}
                entry={entry}
              />
            ))}
        </section>
      ))}
    </div>
  );
}
