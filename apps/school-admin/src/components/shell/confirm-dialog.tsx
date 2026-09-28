'use client';

import { Button } from '@acadlyx/web-ui';
import { type ReactNode, useEffect, useId, useRef } from 'react';

/**
 * Confirmation for impactful actions (native modal <dialog>: focus is trapped and restored by the
 * browser, Escape cancels). Focus starts on Cancel so Enter never confirms by accident.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = 'danger',
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      d.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg p-0 shadow-xl backdrop:bg-slate-900/40"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      data-testid="confirm-dialog"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id={`${id}-title`} className="text-lg font-semibold text-slate-900">
          {title}
        </h2>
        <div id={`${id}-body`} className="text-sm text-slate-700">
          {children}
        </div>
        <div className="flex justify-end gap-2">
          <Button data-cancel variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            disabled={busy}
            className={
              tone === 'danger' ? 'bg-red-700! hover:bg-red-800! focus-visible:ring-red-700!' : ''
            }
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
