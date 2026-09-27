'use client';

import type { Grade, GradeSubject, Subject } from '@acadlyx/types';
import { subjectSchema } from '@acadlyx/validation';
import { Badge, Button, Card, EmptyState } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { bffApi } from '@/lib/bff-client';
import {
  Disclosure,
  fieldErrors,
  formValues,
  NoticeBox,
  SelectField,
  SmallButton,
  TextField,
  useAction,
} from './ui';

export function SubjectsManager({
  subjects,
  query,
  canManage,
}: {
  subjects: Subject[];
  query: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const { busy, notice, run } = useAction();
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const parsed = subjectSchema.safeParse(formValues(form));
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    if (
      await run(
        () => bffApi('subjects', { method: 'POST', body: parsed.data }),
        `${parsed.data.name} added.`,
      )
    )
      form.reset();
  }

  async function edit(s: Subject, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = subjectSchema.safeParse(formValues(e.currentTarget));
    if (!parsed.success) return;
    await run(
      () => bffApi(`subjects/${s.id}`, { method: 'PATCH', body: parsed.data }),
      `${parsed.data.name} saved.`,
    );
  }

  return (
    <Card title="Subject catalogue">
      <div className="flex flex-col gap-4">
        <form
          role="search"
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const q = formValues(e.currentTarget).q ?? '';
            router.push(q ? `/settings/subjects?q=${encodeURIComponent(q)}` : '/settings/subjects');
          }}
        >
          <TextField
            idPrefix="subjects"
            name="q"
            type="search"
            label="Search subjects"
            defaultValue={query}
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <NoticeBox notice={notice} />
        {canManage ? (
          <Disclosure
            summary="Add a subject"
            testId="add-subject"
            open={subjects.length === 0 && !query}
          >
            <form
              onSubmit={(e) => void create(e)}
              className="flex flex-wrap items-end gap-3"
              noValidate
              aria-label="Create subject"
            >
              <TextField
                idPrefix="new-subject"
                name="name"
                label="Subject name"
                hint="e.g. Hindi (Second Language)"
                required
                error={errors.name}
              />
              <TextField
                idPrefix="new-subject"
                name="code"
                label="Code"
                hint="e.g. HIN"
                required
                maxLength={20}
                error={errors.code}
              />
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Add subject'}
              </Button>
            </form>
          </Disclosure>
        ) : null}
        {subjects.length === 0 ? (
          <EmptyState title={query ? 'No subjects match your search' : 'No subjects yet'}>
            {query ? 'Try another name or code.' : 'Add the subjects your school teaches.'}
          </EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100" data-testid="subjects-list">
            {subjects.map((s) => (
              <li key={s.id} className="flex flex-col gap-2 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  <span className="font-mono text-xs text-slate-500">{s.code}</span>
                  {!s.isActive ? <Badge>Inactive</Badge> : null}
                  {canManage ? (
                    <span className="ml-auto">
                      <SmallButton
                        disabled={busy}
                        label={`${s.isActive ? 'Deactivate' : 'Activate'} ${s.name}`}
                        onClick={() =>
                          void run(
                            () =>
                              bffApi(`subjects/${s.id}/${s.isActive ? 'deactivate' : 'activate'}`, {
                                method: 'POST',
                              }),
                            `${s.name} ${s.isActive ? 'deactivated' : 'activated'}.`,
                          )
                        }
                      >
                        {s.isActive ? 'Deactivate' : 'Activate'}
                      </SmallButton>
                    </span>
                  ) : null}
                </div>
                {canManage ? (
                  <details>
                    <summary className="cursor-pointer text-xs text-slate-600 underline">
                      Edit {s.name}
                    </summary>
                    <form
                      onSubmit={(e) => void edit(s, e)}
                      className="mt-2 flex flex-wrap items-end gap-3"
                      aria-label={`Edit ${s.name}`}
                    >
                      <TextField
                        idPrefix={`subject-${s.id}`}
                        name="name"
                        label="Name"
                        defaultValue={s.name}
                        required
                      />
                      <TextField
                        idPrefix={`subject-${s.id}`}
                        name="code"
                        label="Code"
                        defaultValue={s.code}
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
          </ul>
        )}
      </div>
    </Card>
  );
}

export function GradeSubjectsPanel({
  grades,
  gradeId,
  subjects,
  mapping,
  canManage,
}: {
  grades: Grade[];
  gradeId: string;
  subjects: Subject[];
  mapping: GradeSubject[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { busy, notice, run } = useAction();
  const grade = grades.find((g) => g.id === gradeId);
  const assigned = new Set(mapping.map((m) => m.subjectId));
  const available = subjects.filter((s) => s.isActive && !assigned.has(s.id));
  const put = (subjectId: string, isRequired: boolean, done: string) =>
    void run(
      () =>
        bffApi(`grades/${gradeId}/subjects/${subjectId}`, { method: 'PUT', body: { isRequired } }),
      done,
    );

  return (
    <Card title="Subjects by grade">
      <div className="flex flex-col gap-4">
        <form
          className="flex flex-wrap items-end gap-3"
          aria-label="Choose grade"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(
              `/settings/subjects?grade=${encodeURIComponent(formValues(e.currentTarget).grade ?? '')}`,
            );
          }}
        >
          <SelectField
            idPrefix="grade-subjects"
            name="grade"
            label="Grade"
            defaultValue={gradeId}
            options={grades.map((g) => ({
              value: g.id,
              label: `${g.name}${g.isActive ? '' : ' (inactive)'}`,
            }))}
          />
          <Button type="submit" variant="secondary">
            Show subjects
          </Button>
        </form>
        <NoticeBox notice={notice} />
        {mapping.length === 0 ? (
          <EmptyState title={`No subjects assigned to ${grade?.name ?? 'this grade'}`} />
        ) : (
          <ul className="flex flex-col gap-1" data-testid="grade-subjects">
            {mapping.map((m) => (
              <li key={m.subjectId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{m.subjectName}</span>
                <span className="font-mono text-xs text-slate-500">{m.subjectCode}</span>
                <Badge tone={m.isRequired ? 'info' : 'neutral'}>
                  {m.isRequired ? 'Required' : 'Optional'}
                </Badge>
                {!m.subjectIsActive ? <Badge tone="warning">Subject inactive</Badge> : null}
                {canManage ? (
                  <span className="ml-auto flex gap-2">
                    <SmallButton
                      disabled={busy}
                      label={`Make ${m.subjectName} ${m.isRequired ? 'optional' : 'required'}`}
                      onClick={() =>
                        put(
                          m.subjectId,
                          !m.isRequired,
                          `${m.subjectName} is now ${m.isRequired ? 'optional' : 'required'}.`,
                        )
                      }
                    >
                      {m.isRequired ? 'Make optional' : 'Make required'}
                    </SmallButton>
                    <SmallButton
                      disabled={busy}
                      label={`Remove ${m.subjectName} from ${grade?.name ?? 'grade'}`}
                      onClick={() =>
                        void run(
                          () =>
                            bffApi(`grades/${gradeId}/subjects/${m.subjectId}`, {
                              method: 'DELETE',
                            }),
                          `${m.subjectName} removed.`,
                        )
                      }
                    >
                      Remove
                    </SmallButton>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canManage && grade?.isActive && available.length > 0 ? (
          <form
            className="flex flex-wrap items-end gap-3"
            aria-label={`Assign a subject to ${grade.name}`}
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const v = formValues(form);
              const subject = available.find((s) => s.id === v.subjectId);
              if (!subject) return;
              // Back to defaults (Required checked) so the next assignment starts clean.
              void run(
                () =>
                  bffApi(`grades/${gradeId}/subjects/${subject.id}`, {
                    method: 'PUT',
                    body: { isRequired: v.required === 'on' },
                  }),
                `${subject.name} assigned to ${grade.name}.`,
              ).then((ok) => {
                if (ok) form.reset();
              });
            }}
          >
            <SelectField
              idPrefix="assign"
              name="subjectId"
              label="Subject"
              options={available.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
            />
            <label className="inline-flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" name="required" defaultChecked className="h-4 w-4" /> Required
            </label>
            <Button type="submit" disabled={busy}>
              Assign subject
            </Button>
          </form>
        ) : null}
      </div>
    </Card>
  );
}
