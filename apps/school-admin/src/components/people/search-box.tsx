'use client';

import { Button } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import { formValues, SelectField, TextField } from '../setup/ui';

interface Filter {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
}

/**
 * List search + filters. State lives in the URL (shareable, reload-safe, back/forward works);
 * the page resets to 1 whenever filters change.
 */
export function SearchBox({
  base,
  q,
  label,
  hint,
  status,
  statusName = 'status',
  filters = [],
  hidden = {},
}: {
  base: string;
  q: string;
  label: string;
  hint?: string;
  status?: { value: string; options: { value: string; label: string }[]; label?: string };
  statusName?: string;
  filters?: Filter[];
  hidden?: Record<string, string>;
}) {
  const router = useRouter();
  const all: Filter[] = [
    ...(status
      ? [
          {
            name: statusName,
            label: status.label ?? 'Status',
            value: status.value,
            options: status.options,
          },
        ]
      : []),
    ...filters,
  ];
  return (
    <form
      role="search"
      aria-label={label}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const v = { ...hidden, ...formValues(e.currentTarget) };
        const qs = new URLSearchParams(
          Object.entries(v).filter(([, x]) => x) as [string, string][],
        );
        router.push(`${base}${qs.size ? `?${qs.toString()}` : ''}`);
      }}
    >
      <TextField idPrefix="s" name="q" type="search" label={label} hint={hint} defaultValue={q} />
      {all.map((f) => (
        <SelectField
          key={f.name}
          idPrefix="s"
          name={f.name}
          label={f.label}
          defaultValue={f.value}
          options={f.options}
        />
      ))}
      <Button type="submit" variant="secondary">
        Search
      </Button>
    </form>
  );
}
