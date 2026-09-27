'use client';

import { Alert, Button, Field, inputClassName } from '@acadlyx/web-ui';
import { useRouter } from 'next/navigation';
import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  useEffect,
  useRef,
  useState,
} from 'react';
import { friendlyError } from '@/lib/bff-client';

export interface Notice {
  tone: 'success' | 'danger';
  messages: string[];
}

/**
 * Status / error summary. Receives focus when it appears so keyboard and screen-reader users
 * learn the outcome of an action immediately (errors are role=alert, successes role=status).
 */
export function NoticeBox({ notice }: { notice: Notice | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice) ref.current?.focus();
  }, [notice]);
  if (!notice) return null;
  return (
    <div ref={ref} tabIndex={-1} className="outline-none" data-testid={`notice-${notice.tone}`}>
      <Alert
        tone={notice.tone}
        title={notice.tone === 'danger' ? 'Please fix the following' : undefined}
      >
        {notice.messages.length === 1 ? (
          <p>{notice.messages[0]}</p>
        ) : (
          <ul className="list-disc pl-5">
            {notice.messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </Alert>
    </div>
  );
}

/** Runs a mutation, shows a friendly outcome and refreshes server data on success. */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  async function run(fn: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      setNotice({ tone: 'success', messages: [success] });
      router.refresh();
      return true;
    } catch (error) {
      setNotice({ tone: 'danger', messages: friendlyError(error) });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, notice, setNotice, run };
}

/** Warns before leaving the page with unsaved edits (browser-native prompt). */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
    };
  }, [dirty]);
}

/** zod issues → { field: message } for inline field errors. */
export function fieldErrors(
  issues: { path: PropertyKey[]; message: string }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? 'form');
    out[key] ??= issue.message;
  }
  return out;
}

type TextProps = InputHTMLAttributes<HTMLInputElement> & {
  name: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  idPrefix: string;
};

export function TextField({ name, label, hint, error, idPrefix, ...input }: TextProps) {
  const id = `${idPrefix}-${name}`;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        name={name}
        className={inputClassName}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...input}
      />
    </Field>
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  name: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  idPrefix: string;
  options: { value: string; label: string }[];
};

export function SelectField({
  name,
  label,
  hint,
  error,
  idPrefix,
  options,
  ...select
}: SelectProps) {
  const id = `${idPrefix}-${name}`;
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <select
        id={id}
        name={name}
        className={inputClassName}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...select}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Keyboard-accessible disclosure (native <details>) used for create/edit panels. */
export function Disclosure({
  summary,
  children,
  open,
  testId,
}: {
  summary: string;
  children: ReactNode;
  open?: boolean;
  testId?: string;
}) {
  return (
    <details
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      open={open}
      data-testid={testId}
    >
      <summary className="cursor-pointer text-sm font-semibold text-slate-800">{summary}</summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

export function SmallButton({
  children,
  onClick,
  disabled,
  label,
  tone = 'secondary',
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label?: string;
  tone?: 'primary' | 'secondary';
}) {
  return (
    <Button
      variant={tone}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="px-2 py-1 text-xs"
    >
      {children}
    </Button>
  );
}

/** Reads a form into trimmed strings (unchecked checkboxes are absent). */
export function formValues(form: HTMLFormElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new FormData(form).entries()) out[k] = typeof v === 'string' ? v.trim() : '';
  return out;
}

export const WEEKDAY_LABELS: Record<string, string> = {
  MONDAY: 'Monday',
  TUESDAY: 'Tuesday',
  WEDNESDAY: 'Wednesday',
  THURSDAY: 'Thursday',
  FRIDAY: 'Friday',
  SATURDAY: 'Saturday',
  SUNDAY: 'Sunday',
};

export const BOARD_LABELS: Record<string, string> = {
  CBSE: 'CBSE',
  ICSE: 'ICSE',
  STATE_BOARD: 'State board',
  IB: 'IB',
  CAMBRIDGE: 'Cambridge',
  OTHER: 'Other',
};
