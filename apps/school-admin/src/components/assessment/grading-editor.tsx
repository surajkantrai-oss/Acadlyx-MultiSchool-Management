'use client';

import type { AssignmentGrading, GradingSubmissionVersion } from '@acadlyx/types';
import { FEEDBACK_MAX } from '@acadlyx/validation';
import { Badge, Button, inputClassName } from '@acadlyx/web-ui';
import { useState } from 'react';
import { bffApi } from '@/lib/bff-client';
import { NoticeBox, useAction } from '../setup/ui';

/**
 * Per-student grading. Only the latest submission version can be graded here (older versions are
 * shown read-only with any grade they carried). Drafts are private; Publish releases the grade.
 */
export function GradingEditor({ grading }: { grading: AssignmentGrading }) {
  if (grading.rows.length === 0)
    return <p className="text-sm text-slate-600">No submissions yet.</p>;
  return (
    <ul className="space-y-4" data-testid="grading-list">
      {grading.rows.map((r) => (
        <li key={r.studentId} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="font-medium">
            {r.name} <span className="text-xs font-normal text-slate-500">{r.admissionNumber}</span>
            {r.late ? (
              <span className="ml-2">
                <Badge tone="warning">Late</Badge>
              </span>
            ) : null}
          </p>
          {r.versions.map((v) => (
            <VersionBlock
              key={v.version}
              grading={grading}
              submissionId={r.submissionId}
              v={v}
              latest={v.version === r.latestVersion}
              who={r.name}
            />
          ))}
        </li>
      ))}
    </ul>
  );
}

function VersionBlock({
  grading,
  submissionId,
  v,
  latest,
  who,
}: {
  grading: AssignmentGrading;
  submissionId: string;
  v: GradingSubmissionVersion;
  latest: boolean;
  who: string;
}) {
  const { busy, notice, run } = useAction();
  const [marks, setMarks] = useState(v.grade?.marksAwarded ?? '');
  const [feedback, setFeedback] = useState(v.grade?.feedback ?? '');
  const path = `assignments/${grading.assignmentId}/submissions/${submissionId}/versions/${String(v.version)}/grade`;
  const expectedVersion = v.grade?.version ?? 0;
  return (
    <div
      className="mt-3 border-t border-slate-100 pt-3 text-sm"
      data-testid={`grade-${who}-v${String(v.version)}`}
    >
      <p className="text-xs text-slate-500">
        Version {v.version} · {new Date(v.submittedAt).toLocaleString()}
        {v.grade
          ? ` · grade ${v.grade.status === 'PUBLISHED' ? 'published' : 'draft'}`
          : ' · not graded'}
      </p>
      {v.textContent ? <p className="mt-1 whitespace-pre-line">{v.textContent}</p> : null}
      {v.externalUrl ? (
        <p className="mt-1 break-all text-xs">
          Link (opens outside Acadlyx): <span className="font-mono">{v.externalUrl}</span>
        </p>
      ) : null}
      {!latest ? (
        v.grade ? (
          <p className="mt-1 text-xs text-slate-600">
            Earlier grade: {v.grade.marksAwarded ?? '—'}
            {v.grade.feedback ? ` — ${v.grade.feedback}` : ''}
          </p>
        ) : null
      ) : (
        <form
          className="mt-2 space-y-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            void run(
              () =>
                bffApi(path, {
                  method: 'PUT',
                  body: {
                    ...(grading.maxMarks ? { marksAwarded: marks.trim() || null } : {}),
                    feedback: feedback.trim() || null,
                    expectedVersion,
                  },
                }),
              v.grade?.status === 'PUBLISHED' ? 'Published grade corrected.' : 'Draft grade saved.',
            );
          }}
        >
          <NoticeBox notice={notice} />
          {grading.maxMarks ? (
            <label className="block">
              <span className="text-xs font-medium">Marks (out of {grading.maxMarks})</span>
              <input
                aria-label={`Marks for ${who}`}
                inputMode="decimal"
                value={marks}
                onChange={(e) => setMarks(e.target.value)}
                className={`${inputClassName} w-28`}
              />
            </label>
          ) : null}
          <label className="block">
            <span className="text-xs font-medium">Feedback (up to {FEEDBACK_MAX} characters)</span>
            <textarea
              aria-label={`Feedback for ${who}`}
              rows={2}
              maxLength={FEEDBACK_MAX}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              className={inputClassName}
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" disabled={busy}>
              {v.grade?.status === 'PUBLISHED' ? 'Save correction' : 'Save draft'}
            </Button>
            {v.grade && v.grade.status === 'DRAFT' ? (
              <Button
                disabled={busy}
                onClick={() =>
                  void run(
                    () => bffApi(`${path}/publish`, { method: 'POST', body: { expectedVersion } }),
                    'Grade published.',
                  )
                }
              >
                Publish grade
              </Button>
            ) : null}
          </div>
        </form>
      )}
    </div>
  );
}
