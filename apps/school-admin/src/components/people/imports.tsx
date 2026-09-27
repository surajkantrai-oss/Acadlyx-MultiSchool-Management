'use client';

import type { ImportJob, ImportType } from '@acadlyx/types';
import { Button, Card } from '@acadlyx/web-ui';
import { CSRF_HEADER } from '@acadlyx/api-client';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { BffError, bffApi, friendlyError } from '@/lib/bff-client';
import { NoticeBox, SelectField, useAction } from '../setup/ui';

const TYPE_LABEL: Record<ImportType, string> = {
  STUDENTS: 'Students',
  PARENTS: 'Parents / guardians',
  TEACHERS: 'Teachers',
};

/** Upload → the API parses and validates immediately; NOTHING is created until confirmation. */
export function UploadImportForm({ types }: { types: ImportType[] }) {
  const router = useRouter();
  const { busy, notice, setNotice } = useAction();
  const [sending, setSending] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0)
      return setNotice({ tone: 'danger', messages: ['Choose a .csv or .xlsx file.'] });
    if (file.size > 5 * 1024 * 1024)
      return setNotice({
        tone: 'danger',
        messages: ['The file is larger than 5 MB — split it into smaller files.'],
      });
    setSending(true);
    setNotice(null);
    try {
      const res = await fetch('/bff/api/imports', {
        method: 'POST',
        body: form,
        headers: { [CSRF_HEADER]: '1' },
        credentials: 'same-origin',
      });
      const data = (await res.json().catch(() => ({}))) as ImportJob & {
        code?: string;
        message?: string | string[];
      };
      if (!res.ok) {
        const list = Array.isArray(data.message)
          ? data.message
          : data.message
            ? [data.message]
            : [];
        throw new BffError(res.status, data.code, list);
      }
      router.push(`/people/imports/${data.id}`);
    } catch (error) {
      setNotice({ tone: 'danger', messages: friendlyError(error) });
      setSending(false);
    }
  }
  return (
    <Card title="New import">
      <form
        onSubmit={(e) => void submit(e)}
        className="flex flex-col gap-3"
        aria-label="Upload import file"
      >
        <NoticeBox notice={notice} />
        <div className="flex flex-wrap items-end gap-3">
          <SelectField
            idPrefix="imp"
            name="type"
            label="What are you importing?"
            options={types.map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="imp-file" className="text-sm font-medium text-slate-800">
              File (.csv or .xlsx, max 5 MB / 5,000 rows)
            </label>
            <input
              id="imp-file"
              name="file"
              type="file"
              required
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="text-sm"
            />
          </div>
          <Button type="submit" disabled={busy || sending}>
            {sending ? 'Checking file…' : 'Upload and check'}
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          The file is checked and previewed first — nothing is saved until you confirm. Import
          parents before students so guardian codes can be linked.
        </p>
        <ul className="flex flex-wrap gap-4 text-sm" aria-label="Templates">
          {types.map((t) => (
            <li key={t}>
              {TYPE_LABEL[t]} template:{' '}
              <a className="underline" href={`/bff/api/imports/templates/${t}/file?format=xlsx`}>
                Excel
              </a>{' '}
              ·{' '}
              <a className="underline" href={`/bff/api/imports/templates/${t}/file?format=csv`}>
                CSV
              </a>
            </li>
          ))}
        </ul>
      </form>
    </Card>
  );
}

/** Confirm/cancel + polling of PERSISTED progress while the background job runs. */
export function ImportActions({ job, canManage }: { job: ImportJob; canManage: boolean }) {
  const router = useRouter();
  const { busy, notice, run } = useAction();
  const running = job.status === 'QUEUED' || job.status === 'PROCESSING';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), 2_000);
    return () => clearInterval(timer);
  }, [running, router]);
  const pct = job.validRows > 0 ? Math.round((job.processedRows / job.validRows) * 100) : 0;
  return (
    <div className="flex flex-col gap-3">
      <NoticeBox notice={notice} />
      {running || job.status === 'COMPLETED' ? (
        <div>
          <div className="mb-1 flex justify-between text-xs text-slate-600">
            <span>Progress</span>
            <span>
              {job.processedRows} / {job.validRows}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Import progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="h-2 w-full rounded bg-slate-200"
          >
            <div className="h-2 rounded bg-emerald-600" style={{ width: `${String(pct)}%` }} />
          </div>
        </div>
      ) : null}
      {canManage && job.status === 'READY' ? (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || job.validRows === 0}
            onClick={() =>
              void run(
                () => bffApi(`imports/${job.id}/confirm`, { method: 'POST' }),
                'Import confirmed — processing in the background.',
              )
            }
          >
            Confirm import of {job.validRows} valid row{job.validRows === 1 ? '' : 's'}
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void run(
                () => bffApi(`imports/${job.id}/cancel`, { method: 'POST' }),
                'Import cancelled. Nothing was saved.',
              )
            }
          >
            Cancel
          </Button>
        </div>
      ) : null}
      {job.invalidRows > 0 && canManage && job.status === 'READY' ? (
        <p className="text-xs text-slate-500">
          Invalid rows are skipped. Fix them in your file and upload them again as a new import.
        </p>
      ) : null}
    </div>
  );
}

export { TYPE_LABEL };
export type { BffError };
