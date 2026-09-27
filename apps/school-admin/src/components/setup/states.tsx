import { Alert } from '@acadlyx/web-ui';

/** Shown when the signed-in role lacks the read permission for a setup page. */
export function NoAccess({ what }: { what: string }) {
  return (
    <div data-testid="no-access">
      <Alert tone="info" title="No access">
        Your role does not include access to {what}. Ask your school administrator if you need it.
      </Alert>
    </div>
  );
}

/** Safe load-failure state (status only; never backend text). */
export function LoadError({ status }: { status: number }) {
  const text =
    status === 403
      ? 'You do not have permission to view this.'
      : status === 401
        ? 'Your session has ended. Please sign in again.'
        : status === 404
          ? 'This school has not been set up yet. Contact Acadlyx support.'
          : 'This page could not be loaded. Please refresh to try again.';
  return (
    <div data-testid="load-error">
      <Alert tone="danger" title="Could not load">
        {text}
      </Alert>
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children ? <p className="mt-1 text-sm text-slate-600">{children}</p> : null}
    </header>
  );
}
