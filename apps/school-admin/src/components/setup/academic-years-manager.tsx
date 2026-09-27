'use client';

import type { AcademicYear } from '@acadlyx/types';
import { academicYearSchema } from '@acadlyx/validation';
import { Badge, Button, EmptyState } from '@acadlyx/web-ui';
import { type FormEvent, useState } from 'react';
import { bffApi } from '@/lib/bff-client';
import {
  Disclosure,
  fieldErrors,
  formValues,
  NoticeBox,
  SmallButton,
  TextField,
  useAction,
} from './ui';

const TONE = { PLANNED: 'neutral', ACTIVE: 'success', CLOSED: 'warning' } as const;
const pad = (n: number) => String(n).padStart(2, '0');

/** Formats a date-only value for display without any time-zone shift. */
function showDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)),
  );
}

/** Suggests the next academic year from the configured start month (a default only). */
function suggestion(years: AcademicYear[], startMonth: number) {
  const latest = years[0];
  const startYear = latest ? Number(latest.endDate.slice(0, 4)) : new Date().getUTCFullYear();
  const start = `${String(startYear)}-${pad(startMonth)}-01`;
  const endDate = new Date(Date.UTC(startYear + 1, startMonth - 1, 0));
  const end = endDate.toISOString().slice(0, 10);
  return { name: `${String(startYear)}–${String(startYear + 1).slice(2)}`, start, end };
}

export function AcademicYearsManager({
  years,
  canManage,
  startMonth,
}: {
  years: AcademicYear[];
  canManage: boolean;
  startMonth: number;
}) {
  const { busy, notice, run } = useAction();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const next = suggestion(years, startMonth);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const parsed = academicYearSchema.safeParse(formValues(form));
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    if (
      await run(
        () => bffApi('academic-years', { method: 'POST', body: parsed.data }),
        `Academic year ${parsed.data.name} created.`,
      )
    )
      form.reset();
  }

  const act = (y: AcademicYear, verb: 'activate' | 'close' | 'set-current', done: string) =>
    void run(() => bffApi(`academic-years/${y.id}/${verb}`, { method: 'POST' }), done);

  async function edit(y: AcademicYear, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = formValues(e.currentTarget);
    const body = y.status === 'PLANNED' ? values : { name: values.name };
    await run(
      () => bffApi(`academic-years/${y.id}`, { method: 'PATCH', body }),
      `${values.name ?? y.name} saved.`,
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <NoticeBox notice={notice} />
      {canManage ? (
        <Disclosure summary="Add an academic year" testId="add-year" open={years.length === 0}>
          <form
            onSubmit={(e) => void create(e)}
            className="flex flex-col gap-3"
            noValidate
            aria-label="Create academic year"
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField
                idPrefix="new-year"
                name="name"
                label="Name"
                hint="e.g. 2026–27"
                defaultValue={next.name}
                required
                error={errors.name}
              />
              <TextField
                idPrefix="new-year"
                name="startDate"
                type="date"
                label="Start date"
                defaultValue={next.start}
                required
                error={errors.startDate}
              />
              <TextField
                idPrefix="new-year"
                name="endDate"
                type="date"
                label="End date"
                defaultValue={next.end}
                required
                error={errors.endDate}
              />
            </div>
            <div>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Create academic year'}
              </Button>
            </div>
          </form>
        </Disclosure>
      ) : null}
      {years.length === 0 ? (
        <EmptyState title="No academic years yet">
          Create the school’s first academic year, activate it and make it current.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="years-list">
          {years.map((y) => (
            <li key={y.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{y.name}</span>
                <Badge tone={TONE[y.status]}>
                  {y.status.charAt(0) + y.status.slice(1).toLowerCase()}
                </Badge>
                {y.isCurrent ? <Badge tone="info">Current</Badge> : null}
                <span className="text-sm text-slate-600">
                  {showDate(y.startDate)} – {showDate(y.endDate)}
                </span>
                {canManage ? (
                  <span className="ml-auto flex flex-wrap gap-2">
                    {y.status === 'PLANNED' ? (
                      <SmallButton
                        disabled={busy}
                        label={`Activate ${y.name}`}
                        onClick={() => act(y, 'activate', `${y.name} is now active.`)}
                      >
                        Activate
                      </SmallButton>
                    ) : null}
                    {y.status === 'ACTIVE' && !y.isCurrent ? (
                      <SmallButton
                        disabled={busy}
                        label={`Make ${y.name} the current year`}
                        onClick={() =>
                          act(y, 'set-current', `${y.name} is now the current academic year.`)
                        }
                      >
                        Set current
                      </SmallButton>
                    ) : null}
                    {y.status === 'ACTIVE' && !y.isCurrent ? (
                      <SmallButton
                        disabled={busy}
                        label={`Close ${y.name}`}
                        onClick={() => act(y, 'close', `${y.name} closed.`)}
                      >
                        Close
                      </SmallButton>
                    ) : null}
                  </span>
                ) : null}
              </div>
              {canManage && y.status !== 'CLOSED' ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-slate-600 underline">
                    Edit {y.name}
                  </summary>
                  <form
                    onSubmit={(e) => void edit(y, e)}
                    className="mt-3 grid gap-3 sm:grid-cols-4"
                    aria-label={`Edit ${y.name}`}
                  >
                    <TextField
                      idPrefix={`year-${y.id}`}
                      name="name"
                      label="Name"
                      defaultValue={y.name}
                      required
                    />
                    <TextField
                      idPrefix={`year-${y.id}`}
                      name="startDate"
                      type="date"
                      label="Start date"
                      defaultValue={y.startDate}
                      disabled={y.status !== 'PLANNED'}
                      hint={y.status !== 'PLANNED' ? 'Locked once active' : undefined}
                    />
                    <TextField
                      idPrefix={`year-${y.id}`}
                      name="endDate"
                      type="date"
                      label="End date"
                      defaultValue={y.endDate}
                      disabled={y.status !== 'PLANNED'}
                    />
                    <div className="flex items-end">
                      <Button type="submit" disabled={busy}>
                        Save
                      </Button>
                    </div>
                  </form>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
