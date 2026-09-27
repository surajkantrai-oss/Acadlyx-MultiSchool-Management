'use client';

import type { AcademicYear, Branch, Grade, Section } from '@acadlyx/types';
import { sectionSchema } from '@acadlyx/validation';
import { Alert, Badge, Button, Card, EmptyState } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { bffApi } from '@/lib/bff-client';
import {
  fieldErrors,
  formValues,
  NoticeBox,
  SelectField,
  SmallButton,
  TextField,
  useAction,
} from './ui';

export function SectionsManager({
  grades,
  branches,
  years,
  branchId,
  yearId,
  sections,
  canManage,
}: {
  grades: Grade[];
  branches: Branch[];
  years: AcademicYear[];
  branchId: string | null;
  yearId: string | null;
  sections: Section[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { busy, notice, run } = useAction();
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>({});
  const branch = branches.find((b) => b.id === branchId);
  const year = years.find((y) => y.id === yearId);
  const writable =
    canManage && branch?.isActive === true && year !== undefined && year.status !== 'CLOSED';

  function select(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    router.push(
      `/settings/grades?branch=${encodeURIComponent(v.branch ?? '')}&year=${encodeURIComponent(v.year ?? '')}`,
    );
  }

  async function add(grade: Grade, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!branchId || !yearId) return;
    const form = e.currentTarget;
    const values = formValues(form);
    const parsed = sectionSchema.safeParse({
      ...values,
      capacity: values.capacity ? values.capacity : null,
    });
    if (!parsed.success) {
      setErrors({ ...errors, [grade.id]: fieldErrors(parsed.error.issues) });
      return;
    }
    setErrors({ ...errors, [grade.id]: {} });
    const body = { ...parsed.data, branchId, academicYearId: yearId, gradeId: grade.id };
    if (
      await run(
        () => bffApi('sections', { method: 'POST', body }),
        `Section ${parsed.data.name} added to ${grade.name}.`,
      )
    )
      form.reset();
  }

  function move(list: Section[], index: number, delta: -1 | 1, grade: Grade) {
    const ids = list.map((s) => s.id);
    const a = ids[index];
    const b = ids[index + delta];
    if (!a || !b || !branchId || !yearId) return;
    ids[index] = b;
    ids[index + delta] = a;
    void run(
      () =>
        bffApi('sections/order', {
          method: 'PUT',
          body: { branchId, academicYearId: yearId, gradeId: grade.id, ids },
        }),
      `${grade.name} section order saved.`,
    );
  }

  const visibleGrades = grades.filter(
    (g) => g.isActive || sections.some((s) => s.gradeId === g.id),
  );

  return (
    <Card title="Sections">
      <div className="flex flex-col gap-4">
        <form
          onSubmit={select}
          className="flex flex-wrap items-end gap-3"
          aria-label="Choose branch and academic year"
        >
          <SelectField
            idPrefix="sections"
            name="branch"
            label="Branch"
            defaultValue={branchId ?? ''}
            options={branches.map((b) => ({
              value: b.id,
              label: `${b.name}${b.isActive ? '' : ' (inactive)'}`,
            }))}
          />
          <SelectField
            idPrefix="sections"
            name="year"
            label="Academic year"
            defaultValue={yearId ?? ''}
            options={years.map((y) => ({
              value: y.id,
              label: `${y.name}${y.isCurrent ? ' (current)' : ''}`,
            }))}
          />
          <Button type="submit" variant="secondary">
            Show sections
          </Button>
        </form>
        <NoticeBox notice={notice} />
        {!branch || !year ? (
          <EmptyState title="Set up a branch and an academic year first">
            Sections belong to a grade at one branch for one academic year.
          </EmptyState>
        ) : visibleGrades.length === 0 ? (
          <EmptyState title="No grades yet">
            Add grades above, then create their sections here.
          </EmptyState>
        ) : (
          <>
            {canManage && !writable ? (
              <Alert tone="info">
                {year.status === 'CLOSED'
                  ? 'This academic year is closed — sections can no longer be added.'
                  : 'This branch is inactive — sections cannot be added.'}
              </Alert>
            ) : null}
            <ul className="flex flex-col gap-4" data-testid="sections-by-grade">
              {visibleGrades.map((g) => {
                const list = sections.filter((s) => s.gradeId === g.id);
                const errs = errors[g.id] ?? {};
                return (
                  <li key={g.id} className="rounded-md border border-slate-200 p-3">
                    <h3 className="text-sm font-semibold">
                      {g.name} <span className="font-mono text-xs text-slate-500">{g.code}</span>
                    </h3>
                    {list.length === 0 ? (
                      <p className="mt-1 text-xs text-slate-500">
                        No sections for this branch and year.
                      </p>
                    ) : (
                      <ol className="mt-2 flex flex-col gap-1" aria-label={`${g.name} sections`}>
                        {list.map((s, i) => (
                          <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="font-medium">{s.name}</span>
                            <span className="font-mono text-xs text-slate-500">{s.code}</span>
                            <span className="text-xs text-slate-500">
                              {s.capacity ? `capacity ${String(s.capacity)}` : 'no capacity set'}
                            </span>
                            {!s.isActive ? <Badge>Inactive</Badge> : null}
                            {canManage ? (
                              <span className="ml-auto flex flex-wrap gap-2">
                                <SmallButton
                                  disabled={busy || i === 0}
                                  label={`Move section ${s.name} up`}
                                  onClick={() => move(list, i, -1, g)}
                                >
                                  ↑
                                </SmallButton>
                                <SmallButton
                                  disabled={busy || i === list.length - 1}
                                  label={`Move section ${s.name} down`}
                                  onClick={() => move(list, i, 1, g)}
                                >
                                  ↓
                                </SmallButton>
                                <SmallButton
                                  disabled={busy}
                                  label={`${s.isActive ? 'Deactivate' : 'Activate'} section ${s.name}`}
                                  onClick={() =>
                                    void run(
                                      () =>
                                        bffApi(
                                          `sections/${s.id}/${s.isActive ? 'deactivate' : 'activate'}`,
                                          { method: 'POST' },
                                        ),
                                      `Section ${s.name} ${s.isActive ? 'deactivated' : 'activated'}.`,
                                    )
                                  }
                                >
                                  {s.isActive ? 'Deactivate' : 'Activate'}
                                </SmallButton>
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    )}
                    {writable && g.isActive ? (
                      <form
                        onSubmit={(e) => void add(g, e)}
                        className="mt-3 flex flex-wrap items-end gap-3"
                        noValidate
                        aria-label={`Add section to ${g.name}`}
                      >
                        <TextField
                          idPrefix={`sec-${g.id}`}
                          name="name"
                          label="Section name"
                          hint="e.g. A"
                          required
                          error={errs.name}
                        />
                        <TextField
                          idPrefix={`sec-${g.id}`}
                          name="code"
                          label="Code"
                          required
                          maxLength={20}
                          error={errs.code}
                        />
                        <TextField
                          idPrefix={`sec-${g.id}`}
                          name="capacity"
                          type="number"
                          min={1}
                          label="Capacity (optional)"
                          error={errs.capacity}
                        />
                        <Button type="submit" variant="secondary" disabled={busy}>
                          Add section
                        </Button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}
