'use client';

import { REMARK_MAX } from '@acadlyx/validation';
import { Button, inputClassName } from '@acadlyx/web-ui';
import { useState } from 'react';
import { bffApi } from '@/lib/bff-client';
import { NoticeBox, useAction } from '../setup/ui';

export function PrintButton() {
  return (
    <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => window.print()}>
      Print
    </Button>
  );
}

export function PublishResults({
  examId,
  expectedVersion,
  incomplete,
  republish,
}: {
  examId: string;
  expectedVersion: number;
  incomplete: number;
  republish: boolean;
}) {
  const { busy, notice, run } = useAction();
  return (
    <div className="space-y-2" data-testid="publish-results">
      <NoticeBox notice={notice} />
      {incomplete > 0 ? (
        <p className="text-sm text-amber-700">
          {incomplete} result(s) are incomplete — publishing is blocked until every mark is in.
        </p>
      ) : null}
      <Button
        disabled={busy || incomplete > 0}
        onClick={() => {
          const msg = republish
            ? 'Publish a NEW version of the results? The previous version stays in history; parents and students will see the new one.'
            : 'Publish results? Parents and students will be able to see report cards.';
          if (!window.confirm(msg)) return;
          void run(
            () =>
              bffApi(`exams/${examId}/results/publish`, {
                method: 'POST',
                body: { expectedVersion },
              }),
            'Results published.',
          );
        }}
      >
        {republish ? 'Publish new version' : 'Publish results'}
      </Button>
    </div>
  );
}

/** Class-teacher remark (the server refuses anyone else with REMARK_NOT_ALLOWED). */
export function RemarkEditor({
  examId,
  studentId,
  remark,
}: {
  examId: string;
  studentId: string;
  remark: string | null;
}) {
  const { busy, notice, run } = useAction();
  const [text, setText] = useState(remark ?? '');
  return (
    <form
      className="mt-4 max-w-xl space-y-2"
      data-testid="remark-editor"
      onSubmit={(ev) => {
        ev.preventDefault();
        void run(
          () =>
            bffApi(`exams/${examId}/remarks/${studentId}`, {
              method: 'PUT',
              body: { remark: text.trim() || null },
            }),
          'Remark saved.',
        );
      }}
    >
      <NoticeBox notice={notice} />
      <label htmlFor="remark" className="block text-sm font-medium">
        Class teacher’s remark (optional, up to {REMARK_MAX} characters)
      </label>
      <textarea
        id="remark"
        rows={3}
        maxLength={REMARK_MAX}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className={inputClassName}
      />
      <Button type="submit" variant="secondary" disabled={busy}>
        Save remark
      </Button>
    </form>
  );
}
