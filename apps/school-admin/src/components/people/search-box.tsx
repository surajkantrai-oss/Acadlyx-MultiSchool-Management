'use client';

import { Button } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import { formValues, SelectField, TextField } from '../setup/ui';

export function SearchBox({
  base,
  q,
  label,
  hint,
  status,
}: {
  base: string;
  q: string;
  label: string;
  hint?: string;
  status?: { value: string; options: { value: string; label: string }[] };
}) {
  const router = useRouter();
  return (
    <form
      role="search"
      aria-label={label}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const v = formValues(e.currentTarget);
        const qs = new URLSearchParams(
          Object.entries(v).filter(([, x]) => x) as [string, string][],
        );
        router.push(`${base}${qs.size ? `?${qs.toString()}` : ''}`);
      }}
    >
      <TextField idPrefix="s" name="q" type="search" label={label} hint={hint} defaultValue={q} />
      {status ? (
        <SelectField
          idPrefix="s"
          name="status"
          label="Status"
          defaultValue={status.value}
          options={status.options}
        />
      ) : null}
      <Button type="submit" variant="secondary">
        Search
      </Button>
    </form>
  );
}
