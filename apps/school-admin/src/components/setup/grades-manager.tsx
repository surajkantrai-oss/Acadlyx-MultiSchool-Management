'use client';

import type { Grade } from '@acadlyx/types';
import { gradeSchema } from '@acadlyx/validation';
import { Badge, Button, Card, EmptyState } from '@acadlyx/web-ui';
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

export function GradesManager({ grades, canManage }: { grades: Grade[]; canManage: boolean }) {
  const { busy, notice, run } = useAction();
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const parsed = gradeSchema.safeParse(formValues(form));
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    if (
      await run(
        () => bffApi('grades', { method: 'POST', body: parsed.data }),
        `${parsed.data.name} added.`,
      )
    )
      form.reset();
  }

  function move(index: number, delta: -1 | 1) {
    const ids = grades.map((g) => g.id);
    const target = index + delta;
    const a = ids[index];
    const b = ids[target];
    if (a === undefined || b === undefined) return;
    ids[index] = b;
    ids[target] = a;
    void run(() => bffApi('grades/order', { method: 'PUT', body: { ids } }), 'Grade order saved.');
  }

  async function edit(g: Grade, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = gradeSchema.safeParse(formValues(e.currentTarget));
    if (!parsed.success) return;
    await run(
      () => bffApi(`grades/${g.id}`, { method: 'PATCH', body: parsed.data }),
      `${parsed.data.name} saved.`,
    );
  }

  return (
    <Card title="Grades">
      <div className="flex flex-col gap-4">
        <NoticeBox notice={notice} />
        {canManage ? (
          <Disclosure summary="Add a grade" testId="add-grade" open={grades.length === 0}>
            <form
              onSubmit={(e) => void create(e)}
              className="flex flex-wrap items-end gap-3"
              noValidate
              aria-label="Create grade"
            >
              <TextField
                idPrefix="new-grade"
                name="name"
                label="Grade name"
                hint="e.g. Nursery, Grade 1"
                required
                error={errors.name}
              />
              <TextField
                idPrefix="new-grade"
                name="code"
                label="Code"
                hint="e.g. NUR, G1"
                required
                maxLength={20}
                error={errors.code}
              />
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Add grade'}
              </Button>
            </form>
          </Disclosure>
        ) : null}
        {grades.length === 0 ? (
          <EmptyState title="No grades yet">
            Add the grades your school offers, in order.
          </EmptyState>
        ) : (
          <ol
            className="flex flex-col divide-y divide-slate-100"
            data-testid="grades-list"
            aria-label="Grades in display order"
          >
            {grades.map((g, i) => (
              <li key={g.id} className="flex flex-col gap-2 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-6 text-right text-xs text-slate-400">{i + 1}.</span>
                  <span className="font-medium">{g.name}</span>
                  <span className="font-mono text-xs text-slate-500">{g.code}</span>
                  {!g.isActive ? <Badge>Inactive</Badge> : null}
                  {canManage ? (
                    <span className="ml-auto flex flex-wrap gap-2">
                      <SmallButton
                        disabled={busy || i === 0}
                        label={`Move ${g.name} up`}
                        onClick={() => move(i, -1)}
                      >
                        ↑ Up
                      </SmallButton>
                      <SmallButton
                        disabled={busy || i === grades.length - 1}
                        label={`Move ${g.name} down`}
                        onClick={() => move(i, 1)}
                      >
                        ↓ Down
                      </SmallButton>
                      <SmallButton
                        disabled={busy}
                        label={`${g.isActive ? 'Deactivate' : 'Activate'} ${g.name}`}
                        onClick={() =>
                          void run(
                            () =>
                              bffApi(`grades/${g.id}/${g.isActive ? 'deactivate' : 'activate'}`, {
                                method: 'POST',
                              }),
                            `${g.name} ${g.isActive ? 'deactivated' : 'activated'}.`,
                          )
                        }
                      >
                        {g.isActive ? 'Deactivate' : 'Activate'}
                      </SmallButton>
                    </span>
                  ) : null}
                </div>
                {canManage ? (
                  <details className="ml-8">
                    <summary className="cursor-pointer text-xs text-slate-600 underline">
                      Edit {g.name}
                    </summary>
                    <form
                      onSubmit={(e) => void edit(g, e)}
                      className="mt-2 flex flex-wrap items-end gap-3"
                      aria-label={`Edit ${g.name}`}
                    >
                      <TextField
                        idPrefix={`grade-${g.id}`}
                        name="name"
                        label="Name"
                        defaultValue={g.name}
                        required
                      />
                      <TextField
                        idPrefix={`grade-${g.id}`}
                        name="code"
                        label="Code"
                        defaultValue={g.code}
                        required
                        maxLength={20}
                      />
                      <Button type="submit" disabled={busy}>
                        Save
                      </Button>
                    </form>
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}
