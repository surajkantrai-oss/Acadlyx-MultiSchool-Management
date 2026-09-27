import { Alert, Badge, Card } from '@acadlyx/web-ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ImportActions, TYPE_LABEL } from '@/components/people/imports';
import { Dl } from '@/components/people/shared';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { load, setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

const TONE = {
  READY: 'warning',
  QUEUED: 'info',
  PROCESSING: 'info',
  COMPLETED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
} as const;

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('bulk_import.read')) return <NoAccess what="bulk imports" />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [job, bad, preview] = await Promise.all([
    load(() => ctx.people.importJob(id)),
    load(() => ctx.people.importRows(id, { status: 'INVALID', pageSize: 50 })),
    load(() => ctx.people.importRows(id, { status: 'VALID', pageSize: 10 })),
  ]);
  if (!job.ok) {
    if (job.status === 404) notFound();
    return <LoadError status={job.status} />;
  }
  const failed = await load(() => ctx.people.importRows(id, { status: 'FAILED', pageSize: 50 }));
  const j = job.data;
  const problems = [...(bad.ok ? bad.data.items : []), ...(failed.ok ? failed.data.items : [])];
  const previewRows = preview.ok ? preview.data.items : [];
  const columns = previewRows[0]?.data
    ? Object.keys(previewRows[0].data)
        .filter((k) => !k.endsWith('_id') && k !== 'placement')
        .slice(0, 6)
    : [];
  return (
    <>
      <p className="text-sm">
        <Link className="underline" href="/people/imports">
          ← Bulk import
        </Link>
      </p>
      <PageHeader title={j.originalFilename} />
      <Card title="Summary">
        <div className="flex flex-col gap-4" data-testid="import-summary">
          <Dl
            items={[
              ['Type', TYPE_LABEL[j.type]],
              [
                'Status',
                <Badge key="s" tone={TONE[j.status]}>
                  {j.status.toLowerCase()}
                </Badge>,
              ],
              [
                'Rows',
                `${String(j.totalRows)} total · ${String(j.validRows)} valid · ${String(j.invalidRows)} invalid`,
              ],
              [
                'Result',
                j.processedRows > 0
                  ? `${String(j.succeededRows)} imported · ${String(j.failedRows)} failed`
                  : 'Not processed yet',
              ],
              ['Uploaded by', j.createdBy.displayName],
              ['Template version', String(j.templateVersion)],
            ]}
          />
          {j.failureReason ? <Alert>{j.failureReason}</Alert> : null}
          <ImportActions job={j} canManage={ctx.can('bulk_import.manage')} />
        </div>
      </Card>
      {previewRows.length > 0 && j.status === 'READY' ? (
        <Card title={`Preview (first ${String(previewRows.length)} valid rows)`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">Preview</caption>
              <thead>
                <tr>
                  <th scope="col" className="py-1 pr-3">
                    Row
                  </th>
                  {columns.map((c) => (
                    <th key={c} scope="col" className="py-1 pr-3">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((r) => (
                  <tr key={r.rowNumber} className="border-t border-slate-100">
                    <td className="py-1 pr-3">{r.rowNumber}</td>
                    {columns.map((c) => (
                      <td key={c} className="py-1 pr-3">
                        {r.data?.[c] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
      {problems.length > 0 ? (
        <Card title="Rows with problems">
          <p className="mb-2 text-sm">
            <a className="underline" href={`/bff/api/imports/${j.id}/errors.csv`}>
              Download the full error report (CSV)
            </a>
          </p>
          <ul className="flex flex-col gap-1 text-sm" data-testid="import-errors">
            {problems.map((r) => (
              <li key={`${r.status}-${String(r.rowNumber)}`}>
                <span className="font-medium">Row {r.rowNumber}</span>{' '}
                {r.errors
                  .map((e) => `${e.field === '*' ? '' : `${e.field}: `}${e.message}`)
                  .join(' · ')}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
