/**
 * Generic, unbranded web UI primitives styled with Tailwind utility classes.
 * Consuming apps must include this package's dist output in their Tailwind sources.
 * Tenant theming is introduced in Phase 2.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export interface AppShellProps {
  productName: string;
  area: string;
  children: ReactNode;
}

export function AppShell({ productName, area, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4">
          <span className="text-lg font-semibold tracking-tight">{productName}</span>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-sm text-slate-600">{area}</span>
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
