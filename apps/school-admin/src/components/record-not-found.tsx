import Link from 'next/link';

/**
 * HTTP 404 for a missing record inside a known school (student, guardian, teacher, class,
 * import). Distinct from "School not found", which is only for unknown school addresses.
 */
export function RecordNotFound({ back, backLabel }: { back: string; backLabel: string }) {
  return (
    <div
      className="rounded-lg border border-slate-200 bg-white p-8 text-center"
      data-testid="record-not-found"
    >
      <h1 className="text-xl font-semibold">Record not found</h1>
      <p className="mt-2 text-sm text-slate-600">
        It may have been removed, or you may not have access to it.
      </p>
      <p className="mt-4 text-sm">
        <Link className="underline" href={back}>
          {backLabel}
        </Link>
      </p>
    </div>
  );
}
