'use client';

import type { GradeBandInput, GradeScale } from '@acadlyx/types';
import { GRADE_LABEL_MAX } from '@acadlyx/validation';
import { Button, Card, inputClassName } from '@acadlyx/web-ui';
import { useState } from 'react';
import { bffApi } from '@/lib/bff-client';
import { NoticeBox, SmallButton, useAction } from '../setup/ui';

const EMPTY: GradeBandInput[] = [
  { label: 'A', minPercentage: '80', maxPercentage: '100' },
  { label: 'B', minPercentage: '60', maxPercentage: '80' },
  { label: 'C', minPercentage: '40', maxPercentage: '60' },
  { label: 'D', minPercentage: '0', maxPercentage: '40' },
];

/**
 * Grade-scale editor. The server is authoritative (it rejects gaps, overlaps and duplicate labels
 * with GRADE_SCALE_INVALID); a scale used by a non-draft exam is read-only.
 */
export function GradeScaleEditor({
  academicYearId,
  scales,
  editable,
}: {
  academicYearId: string;
  scales: GradeScale[];
  editable: boolean;
}) {
  const [editing, setEditing] = useState<GradeScale | 'new' | null>(null);
  const { busy, notice, run } = useAction();
  return (
    <div className="space-y-4" data-testid="grade-scales">
      <NoticeBox notice={notice} />
      {scales.length === 0 ? (
        <p className="text-sm text-slate-600">No grade scales for this year.</p>
      ) : null}
      {scales.map((s) => (
        <Card key={s.id} title={s.name}>
          <table className="w-full max-w-md text-left text-sm">
            <thead className="text-xs uppercase text-slate-600">
              <tr>
                <th scope="col" className="py-1">
                  Grade
                </th>
                <th scope="col" className="py-1">
                  From (%)
                </th>
                <th scope="col" className="py-1">
                  Below (%)
                </th>
              </tr>
            </thead>
            <tbody>
              {s.bands.map((b) => (
                <tr key={b.label}>
                  <td className="py-1 font-medium">{b.label}</td>
                  <td className="py-1">{b.minPercentage}</td>
                  <td className="py-1">
                    {b.maxPercentage === '100.00' || b.maxPercentage === '100'
                      ? '100 (inclusive)'
                      : b.maxPercentage}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {s.inUse ? (
            <p className="mt-2 text-xs text-slate-500">Used by an exam — read-only.</p>
          ) : null}
          {editable && !s.inUse ? (
            <div className="mt-3 flex gap-2">
              <SmallButton onClick={() => setEditing(s)}>Edit</SmallButton>
              <SmallButton
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`Delete grade scale ${s.name}?`)) return;
                  void run(
                    () => bffApi(`grade-scales/${s.id}`, { method: 'DELETE' }),
                    'Grade scale deleted.',
                  );
                }}
              >
                Delete
              </SmallButton>
            </div>
          ) : null}
        </Card>
      ))}
      {editable && editing === null ? (
        <Button onClick={() => setEditing('new')}>New grade scale</Button>
      ) : null}
      {editing !== null ? (
        <ScaleForm
          key={editing === 'new' ? 'new' : editing.id}
          academicYearId={academicYearId}
          scale={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function ScaleForm({
  academicYearId,
  scale,
  onDone,
}: {
  academicYearId: string;
  scale: GradeScale | null;
  onDone: () => void;
}) {
  const { busy, notice, run } = useAction();
  const [name, setName] = useState(scale?.name ?? '');
  const [bands, setBands] = useState<GradeBandInput[]>(
    scale
      ? scale.bands.map(({ label, minPercentage, maxPercentage }) => ({
          label,
          minPercentage,
          maxPercentage,
        }))
      : EMPTY,
  );
  const set = (i: number, patch: Partial<GradeBandInput>) =>
    setBands((prev) => prev.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  return (
    <Card title={scale ? `Edit ${scale.name}` : 'New grade scale'}>
      <form
        className="space-y-3"
        data-testid="grade-scale-form"
        onSubmit={(ev) => {
          ev.preventDefault();
          void run(
            () =>
              bffApi(scale ? `grade-scales/${scale.id}` : 'grade-scales', {
                method: scale ? 'PUT' : 'POST',
                body: {
                  academicYearId,
                  name: name.trim(),
                  bands,
                  ...(scale ? { expectedVersion: scale.version } : {}),
                },
              }),
            'Grade scale saved.',
          ).then((ok) => ok && onDone());
        }}
      >
        <NoticeBox notice={notice} />
        <label className="block text-sm font-medium">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={60}
            className={inputClassName}
          />
        </label>
        <table className="text-sm">
          <thead className="text-xs uppercase text-slate-600">
            <tr>
              <th scope="col" className="pr-2 text-left">
                Grade
              </th>
              <th scope="col" className="pr-2 text-left">
                From %
              </th>
              <th scope="col" className="pr-2 text-left">
                Below %
              </th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {bands.map((b, i) => (
              <tr key={i}>
                <td className="pr-2 py-1">
                  <input
                    aria-label={`Band ${String(i + 1)} label`}
                    value={b.label}
                    maxLength={GRADE_LABEL_MAX}
                    onChange={(e) => set(i, { label: e.target.value })}
                    className={`${inputClassName} w-20`}
                  />
                </td>
                <td className="pr-2 py-1">
                  <input
                    aria-label={`Band ${String(i + 1)} minimum`}
                    value={b.minPercentage}
                    inputMode="decimal"
                    onChange={(e) => set(i, { minPercentage: e.target.value })}
                    className={`${inputClassName} w-24`}
                  />
                </td>
                <td className="pr-2 py-1">
                  <input
                    aria-label={`Band ${String(i + 1)} maximum`}
                    value={b.maxPercentage}
                    inputMode="decimal"
                    onChange={(e) => set(i, { maxPercentage: e.target.value })}
                    className={`${inputClassName} w-24`}
                  />
                </td>
                <td>
                  <SmallButton
                    label={`Remove band ${String(i + 1)}`}
                    onClick={() => setBands((p) => p.filter((_, j) => j !== i))}
                  >
                    Remove
                  </SmallButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex gap-2">
          <SmallButton
            onClick={() =>
              setBands((p) => [...p, { label: '', minPercentage: '', maxPercentage: '' }])
            }
          >
            Add band
          </SmallButton>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            Save scale
          </Button>
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
