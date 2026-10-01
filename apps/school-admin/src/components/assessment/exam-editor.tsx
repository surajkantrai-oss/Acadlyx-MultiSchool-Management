'use client';

import type { ExamDetail, ExamSubject, ExamTransition } from '@acadlyx/types';
import { COMPONENT_NAME_MAX, EXAM_DESCRIPTION_MAX, EXAM_NAME_MAX } from '@acadlyx/validation';
import { Button, Card, Field, inputClassName } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { bffApi } from '@/lib/bff-client';
import { NoticeBox, SelectField, SmallButton, TextField, formValues, useAction } from '../setup/ui';

const TRANSITION: Record<ExamTransition, { label: string; confirm: string }> = {
  publish: {
    label: 'Publish schedule',
    confirm: 'Publish this exam? Teachers will see it and the structure becomes read-only.',
  },
  'open-marks': { label: 'Open marks entry', confirm: 'Open marks entry for teachers?' },
  'finalize-marks': {
    label: 'Finalize all marks',
    confirm: 'Finalize marks for the whole exam? Every mark sheet must already be finalized.',
  },
  archive: { label: 'Archive exam', confirm: 'Archive this exam? It becomes read-only.' },
};

export function ExamForm({
  years,
  scales,
  exam,
}: {
  years: { id: string; name: string; isCurrent: boolean }[];
  scales: { id: string; name: string; academicYearId: string }[];
  exam: ExamDetail | null;
}) {
  const router = useRouter();
  const { busy, notice, setNotice, run } = useAction();
  const [yearId, setYearId] = useState(
    exam?.academicYearId ?? years.find((y) => y.isCurrent)?.id ?? years[0]?.id ?? '',
  );
  async function submit(form: HTMLFormElement) {
    const v = formValues(form);
    if (!v.name || !v.startDate || !v.endDate) {
      setNotice({ tone: 'danger', messages: ['Name, start date and end date are required.'] });
      return;
    }
    const body = {
      name: v.name,
      description: v.description || null,
      startDate: v.startDate,
      endDate: v.endDate,
      gradeScaleId: v.gradeScaleId || null,
    };
    if (exam) {
      await run(
        () =>
          bffApi(`exams/${exam.id}`, {
            method: 'PATCH',
            body: { ...body, expectedVersion: exam.version },
          }),
        'Exam details saved.',
      );
    } else {
      let created: ExamDetail | null = null;
      const ok = await run(async () => {
        created = await bffApi<ExamDetail>('exams', {
          method: 'POST',
          body: { ...body, academicYearId: yearId },
        });
      }, 'Exam created.');
      if (ok && created) router.push(`/exams/${(created as ExamDetail).id}`);
    }
  }
  return (
    <form
      className="grid max-w-2xl gap-4"
      data-testid="exam-form"
      onSubmit={(ev) => {
        ev.preventDefault();
        void submit(ev.currentTarget);
      }}
    >
      <NoticeBox notice={notice} />
      {exam ? null : (
        <SelectField
          idPrefix="exam"
          name="academicYearId"
          label="Academic year"
          value={yearId}
          onChange={(e) => setYearId(e.target.value)}
          options={years.map((y) => ({ value: y.id, label: y.name }))}
        />
      )}
      <TextField
        idPrefix="exam"
        name="name"
        label="Exam name"
        required
        maxLength={EXAM_NAME_MAX}
        defaultValue={exam?.name ?? ''}
      />
      <Field
        id="exam-description"
        label="Description (optional)"
        hint={`Up to ${String(EXAM_DESCRIPTION_MAX)} characters`}
      >
        <textarea
          id="exam-description"
          name="description"
          rows={3}
          maxLength={EXAM_DESCRIPTION_MAX}
          className={inputClassName}
          defaultValue={exam?.description ?? ''}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          idPrefix="exam"
          name="startDate"
          label="Start date"
          type="date"
          required
          defaultValue={exam?.startDate ?? ''}
        />
        <TextField
          idPrefix="exam"
          name="endDate"
          label="End date"
          type="date"
          required
          defaultValue={exam?.endDate ?? ''}
        />
      </div>
      <SelectField
        idPrefix="exam"
        name="gradeScaleId"
        label="Grade scale"
        hint="Optional. Without a scale, results show marks and percentages only."
        defaultValue={exam?.gradeScale?.id ?? ''}
        options={[
          { value: '', label: 'No grade scale' },
          ...scales
            .filter((s) => s.academicYearId === (exam?.academicYearId ?? yearId))
            .map((s) => ({ value: s.id, label: s.name })),
        ]}
      />
      <div>
        <Button type="submit" disabled={busy}>
          {exam ? 'Save details' : 'Create exam'}
        </Button>
      </div>
    </form>
  );
}

export function ExamLifecycle({ exam }: { exam: ExamDetail }) {
  const router = useRouter();
  const { busy, notice, run } = useAction();
  if (exam.can.transitions.length === 0 && !exam.can.delete) return <NoticeBox notice={notice} />;
  return (
    <div className="space-y-2" data-testid="exam-lifecycle">
      <NoticeBox notice={notice} />
      <div className="flex flex-wrap gap-2">
        {exam.can.transitions.map((t) => (
          <Button
            key={t}
            variant={t === 'archive' ? 'secondary' : 'primary'}
            disabled={busy}
            onClick={() => {
              if (!window.confirm(TRANSITION[t].confirm)) return;
              void run(
                () =>
                  bffApi(`exams/${exam.id}/transitions/${t}`, {
                    method: 'POST',
                    body: { expectedVersion: exam.version },
                  }),
                'Exam status updated.',
              );
            }}
          >
            {TRANSITION[t].label}
          </Button>
        ))}
        {exam.can.delete ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              if (!window.confirm('Delete this draft exam permanently?')) return;
              void run(
                () => bffApi(`exams/${exam.id}`, { method: 'DELETE' }),
                'Exam deleted.',
              ).then((ok) => ok && router.push('/exams'));
            }}
          >
            Delete draft
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function ExamStructure({
  exam,
  editable,
  grades,
  subjects,
}: {
  exam: ExamDetail;
  editable: boolean;
  grades: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
}) {
  const { busy, notice, setNotice, run } = useAction();
  const base = `exams/${exam.id}`;
  const byGrade = new Map<string, { name: string; subjects: ExamSubject[] }>();
  for (const s of exam.subjects) {
    const g = byGrade.get(s.gradeId) ?? { name: s.gradeName, subjects: [] };
    g.subjects.push(s);
    byGrade.set(s.gradeId, g);
  }
  const branchesFor = (gradeId: string) =>
    exam.branchesByGrade.find((b) => b.gradeId === gradeId)?.branches ?? [];
  return (
    <Card title="Subjects and papers">
      <div className="space-y-4" data-testid="exam-structure">
        <NoticeBox notice={notice} />
        {exam.subjects.length === 0 ? (
          <p className="text-sm text-slate-600">No subjects yet.</p>
        ) : null}
        {[...byGrade.entries()].map(([gradeId, g]) => (
          <section key={gradeId} className="space-y-3">
            <h3 className="text-base font-semibold">{g.name}</h3>
            {g.subjects.map((s) => (
              <div
                key={s.id}
                className="rounded-md border border-slate-200 p-3"
                data-testid={`exam-subject-${s.subjectName}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {s.subjectName}{' '}
                    <span className="text-sm font-normal text-slate-600">
                      · total {s.totalMaxMarks}
                      {s.passMarks
                        ? ` · subject pass mark ${s.passMarks}`
                        : ' · no subject pass mark'}
                    </span>
                  </p>
                  {editable ? (
                    <div className="flex gap-2">
                      <SmallButton
                        disabled={busy}
                        onClick={() => {
                          const v = window.prompt(
                            'Subject pass mark (blank for none)',
                            s.passMarks ?? '',
                          );
                          if (v === null) return;
                          void run(
                            () =>
                              bffApi(`${base}/subjects/${s.id}`, {
                                method: 'PATCH',
                                body: { passMarks: v.trim() || null },
                              }),
                            'Pass mark saved.',
                          );
                        }}
                      >
                        Pass mark
                      </SmallButton>
                      <SmallButton
                        disabled={busy}
                        label={`Remove ${s.subjectName}`}
                        onClick={() => {
                          if (!window.confirm(`Remove ${s.subjectName} from this exam?`)) return;
                          void run(
                            () => bffApi(`${base}/subjects/${s.id}`, { method: 'DELETE' }),
                            'Subject removed.',
                          );
                        }}
                      >
                        Remove
                      </SmallButton>
                    </div>
                  ) : null}
                </div>
                <ul className="mt-2 space-y-2 text-sm">
                  {s.components.map((c) => (
                    <li key={c.id} className="rounded bg-slate-50 p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          <strong>{c.name}</strong> — max {c.maxMarks}
                          {c.passMarks ? `, pass ${c.passMarks}` : ''}
                        </span>
                        {editable ? (
                          <SmallButton
                            disabled={busy}
                            label={`Remove ${c.name}`}
                            onClick={() => {
                              if (!window.confirm(`Remove component ${c.name}?`)) return;
                              void run(
                                () => bffApi(`${base}/components/${c.id}`, { method: 'DELETE' }),
                                'Component removed.',
                              );
                            }}
                          >
                            Remove
                          </SmallButton>
                        ) : null}
                      </div>
                      <ul className="mt-1 space-y-1">
                        {branchesFor(gradeId).map((b) => {
                          const sch = c.schedules.find((x) => x.branchId === b.id);
                          return (
                            <li key={b.id} className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-medium">{b.name}:</span>
                              {sch ? (
                                <span>
                                  {sch.examDate} {sch.startTime}–{sch.endTime}
                                </span>
                              ) : (
                                <span className="text-amber-700">Not scheduled</span>
                              )}
                              {editable ? (
                                <ScheduleForm
                                  path={`${base}/components/${c.id}/schedules/${b.id}`}
                                  initial={sch ?? null}
                                  min={exam.startDate}
                                  max={exam.endDate}
                                  busy={busy}
                                  run={run}
                                  label={`${c.name} at ${b.name}`}
                                />
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
                {editable ? (
                  <form
                    className="mt-2 flex flex-wrap items-end gap-2"
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      const form = ev.currentTarget;
                      const v = formValues(form);
                      if (!v.name || !v.maxMarks) {
                        setNotice({
                          tone: 'danger',
                          messages: ['Component name and maximum marks are required.'],
                        });
                        return;
                      }
                      void run(
                        () =>
                          bffApi(`${base}/subjects/${s.id}/components`, {
                            method: 'POST',
                            body: {
                              name: v.name,
                              maxMarks: v.maxMarks,
                              passMarks: v.passMarks || null,
                            },
                          }),
                        'Component added.',
                      ).then((ok) => ok && form.reset());
                    }}
                  >
                    <input
                      name="name"
                      aria-label={`New component name for ${s.subjectName}`}
                      placeholder="Component (e.g. Theory)"
                      maxLength={COMPONENT_NAME_MAX}
                      className={inputClassName}
                    />
                    <input
                      name="maxMarks"
                      aria-label="Maximum marks"
                      placeholder="Max"
                      inputMode="decimal"
                      className={`${inputClassName} w-24`}
                    />
                    <input
                      name="passMarks"
                      aria-label="Pass marks (optional)"
                      placeholder="Pass"
                      inputMode="decimal"
                      className={`${inputClassName} w-24`}
                    />
                    <Button type="submit" variant="secondary" disabled={busy}>
                      Add component
                    </Button>
                  </form>
                ) : null}
              </div>
            ))}
          </section>
        ))}
        {editable ? (
          <form
            className="flex flex-wrap items-end gap-2 border-t border-slate-200 pt-4"
            data-testid="add-exam-subject"
            onSubmit={(ev) => {
              ev.preventDefault();
              const v = formValues(ev.currentTarget);
              if (!v.gradeId || !v.subjectId) {
                setNotice({ tone: 'danger', messages: ['Choose a grade and a subject.'] });
                return;
              }
              void run(
                () =>
                  bffApi(`${base}/subjects`, {
                    method: 'POST',
                    body: {
                      gradeId: v.gradeId,
                      subjectId: v.subjectId,
                      passMarks: v.passMarks || null,
                    },
                  }),
                'Subject added.',
              );
            }}
          >
            <SelectField
              idPrefix="exsub"
              name="gradeId"
              label="Grade"
              options={[
                { value: '', label: 'Choose…' },
                ...grades.map((g) => ({ value: g.id, label: g.name })),
              ]}
            />
            <SelectField
              idPrefix="exsub"
              name="subjectId"
              label="Subject"
              options={[
                { value: '', label: 'Choose…' },
                ...subjects.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
            <TextField
              idPrefix="exsub"
              name="passMarks"
              label="Subject pass mark (optional)"
              inputMode="decimal"
            />
            <Button type="submit" disabled={busy}>
              Add subject
            </Button>
          </form>
        ) : null}
      </div>
    </Card>
  );
}

function ScheduleForm({
  path,
  initial,
  min,
  max,
  busy,
  run,
  label,
}: {
  path: string;
  initial: { examDate: string; startTime: string; endTime: string } | null;
  min: string;
  max: string;
  busy: boolean;
  run: (fn: () => Promise<unknown>, success: string) => Promise<boolean>;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <SmallButton disabled={busy} label={`Schedule ${label}`} onClick={() => setOpen(true)}>
        {initial ? 'Change' : 'Schedule'}
      </SmallButton>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-1"
      onSubmit={(ev) => {
        ev.preventDefault();
        const v = formValues(ev.currentTarget);
        void run(
          () =>
            bffApi(path, {
              method: 'PUT',
              body: { examDate: v.examDate, startTime: v.startTime, endTime: v.endTime },
            }),
          'Schedule saved.',
        ).then((ok) => ok && setOpen(false));
      }}
    >
      <input
        type="date"
        name="examDate"
        aria-label={`Date for ${label}`}
        min={min}
        max={max}
        required
        defaultValue={initial?.examDate}
        className={inputClassName}
      />
      <input
        type="time"
        name="startTime"
        aria-label="Start time"
        required
        defaultValue={initial?.startTime}
        className={inputClassName}
      />
      <input
        type="time"
        name="endTime"
        aria-label="End time"
        required
        defaultValue={initial?.endTime}
        className={inputClassName}
      />
      <Button type="submit" disabled={busy} className="px-2 py-1 text-xs">
        Save
      </Button>
      {initial ? (
        <SmallButton
          disabled={busy}
          onClick={() => void run(() => bffApi(path, { method: 'DELETE' }), 'Schedule removed.')}
        >
          Clear
        </SmallButton>
      ) : null}
      <SmallButton onClick={() => setOpen(false)}>Cancel</SmallButton>
    </form>
  );
}
