/**
 * Generic, unbranded web UI primitives styled with Tailwind utility classes.
 * Consuming apps must include this package's dist output in their Tailwind sources.
 * Colours stay neutral here; tenant theming is applied by apps via CSS variables
 * (e.g. School Admin sets --brand-primary from the tenant bootstrap).
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export interface AppShellProps {
  productName: string;
  area: string;
  /** Optional navigation (apps pass framework links, e.g. next/link). */
  nav?: ReactNode;
  children: ReactNode;
}

export function AppShell({ productName, area, nav, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4">
          <span className="text-lg font-semibold tracking-tight">{productName}</span>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-sm text-slate-600">{area}</span>
          {nav ? (
            <nav aria-label="Main" className="ml-auto flex gap-4 text-sm">
              {nav}
            </nav>
          ) : null}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}

export interface CardProps {
  title: string;
  children: ReactNode;
}

export function Card({ title, children }: CardProps) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-2 text-base font-semibold">{title}</h2>
      <div className="text-sm text-slate-600">{children}</div>
    </section>
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
};

export function Button({ variant = 'primary', className, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center rounded-md px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50',
        variant === 'primary'
          ? 'bg-slate-900 text-white hover:bg-slate-800 focus-visible:ring-slate-900'
          : 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 focus-visible:ring-slate-400',
        className,
      )}
      {...props}
    />
  );
}

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  success: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-800',
  info: 'bg-sky-100 text-sky-800',
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={cx('inline-flex rounded px-2 py-0.5 text-xs font-medium', BADGE_TONES[tone])}>
      {children}
    </span>
  );
}

export function Alert({
  tone = 'danger',
  title,
  children,
}: {
  tone?: 'danger' | 'success' | 'info';
  title?: string;
  children?: ReactNode;
}) {
  const tones = {
    danger: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    info: 'border-sky-200 bg-sky-50 text-sky-800',
  } as const;
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('rounded-md border p-3 text-sm', tones[tone])}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      {children}
    </div>
  );
}

export interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  children: ReactNode;
}

/** Label + control + hint/error, wired for screen readers via aria-describedby ids. */
export function Field({ id, label, hint, error, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Shared input classes so text inputs and selects look the same in every app. */
export const inputClassName =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-300 aria-[invalid=true]:border-red-500';

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="font-medium text-slate-800">{title}</p>
      {children ? <div className="mt-1 text-sm text-slate-500">{children}</div> : null}
    </div>
  );
}
