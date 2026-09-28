'use client';

import { Alert } from '@acadlyx/web-ui';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useId, useTransition } from 'react';
import { setAcademicContext } from '@/app/actions/context';

interface Option {
  id: string;
  label: string;
}

/**
 * Academic context selector (branch + year). Changes are remembered for the browser session and
 * mirrored into the URL (`year`, `branch`) so views are shareable and back/forward works.
 */
export function ContextBar({
  years,
  branches,
  yearId,
  branchId,
  noCurrentYear,
  canConfigureYears,
}: {
  years: Option[];
  branches: Option[];
  yearId: string | null;
  branchId: string | null;
  noCurrentYear: boolean;
  canConfigureYears: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const id = useId();
  const [pending, start] = useTransition();

  const change = (next: { year?: string | null; branch?: string | null }) => {
    const y = next.year !== undefined ? next.year : yearId;
    const b = next.branch !== undefined ? next.branch : branchId;
    start(async () => {
      await setAcademicContext(y, b);
      const q = new URLSearchParams(params.toString());
      q.delete('page');
      if (y) q.set('year', y);
      else q.delete('year');
      q.set('branch', b ?? 'all');
      router.push(`${pathname}?${q.toString()}`);
    });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="context-bar">
      <form
        aria-label="Academic context"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-year`} className="text-xs font-medium text-slate-600">
            Academic year
          </label>
          <select
            id={`${id}-year`}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={yearId ?? ''}
            disabled={pending || years.length === 0}
            onChange={(e) => {
              change({ year: e.target.value || null });
            }}
          >
            {years.length === 0 ? <option value="">No academic years</option> : null}
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-branch`} className="text-xs font-medium text-slate-600">
            Branch
          </label>
          <select
            id={`${id}-branch`}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={branchId ?? 'all'}
            disabled={pending}
            onChange={(e) => {
              change({ branch: e.target.value === 'all' ? null : e.target.value });
            }}
          >
            <option value="all">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
        <p role="status" aria-live="polite" className="pb-1.5 text-xs text-slate-500">
          {pending ? 'Updating…' : ''}
        </p>
      </form>
      {noCurrentYear ? (
        <Alert tone="info" title="No current academic year">
          Enrollment counts and classes need a current academic year.{' '}
          {canConfigureYears ? (
            <Link className="underline" href="/settings/academic-years">
              Configure academic years
            </Link>
          ) : (
            'Ask your school administrator to set one.'
          )}
        </Alert>
      ) : null}
    </div>
  );
}
