import type { ImportType } from '@acadlyx/types';
import { Badge, EmptyState } from '@acadlyx/web-ui';
import Link from 'next/link';
import { TYPE_LABEL, UploadImportForm } from '@/components/people/imports';
import { Pager } from '@/components/people/shared';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { load, setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

const STATUS_TONE = {
  READY: 'warning',
  QUEUED: 'info',
  PROCESSING: 'info',
  COMPLETED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
} as const;

export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('bulk_import.read')) return <NoAccess what="bulk imports" />;
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const list = await load(() => ctx.people.imports({ page, pageSize: 20 }));
  if (!list.ok) return <LoadError status={list.status} />;
  const types = (
    [
      ['STUDENTS', 'student.manage'],
      ['PARENTS', 'parent.manage'],
      ['TEACHERS', 'teacher.manage'],
    ] as const
  )
    .filter(([, p]) => ctx.can(p))
    .map(([t]) => t as ImportType);
  const { items, total, totalPages } = list.data;
  return (
    <>
      <PageHeader title="Bulk import">
        Upload → check → preview → confirm → background processing → result.
      </PageHeader>
      {ctx.can('bulk_import.manage') && types.length > 0 ? (
        <UploadImportForm types={types} />
      ) : null}
      {items.length === 0 ? (
        <EmptyState title="No imports yet" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm" data-testid="imports-table">
            <caption className="sr-only">Recent imports</caption>
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2">
                  File
                </th>
                <th scope="col" className="px-4 py-2">
                  Type
                </th>
                <th scope="col" className="px-4 py-2">
                  Status
                </th>
                <th scope="col" className="px-4 py-2">
                  Valid / invalid
                </th>
                <th scope="col" className="px-4 py-2">
                  Result
                </th>
                <th scope="col" className="px-4 py-2">
                  Uploaded by
                </th>
                <th scope="col" className="px-4 py-2">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((j) => (
                <tr key={j.id} className="border-t border-slate-100">
                  <th scope="row" className="px-4 py-2 font-medium">
                    <Link
                      className="underline-offset-2 hover:underline"
                      href={`/people/imports/${j.id}`}
                    >
                      {j.originalFilename}
                    </Link>
                  </th>
                  <td className="px-4 py-2">{TYPE_LABEL[j.type]}</td>
                  <td className="px-4 py-2">
                    <Badge tone={STATUS_TONE[j.status]}>{j.status.toLowerCase()}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    {j.validRows} / {j.invalidRows}
                  </td>
                  <td className="px-4 py-2">
                    {j.processedRows > 0
                      ? `${String(j.succeededRows)} imported, ${String(j.failedRows)} failed`
                      : '—'}
                  </td>
                  <td className="px-4 py-2">{j.createdBy.displayName ?? '—'}</td>
                  <td className="px-4 py-2">{new Date(j.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} totalPages={totalPages} total={total} base="/people/imports" params={{}} />
    </>
  );
}
