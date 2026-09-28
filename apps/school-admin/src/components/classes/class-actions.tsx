'use client';

import type { Paginated } from '@acadlyx/tenant-config';
import type { ClassDetail, StudentSummary, TeacherAssignmentType } from '@acadlyx/types';
import { Button } from '@acadlyx/web-ui';
import { useId, useState } from 'react';
import { bffApi } from '@/lib/bff-client';
import { personName } from '../people/shared';
import { ConfirmDialog } from '../shell/confirm-dialog';
import { formValues, NoticeBox, SelectField, TextField, useAction } from '../setup/ui';

/**
 * Enroll an existing student into this class — the Phase 5 enrollment endpoint (same rules:
 * one ACTIVE enrollment per year, no closed years/inactive sections). Moving a student who is
 * already placed is a transfer, done from the student's page.
 */
export function EnrollIntoClass({ sectionId }: { sectionId: string }) {
  const { busy, notice, run, setNotice } = useAction();
  const [matches, setMatches] = useState<StudentSummary[] | null>(null);
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <NoticeBox notice={notice} />
      <form
        role="search"
        aria-label="Find a student to enroll"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const { q } = formValues(e.currentTarget);
          if (!q || q.length < 2) {
            setNotice({ tone: 'danger', messages: ['Type at least 2 characters.'] });
            return;
          }
          setNotice(null);
          bffApi<Paginated<StudentSummary>>(
            `students?${new URLSearchParams({ q, status: 'ACTIVE', pageSize: '10' }).toString()}`,
          )
            .then((r) => {
              setMatches(r.items);
            })
            .catch(() => {
              setNotice({ tone: 'danger', messages: ['Search failed. Please try again.'] });
            });
        }}
      >
        <TextField
          idPrefix={id}
          name="q"
          type="search"
          label="Find student"
          hint="Name or admission number"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      {matches ? (
        matches.length === 0 ? (
          <p className="text-sm text-slate-600" role="status">
            No active students match.
          </p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Matching students">
            {matches.map((s) => {
              const here = s.currentPlacement?.sectionId === sectionId;
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 px-3 py-2 text-sm"
                >
                  <span>
                    <span className="font-medium">{personName(s)}</span>{' '}
                    <span className="font-mono text-xs text-slate-500">{s.admissionNumber}</span>
                    <span className="block text-xs text-slate-500">
                      {s.currentPlacement
                        ? `Currently in ${s.currentPlacement.gradeName} ${s.currentPlacement.sectionName} (${s.currentPlacement.academicYearName})`
                        : 'Not placed in a class'}
                    </span>
                  </span>
                  <Button
                    variant="secondary"
                    className="px-2 py-1 text-xs"
                    disabled={busy || here}
                    aria-label={`Enroll ${personName(s)} in this class`}
                    onClick={() => {
                      void run(
                        () =>
                          bffApi(`students/${s.id}/enrollments`, {
                            method: 'POST',
                            body: { sectionId },
                          }),
                        `${personName(s)} enrolled.`,
                      ).then((ok) => {
                        if (ok) setMatches(null);
                      });
                    }}
                  >
                    {here ? 'Already here' : 'Enroll'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </div>
  );
}

/** Assign a teacher to this class (Phase 5 rules: active teacher; subject must be in the grade). */
export function AssignTeacher({
  sectionId,
  teachers,
  subjects,
}: {
  sectionId: string;
  teachers: { id: string; label: string }[];
  subjects: NonNullable<ClassDetail['subjects']>;
}) {
  const { busy, notice, run } = useAction();
  const [type, setType] = useState<TeacherAssignmentType>('SUBJECT_TEACHER');
  const id = useId();
  if (teachers.length === 0)
    return <p className="text-sm text-slate-600">No active teachers yet. Add teachers first.</p>;
  return (
    <form
      className="flex flex-col gap-3"
      aria-label="Assign a teacher"
      onSubmit={(e) => {
        e.preventDefault();
        const v = formValues(e.currentTarget);
        void run(
          () =>
            bffApi(`teachers/${v.teacherId ?? ''}/assignments`, {
              method: 'POST',
              body:
                type === 'SUBJECT_TEACHER'
                  ? { type, sectionId, subjectId: v.subjectId }
                  : { type, sectionId },
            }),
          'Teacher assigned.',
        );
      }}
    >
      <NoticeBox notice={notice} />
      <div className="flex flex-wrap items-end gap-3">
        <SelectField
          idPrefix={id}
          name="teacherId"
          label="Teacher"
          options={teachers.map((t) => ({ value: t.id, label: t.label }))}
        />
        <SelectField
          idPrefix={id}
          name="type"
          label="Role in class"
          value={type}
          onChange={(e) => {
            setType(e.target.value as TeacherAssignmentType);
          }}
          options={[
            { value: 'SUBJECT_TEACHER', label: 'Subject teacher' },
            { value: 'CLASS_TEACHER', label: 'Class teacher' },
          ]}
        />
        {type === 'SUBJECT_TEACHER' ? (
          subjects.length ? (
            <SelectField
              idPrefix={id}
              name="subjectId"
              label="Subject"
              options={subjects.map((s) => ({ value: s.id, label: s.name }))}
            />
          ) : (
            <p className="text-sm text-slate-600">No subjects are configured for this grade.</p>
          )
        ) : null}
        <Button
          type="submit"
          disabled={busy || (type === 'SUBJECT_TEACHER' && subjects.length === 0)}
        >
          Assign
        </Button>
      </div>
    </form>
  );
}

/** Soft-ends an assignment (history is kept) after confirmation. */
export function EndAssignmentButton({
  teacherId,
  assignmentId,
  label,
}: {
  teacherId: string;
  assignmentId: string;
  label: string;
}) {
  const { busy, notice, run } = useAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <NoticeBox notice={notice} />
      <Button
        variant="secondary"
        className="px-2 py-1 text-xs"
        aria-label={`Remove ${label}`}
        onClick={() => {
          setOpen(true);
        }}
      >
        Remove
      </Button>
      <ConfirmDialog
        open={open}
        title="Remove this assignment?"
        confirmLabel="Remove assignment"
        busy={busy}
        onCancel={() => {
          setOpen(false);
        }}
        onConfirm={() => {
          void run(
            () =>
              bffApi(`teachers/${teacherId}/assignments/${assignmentId}/end`, { method: 'POST' }),
            'Assignment ended.',
          ).then(() => {
            setOpen(false);
          });
        }}
      >
        {label} will no longer be assigned to this class. The history is kept.
      </ConfirmDialog>
    </>
  );
}
