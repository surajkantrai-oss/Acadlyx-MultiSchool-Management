import { APP_NAME } from '@acadlyx/constants';
import type { TenantLoadResult } from '@/lib/tenant';

export type TenantProblemKind = Exclude<TenantLoadResult['kind'], 'ok'>;

const PROBLEMS: Record<TenantProblemKind, { title: string; body: string }> = {
  'not-found': {
    title: 'School not found',
    body: 'This address is not connected to any school on Acadlyx.',
  },
  unavailable: {
    title: 'School unavailable',
    body: 'This school is not currently available. Please contact the school office.',
  },
  conflict: { title: 'Ambiguous school', body: 'This request identifies more than one school.' },
  error: {
    title: 'Service unavailable',
    body: 'The school service could not be reached. Try again shortly.',
  },
};

/** Controlled tenant error screen, shared by the page and the 404/403 boundaries. */
export function TenantProblem({ kind, host }: { kind: TenantProblemKind; host?: string }) {
  const problem = PROBLEMS[kind];
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div
        className="max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center"
        data-testid="tenant-problem"
        data-problem={kind}
      >
        <p className="text-sm text-slate-500">{APP_NAME}</p>
        <h1 className="mt-2 text-xl font-semibold">{problem.title}</h1>
        <p className="mt-2 text-sm text-slate-600">{problem.body}</p>
        {host ? <p className="mt-4 font-mono text-xs text-slate-400">{host}</p> : null}
      </div>
    </main>
  );
}
