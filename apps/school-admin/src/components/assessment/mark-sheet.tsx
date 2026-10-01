'use client';

import type { MarkSheet, MarkState, SaveMarksRequest } from '@acadlyx/types';
import { REASON_MAX } from '@acadlyx/validation';
import { Button, inputClassName } from '@acadlyx/web-ui';
import { useMemo, useState } from 'react';
import { bffApi } from '@/lib/bff-client';
import { NoticeBox, useAction, useUnsavedWarning } from '../setup/ui';

interface Cell {
  status: MarkState | '';
  marks: string;
}
const key = (studentId: string, componentId: string) => `${studentId}:${componentId}`;
const MARKS = /^\d{1,5}(\.\d{1,2})?$/;

/**
 * Mark-entry grid (one sheet = exam + section + subject). Everything stays local until Save,
 * which sends the edited cells with the sheet version it was loaded at (STALE_VERSION if someone
 * else saved in between). Range, eligibility and state checks are repeated by the server and DB.
 */
export function MarkSheetEditor({ sheet }: { sheet: MarkSheet }) {
  const initial = useMemo(() => {
    const m = new Map<string, Cell>();
    for (const s of sheet.students)
      for (const e of s.entries)
        m.set(key(s.studentId, e.componentId), { status: e.status ?? '', marks: e.marks ?? '' });
    return m;
  }, [sheet]);
  const [cells, setCells] = useState(initial);
  const { busy, notice, setNotice, run } = useAction();
  const [reason, setReason] = useState('');
  const changed = [...cells.entries()].filter(([k, c]) => {
    const o = initial.get(k);
    return !o || o.status !== c.status || o.marks !== c.marks;
  });
  useUnsavedWarning(changed.length > 0);
  const edit = sheet.can.edit;
  const set = (k: string, patch: Partial<Cell>) =>
    setCells((prev) =>
      new Map(prev).set(k, { ...(prev.get(k) ?? { status: '', marks: '' }), ...patch }),
    );
  const base = `exams/${sheet.examId}/sheets/${sheet.examSubjectId}/${sheet.sectionId}`;

  function save() {
    const errors: string[] = [];
    const entries = changed.flatMap(([k, c]): SaveMarksRequest['entries'] => {
      const [studentId = '', componentId = ''] = k.split(':');
      const comp = sheet.components.find((x) => x.id === componentId);
      const who = sheet.students.find((s) => s.studentId === studentId)?.name ?? 'A student';
      if (c.status === '') return [];
      if (c.status === 'MARKED') {
        if (!MARKS.test(c.marks) || (comp && Number(c.marks) > Number(comp.maxMarks))) {
          errors.push(
            `${who}: ${comp?.name ?? 'mark'} must be between 0 and ${comp?.maxMarks ?? 'the maximum'} (2 decimals).`,
          );
          return [];
        }
        return [{ studentId, componentId, status: c.status, marks: c.marks }];
      }
      return [{ studentId, componentId, status: c.status, marks: null }];
    });
    if (errors.length) {
      setNotice({ tone: 'danger', messages: errors.slice(0, 10) });
      return;
    }
    if (entries.length === 0) {
      setNotice({ tone: 'danger', messages: ['There are no changes to save.'] });
      return;
    }
    void run(
      () => bffApi(base, { method: 'PUT', body: { expectedVersion: sheet.version, entries } }),
      'Marks saved.',
    );
  }
  function act(action: 'submit' | 'finalize' | 'reopen') {
    if (changed.length > 0) {
      setNotice({ tone: 'danger', messages: ['Save or discard your changes first.'] });
      return;
    }
    if (action === 'reopen' && (reason.trim().length < 3 || reason.trim().length > REASON_MAX)) {
      setNotice({
        tone: 'danger',
        messages: [`Give a reason for reopening (3–${String(REASON_MAX)} characters).`],
      });
      return;
    }
    void run(
      () =>
        bffApi(`${base}/${action}`, {
          method: 'POST',
          body: {
            expectedVersion: sheet.version,
            ...(action === 'reopen' ? { reason: reason.trim() } : {}),
          },
        }),
      action === 'submit'
        ? 'Sheet submitted.'
        : action === 'finalize'
          ? 'Sheet finalized.'
          : 'Sheet reopened.',
    ).then((ok) => ok && setReason(''));
  }

  return (
    <div className="space-y-4" data-testid="mark-sheet">
      <NoticeBox notice={notice} />
      {!edit ? (
        <p className="text-sm text-slate-600" data-testid="sheet-readonly">
          This sheet is read-only for you in its current state.
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            Marks for {sheet.className}, {sheet.subjectName}
          </caption>
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-2">
                Student
              </th>
              {sheet.components.map((c) => (
                <th key={c.id} scope="col" className="px-3 py-2">
                  {c.name}{' '}
                  <span className="font-normal">
                    (max {c.maxMarks}
                    {c.passMarks ? `, pass ${c.passMarks}` : ''})
                  </span>
                  {c.examDate ? <div className="font-normal">{c.examDate}</div> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sheet.students.map((s) => (
              <tr key={s.studentId}>
                <th scope="row" className="px-3 py-2 font-medium">
                  {s.name}
                  <div className="text-xs font-normal text-slate-500">{s.admissionNumber}</div>
                </th>
                {sheet.components.map((c) => {
                  const entry = s.entries.find((e) => e.componentId === c.id);
                  const k = key(s.studentId, c.id);
                  const cell = cells.get(k) ?? { status: '', marks: '' };
                  if (entry && !entry.eligible)
                    return (
                      <td key={c.id} className="px-3 py-2 text-xs text-slate-500">
                        Not enrolled on paper date
                      </td>
                    );
                  const label = `${s.name}, ${c.name}`;
                  return (
                    <td key={c.id} className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <select
                          aria-label={`${label} status`}
                          value={cell.status}
                          disabled={!edit}
                          onChange={(e) => set(k, { status: e.target.value as Cell['status'] })}
                          className={`${inputClassName} w-28`}
                        >
                          <option value="">—</option>
                          <option value="MARKED">Marks</option>
                          <option value="ABSENT">Absent</option>
                          <option value="EXEMPT">Exempt</option>
                        </select>
                        {cell.status === 'MARKED' ? (
                          <input
                            aria-label={`${label} marks`}
                            inputMode="decimal"
                            value={cell.marks}
                            disabled={!edit}
                            onChange={(e) => set(k, { marks: e.target.value })}
                            className={`${inputClassName} w-20`}
                          />
                        ) : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {edit ? (
          <>
            <Button onClick={save} disabled={busy || changed.length === 0}>
              Save marks{changed.length ? ` (${String(changed.length)})` : ''}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || changed.length === 0}
              onClick={() => setCells(initial)}
            >
              Discard changes
            </Button>
          </>
        ) : null}
        {sheet.can.submit ? (
          <Button variant="secondary" disabled={busy} onClick={() => act('submit')}>
            Submit for review
          </Button>
        ) : null}
        {sheet.can.finalize ? (
          <Button disabled={busy} onClick={() => act('finalize')}>
            Finalize sheet
          </Button>
        ) : null}
      </div>
      {sheet.can.reopen ? (
        <div className="max-w-xl space-y-2 rounded-md border border-slate-200 p-3">
          <label htmlFor="reopen-reason" className="block text-sm font-medium">
            Reason for reopening
          </label>
          <textarea
            id="reopen-reason"
            rows={2}
            maxLength={REASON_MAX}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputClassName}
          />
          <Button variant="secondary" disabled={busy} onClick={() => act('reopen')}>
            Reopen sheet
          </Button>
        </div>
      ) : null}
      {sheet.events.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold">History</h2>
          <ul className="mt-1 space-y-1 text-xs text-slate-600" data-testid="sheet-events">
            {sheet.events.map((e) => (
              <li key={`${e.at}-${e.toStatus}`}>
                {new Date(e.at).toLocaleString()} — {e.fromStatus} → {e.toStatus}
                {e.actorName ? ` by ${e.actorName}` : ''}
                {e.reason ? `: “${e.reason}”` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
