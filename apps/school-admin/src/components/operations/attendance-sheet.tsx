'use client';

import type { AttendanceSheet, AttendanceStatus } from '@acadlyx/types';
import { ATTENDANCE_NOTE_MAX } from '@acadlyx/validation';
import { Alert, Button } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { BffError, bffApi, friendlyError } from '@/lib/bff-client';
import { personName } from '../people/shared';
import { NoticeBox, type Notice, useUnsavedWarning } from '../setup/ui';

const STATUSES: { value: AttendanceStatus; label: string }[] = [
  { value: 'PRESENT', label: 'Present' },
  { value: 'ABSENT', label: 'Absent' },
  { value: 'LATE', label: 'Late' },
  { value: 'EXCUSED', label: 'Excused' },
];

const LOCKED: Record<NonNullable<AttendanceSheet['lockedReason']>, string> = {
  FUTURE_DATE: 'Attendance cannot be recorded for a future date.',
  OUTSIDE_TEACHER_WINDOW:
    'Teachers can record or correct attendance only for today and the previous 7 calendar days (school-local). Ask a school administrator for older corrections.',
  YEAR_NOT_ACTIVE: 'This academic year is not open for attendance (it is planned or closed).',
  OUTSIDE_YEAR: 'This date is outside the academic year of the class.',
  READ_ONLY:
    'You can view this attendance but not change it (read-only access, or the class is inactive).',
};

interface Mark {
  status: AttendanceStatus | null;
  note: string;
}

/**
 * Roster sheet. "Mark all present" then change exceptions — everything stays local until Save.
 * Each row is a labelled radio group (status text, never colour alone) plus an optional short
 * note. Saving sends the whole roster once with the version it was loaded at; if someone saved
 * in between, the server refuses and nothing is lost silently.
 */
export function AttendanceSheetEditor({ sheet }: { sheet: AttendanceSheet }) {
  const router = useRouter();
  const initial = useMemo(
    () =>
      new Map(
        sheet.roster.map((r) => [r.studentId, { status: r.status, note: r.note ?? '' } as Mark]),
      ),
    [sheet],
  );
  const [marks, setMarks] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const dirty = sheet.roster.some((r) => {
    const m = marks.get(r.studentId);
    return m !== undefined && (m.status !== r.status || m.note !== (r.note ?? ''));
  });
  useUnsavedWarning(dirty);
  const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, UNMARKED: 0 };
  for (const m of marks.values()) counts[m.status ?? 'UNMARKED'] += 1;
  const editable = sheet.editable;
  const set = (id: string, patch: Partial<Mark>) => {
    setMarks((prev) =>
      new Map(prev).set(id, { ...(prev.get(id) ?? { status: null, note: '' }), ...patch }),
    );
  };

  async function save() {
    if (counts.UNMARKED > 0) {
      setNotice({
        tone: 'danger',
        messages: [`Mark every student first (${String(counts.UNMARKED)} still unmarked).`],
      });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await bffApi('attendance', {
        method: 'PUT',
        body: {
          sectionId: sheet.sectionId,
          date: sheet.date,
          ...(sheet.session ? { expectedVersion: sheet.session.version } : {}),
          records: [...marks.entries()].map(([studentId, m]) => ({
            studentId,
            status: m.status,
            note: m.note.trim() || null,
          })),
        },
      });
      setNotice({
        tone: 'success',
        messages: [sheet.session ? 'Attendance corrected.' : 'Attendance saved.'],
      });
      router.refresh();
    } catch (error) {
      const stale = error instanceof BffError && error.status === 409;
      setNotice({
        tone: 'danger',
        messages: stale
          ? [
              'Someone else saved this class’s attendance meanwhile. Reload the page to see their changes, then apply yours again.',
            ]
          : friendlyError(error),
      });
    } finally {
      setBusy(false);
    }
  }

  if (sheet.roster.length === 0)
    return (
      <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
        No students were enrolled in this class on {sheet.date}.
      </p>
    );

  return (
    <section
      aria-labelledby="sheet-heading"
      className="flex flex-col gap-3"
      data-testid="attendance-sheet"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="sheet-heading" className="text-lg font-semibold">
          {sheet.date === sheet.today ? 'Today' : sheet.date}
          <span className="ml-2 text-sm font-normal text-slate-500">
            {sheet.session
              ? `Saved${sheet.session.updatedByName ? ` by ${sheet.session.updatedByName}` : ''}`
              : 'Not recorded yet'}
          </span>
        </h2>
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-slate-700"
          data-testid="attendance-counts"
        >
          Present {counts.PRESENT} · Absent {counts.ABSENT} · Late {counts.LATE} · Excused{' '}
          {counts.EXCUSED}
          {counts.UNMARKED ? ` · Unmarked ${String(counts.UNMARKED)}` : ''}
        </p>
      </div>
      {!editable && sheet.lockedReason ? (
        <Alert tone="info" title="View only">
          {LOCKED[sheet.lockedReason]}
        </Alert>
      ) : null}
      <NoticeBox notice={notice} />
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setMarks((prev) => {
                const next = new Map(prev);
                for (const [id, m] of next) next.set(id, { ...m, status: 'PRESENT' });
                return next;
              });
            }}
          >
            Mark all present
          </Button>
          <Button disabled={busy || !dirty} onClick={() => void save()}>
            {busy ? 'Saving…' : sheet.session ? 'Save corrections' : 'Save attendance'}
          </Button>
          {dirty ? (
            <span className="self-center text-xs text-slate-500">Unsaved changes</span>
          ) : null}
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm" data-testid="attendance-roster">
          <caption className="sr-only">
            Attendance for {sheet.sectionName} on {sheet.date}
          </caption>
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-2">
                Adm. no.
              </th>
              <th scope="col" className="px-3 py-2">
                Student
              </th>
              <th scope="col" className="px-3 py-2">
                Status
              </th>
              <th scope="col" className="px-3 py-2">
                Note (optional)
              </th>
            </tr>
          </thead>
          <tbody>
            {sheet.roster.map((r) => {
              const m = marks.get(r.studentId) ?? { status: null, note: '' };
              const name = personName(r);
              return (
                <tr key={r.studentId} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 font-mono">{r.admissionNumber}</td>
                  <th scope="row" className="px-3 py-2 font-medium">
                    {name}
                    {r.studentStatus !== 'ACTIVE' ? (
                      <span className="block text-xs font-normal text-slate-500">
                        {r.studentStatus.toLowerCase()}
                      </span>
                    ) : null}
                  </th>
                  <td className="px-3 py-2">
                    <fieldset disabled={!editable || busy}>
                      <legend className="sr-only">Attendance for {name}</legend>
                      <div className="flex flex-wrap gap-1">
                        {STATUSES.map((st) => {
                          const on = m.status === st.value;
                          const id = `att-${r.studentId}-${st.value}`;
                          return (
                            <label
                              key={st.value}
                              htmlFor={id}
                              className={`cursor-pointer rounded-md px-2 py-1 text-xs ring-1 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-[var(--brand-primary)] ${
                                on
                                  ? 'bg-slate-900 font-semibold text-white ring-slate-900'
                                  : 'bg-white ring-slate-300'
                              }`}
                            >
                              <input
                                id={id}
                                type="radio"
                                className="sr-only"
                                name={`att-${r.studentId}`}
                                value={st.value}
                                checked={on}
                                onChange={() => {
                                  set(r.studentId, { status: st.value });
                                }}
                              />
                              <span aria-hidden="true">{on ? '✓ ' : ''}</span>
                              {st.label}
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      aria-label={`Note for ${name}`}
                      maxLength={ATTENDANCE_NOTE_MAX}
                      value={m.note}
                      disabled={!editable || busy}
                      placeholder={editable ? 'e.g. bus delay' : ''}
                      onChange={(e) => {
                        set(r.studentId, { note: e.target.value });
                      }}
                      className="w-full min-w-40 rounded-md border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Notes are for brief operational context only (max {ATTENDANCE_NOTE_MAX} characters). Do not
        record medical details.
      </p>
    </section>
  );
}
