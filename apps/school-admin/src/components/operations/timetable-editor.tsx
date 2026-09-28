'use client';

import type { TimetablePeriod, TimetablePeriodType, Weekday } from '@acadlyx/types';
import { timetablePeriodSchema } from '@acadlyx/validation';
import { Button } from '@acadlyx/web-ui';
import { useId, useState } from 'react';
import { bffApi } from '@/lib/bff-client';
import { ConfirmDialog } from '../shell/confirm-dialog';
import { fieldErrors, formValues, NoticeBox, SelectField, TextField, useAction } from '../setup/ui';

const DAY: Record<Weekday, string> = {
  MONDAY: 'Monday',
  TUESDAY: 'Tuesday',
  WEDNESDAY: 'Wednesday',
  THURSDAY: 'Thursday',
  FRIDAY: 'Friday',
  SATURDAY: 'Saturday',
  SUNDAY: 'Sunday',
};
const TYPES: { value: TimetablePeriodType; label: string }[] = [
  { value: 'INSTRUCTIONAL', label: 'Lesson' },
  { value: 'BREAK', label: 'Break' },
  { value: 'LUNCH', label: 'Lunch' },
  { value: 'ASSEMBLY', label: 'Assembly' },
];

/**
 * Adds a lesson to a class's week. Choices come from the class (its grade's subjects and the
 * teachers who hold a subject assignment in it); the API re-validates everything and reports
 * conflicts as plain language ("This teacher is already scheduled during this time").
 */
export function AddLesson({
  sectionId,
  workingDays,
  periods,
  pairs,
}: {
  sectionId: string;
  workingDays: Weekday[];
  periods: { id: string; label: string }[];
  pairs: { subjectId: string; subjectName: string; teacherId: string; teacherName: string }[];
}) {
  const id = useId();
  const { busy, notice, run } = useAction();
  if (periods.length === 0)
    return <p className="text-sm text-slate-600">Add lesson periods to the bell schedule first.</p>;
  if (pairs.length === 0)
    return (
      <p className="text-sm text-slate-600">
        No teacher is assigned to a subject in this class yet. Assign teachers from the class page.
      </p>
    );
  return (
    <form
      aria-label="Add a lesson"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const v = formValues(e.currentTarget);
        const [subjectId, teacherId] = (v.pair ?? ':').split(':');
        void run(
          () =>
            bffApi('timetable/entries', {
              method: 'POST',
              body: { sectionId, weekday: v.weekday, periodId: v.periodId, subjectId, teacherId },
            }),
          'Lesson added.',
        );
      }}
    >
      <NoticeBox notice={notice} />
      <div className="flex flex-wrap items-end gap-3">
        <SelectField
          idPrefix={id}
          name="weekday"
          label="Day"
          options={workingDays.map((d) => ({ value: d, label: DAY[d] }))}
        />
        <SelectField
          idPrefix={id}
          name="periodId"
          label="Period"
          options={periods.map((p) => ({ value: p.id, label: p.label }))}
        />
        <SelectField
          idPrefix={id}
          name="pair"
          label="Subject and teacher"
          options={pairs.map((p) => ({
            value: `${p.subjectId}:${p.teacherId}`,
            label: `${p.subjectName} — ${p.teacherName}`,
          }))}
        />
        <Button type="submit" disabled={busy}>
          Add lesson
        </Button>
      </div>
    </form>
  );
}

/** Removes one lesson after confirmation (the current timetable only; changes are audited). */
export function RemoveLesson({ entryId, label }: { entryId: string; label: string }) {
  const { busy, notice, run } = useAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <NoticeBox notice={notice} />
      <button
        type="button"
        className="text-xs underline"
        aria-label={`Remove ${label}`}
        onClick={() => {
          setOpen(true);
        }}
      >
        Remove
      </button>
      <ConfirmDialog
        open={open}
        title="Remove this lesson?"
        confirmLabel="Remove lesson"
        busy={busy}
        onCancel={() => {
          setOpen(false);
        }}
        onConfirm={() => {
          void run(
            () => bffApi(`timetable/entries/${entryId}`, { method: 'DELETE' }),
            'Lesson removed.',
          ).then(() => {
            setOpen(false);
          });
        }}
      >
        {label} will be removed from the weekly timetable.
      </ConfirmDialog>
    </>
  );
}

/** Bell-schedule setup for one branch + academic year: add, retime/retype, reorder, remove. */
export function PeriodsManager({
  branchId,
  academicYearId,
  periods,
  editable,
}: {
  branchId: string;
  academicYearId: string;
  periods: TimetablePeriod[];
  editable: boolean;
}) {
  const id = useId();
  const { busy, notice, setNotice, run } = useAction();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<TimetablePeriod | null>(null);

  const move = (index: number, delta: number) => {
    const ids = periods.map((p) => p.id);
    const [moved] = ids.splice(index, 1);
    if (!moved) return;
    ids.splice(index + delta, 0, moved);
    void run(
      () =>
        bffApi('timetable/periods/order', {
          method: 'PUT',
          body: { branchId, academicYearId, ids },
        }),
      'Order saved.',
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <NoticeBox notice={notice} />
      {periods.length === 0 ? (
        <p className="text-sm text-slate-600">No periods yet for this branch and academic year.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm" data-testid="periods-table">
            <caption className="sr-only">Bell schedule periods in order</caption>
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Period
                </th>
                <th scope="col" className="px-3 py-2">
                  Type
                </th>
                <th scope="col" className="px-3 py-2">
                  Time
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Lessons
                </th>
                {editable ? (
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {periods.map((p, i) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <th scope="row" className="px-3 py-2 font-medium">
                    {p.name}
                  </th>
                  <td className="px-3 py-2">{TYPES.find((t) => t.value === p.type)?.label}</td>
                  <td className="px-3 py-2">
                    {p.startTime}–{p.endTime}
                  </td>
                  <td className="px-3 py-2 text-right">{p.entryCount}</td>
                  {editable ? (
                    <td className="px-3 py-2 text-right">
                      <span className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="text-xs underline disabled:opacity-40"
                          disabled={busy || i === 0}
                          aria-label={`Move ${p.name} up`}
                          onClick={() => {
                            move(i, -1);
                          }}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className="text-xs underline disabled:opacity-40"
                          disabled={busy || i === periods.length - 1}
                          aria-label={`Move ${p.name} down`}
                          onClick={() => {
                            move(i, 1);
                          }}
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          className="text-xs underline disabled:opacity-40"
                          disabled={busy || p.entryCount > 0}
                          aria-label={
                            p.entryCount > 0
                              ? `${p.name} has lessons and cannot be removed`
                              : `Remove ${p.name}`
                          }
                          onClick={() => {
                            setRemoving(p);
                          }}
                        >
                          Remove
                        </button>
                      </span>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editable ? (
        <form
          aria-label="Add a period"
          noValidate
          className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const parsed = timetablePeriodSchema.safeParse(formValues(form));
            if (!parsed.success) {
              const errs = fieldErrors(parsed.error.issues);
              setErrors(errs);
              setNotice({ tone: 'danger', messages: Object.values(errs) });
              return;
            }
            setErrors({});
            void run(
              () =>
                bffApi('timetable/periods', {
                  method: 'POST',
                  body: { ...parsed.data, branchId, academicYearId },
                }),
              'Period added.',
            ).then((ok) => {
              if (ok) form.reset();
            });
          }}
        >
          <TextField
            idPrefix={id}
            name="name"
            label="Name"
            placeholder="Period 1"
            error={errors.name}
          />
          <SelectField idPrefix={id} name="type" label="Type" options={TYPES} />
          <TextField
            idPrefix={id}
            name="startTime"
            type="time"
            label="Starts"
            error={errors.startTime}
          />
          <TextField idPrefix={id} name="endTime" type="time" label="Ends" error={errors.endTime} />
          <Button type="submit" disabled={busy}>
            Add period
          </Button>
        </form>
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.name ?? 'period'}?`}
        confirmLabel="Remove period"
        busy={busy}
        onCancel={() => {
          setRemoving(null);
        }}
        onConfirm={() => {
          if (!removing) return;
          void run(
            () => bffApi(`timetable/periods/${removing.id}`, { method: 'DELETE' }),
            'Period removed.',
          ).then(() => {
            setRemoving(null);
          });
        }}
      >
        The period is removed from this branch’s bell schedule.
      </ConfirmDialog>
    </div>
  );
}
