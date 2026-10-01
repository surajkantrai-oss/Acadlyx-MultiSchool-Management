import type { OverallResultStatus, ReportCard } from '@acadlyx/types';
import { Alert, Badge, Card, EmptyState } from '@acadlyx/web-ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pager } from '@/components/people/shared';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { load, setupContext } from '@/lib/setup';
import { ExamBadge } from './exam-pages';
import { GradingEditor } from './grading-editor';
import { PrintButton, PublishResults, RemarkEditor } from './result-actions';

const UUID = /^[0-9a-f-]{36}$/i;
const STATUS_TONE: Record<OverallResultStatus, 'success' | 'danger' | 'neutral' | 'warning'> = {
  PASS: 'success',
  FAIL: 'danger',
  EXEMPT: 'neutral',
  INCOMPLETE: 'warning',
};
const STATUS_LABEL: Record<string, string> = {
  PASS: 'Pass',
  FAIL: 'Fail',
  EXEMPT: 'Exempt',
  INCOMPLETE: 'Incomplete',
};
export function ResultBadge({ status }: { status: OverallResultStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

/** Class results (live, computed on demand) + publish + version history. */
export async function ResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; sectionId?: string }>;
}) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('results.read')) return <NoAccess what="results" />;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const sectionId = sp.sectionId && UUID.test(sp.sectionId) ? sp.sectionId : undefined;
  const [exam, results, pubs] = await Promise.all([
    load(() => ctx.assessment.exam(id)),
    load(() =>
      ctx.assessment.results(id, { ...(sectionId ? { sectionId } : {}), page, pageSize: 50 }),
    ),
    load(() => ctx.assessment.publications(id)),
  ]);
  if (!exam.ok) {
    if (exam.status === 404) notFound();
    return <LoadError status={exam.status} />;
  }
  const e = exam.data;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Academics' },
          { label: 'Exams', href: '/exams' },
          { label: e.name, href: `/exams/${e.id}` },
          { label: 'Results' },
        ]}
      />
      <div className="flex flex-wrap items-center gap-3">
        <PageHeader title={`Results — ${e.name}`} />
        <ExamBadge status={e.status} />
      </div>
      <p className="text-sm text-slate-600">
        Live results are calculated from the current marks. Parents and students see only the
        published version.
      </p>
      {!results.ok ? (
        results.status === 404 ? (
          // Teachers see only sections they are the class teacher of (decision N); anything
          // else is "not found" on the API, shown here without implying the school is missing.
          <div data-testid="results-unavailable">
            <Alert tone="info" title="Results not available">
              Results are shown only for classes where you are the class teacher. Open your class
              from Classes, or ask the school office.
            </Alert>
          </div>
        ) : (
          <LoadError status={results.status} />
        )
      ) : (
        <>
          {results.data.canPublish && ctx.can('results.publish') ? (
            <PublishResults
              examId={e.id}
              expectedVersion={e.version}
              incomplete={results.data.incompleteCount}
              republish={e.currentPublicationVersion !== null}
            />
          ) : null}
          {results.data.rows.length === 0 ? (
            <EmptyState title="No results">No students are in scope for this exam.</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-left text-sm" data-testid="results-table">
                <caption className="sr-only">Results for {e.name}</caption>
                <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Student
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Class
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Marks
                    </th>
                    <th scope="col" className="px-3 py-2">
                      %
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Grade
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Result
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {results.data.rows.map((r) => (
                    <tr key={r.studentId}>
                      <td className="px-3 py-2">
                        <Link
                          href={`/exams/${e.id}/results/${r.studentId}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {r.name}
                        </Link>
                        <div className="text-xs text-slate-500">{r.admissionNumber}</div>
                      </td>
                      <td className="px-3 py-2">{r.className}</td>
                      <td className="px-3 py-2">
                        {r.obtained} / {r.maxMarks}
                      </td>
                      <td className="px-3 py-2">{r.percentageDisplay ?? '—'}</td>
                      <td className="px-3 py-2">{r.grade ?? '—'}</td>
                      <td className="px-3 py-2">
                        <ResultBadge status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager
            page={results.data.page}
            totalPages={results.data.totalPages}
            total={results.data.total}
            base={`/exams/${e.id}/results`}
            params={{ sectionId }}
          />
        </>
      )}
      {pubs.ok && pubs.data.length > 0 ? (
        <Card title="Published versions">
          <ul className="space-y-1 text-sm" data-testid="publications">
            {pubs.data.map((p) => (
              <li key={p.id}>
                Version {p.version} — {new Date(p.publishedAt).toLocaleString()}
                {p.publishedByName ? ` by ${p.publishedByName}` : ''} · {p.studentCount} students
                {p.isCurrent ? (
                  <span className="ml-2">
                    <Badge tone="success">Current</Badge>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

/** Report card: live preview (staff) or an immutable published version (?publication=…). */
export async function ReportCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; studentId: string }>;
  searchParams: Promise<{ publication?: string }>;
}) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('results.read')) return <NoAccess what="report cards" />;
  const { id, studentId } = await params;
  const sp = await searchParams;
  if (!UUID.test(id) || !UUID.test(studentId)) notFound();
  const pubs = await load(() => ctx.assessment.publications(id));
  const pubList = pubs.ok ? pubs.data : [];
  const chosen =
    sp.publication && UUID.test(sp.publication)
      ? pubList.find((p) => p.id === sp.publication)
      : undefined;
  const card = await load(() =>
    chosen
      ? ctx.assessment.publishedCard(chosen.id, studentId)
      : ctx.assessment.preview(id, studentId),
  );
  if (!card.ok) {
    if (card.status === 404) notFound();
    return <LoadError status={card.status} />;
  }
  const c = card.data;
  return (
    <>
      <div className="print:hidden">
        <Breadcrumbs
          items={[
            { label: 'Academics' },
            { label: 'Exams', href: '/exams' },
            { label: c.examName, href: `/exams/${id}` },
            { label: 'Results', href: `/exams/${id}/results` },
            { label: c.studentName },
          ]}
        />
        <nav
          aria-label="Report card version"
          className="mt-2 flex flex-wrap items-center gap-3 text-sm"
        >
          <Link
            href={`/exams/${id}/results/${studentId}`}
            aria-current={!chosen ? 'page' : undefined}
            className={!chosen ? 'font-semibold underline' : 'underline-offset-2 hover:underline'}
          >
            Live preview
          </Link>
          {pubList.map((p) => (
            <Link
              key={p.id}
              href={`/exams/${id}/results/${studentId}?publication=${p.id}`}
              aria-current={chosen?.id === p.id ? 'page' : undefined}
              className={
                chosen?.id === p.id
                  ? 'font-semibold underline'
                  : 'underline-offset-2 hover:underline'
              }
            >
              Version {p.version}
              {p.isCurrent ? ' (current)' : ''}
            </Link>
          ))}
          <PrintButton />
        </nav>
      </div>
      <ReportCardView card={c} />
      {c.preview ? (
        <div className="print:hidden">
          <RemarkEditor examId={id} studentId={studentId} remark={c.remark} />
        </div>
      ) : null}
    </>
  );
}

export function ReportCardView({ card: c }: { card: ReportCard }) {
  return (
    <article
      className="report-card rounded-lg border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:p-0 print:shadow-none"
      data-testid="report-card"
    >
      <header className="border-b border-slate-200 pb-3">
        <p className="text-sm text-slate-600">{c.schoolName}</p>
        <h1 className="text-xl font-semibold">Report card — {c.examName}</h1>
        <p className="text-sm">
          {c.studentName} · {c.admissionNumber} · {c.gradeName} {c.sectionName} ·{' '}
          {c.academicYearName}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {c.preview
            ? 'PREVIEW — not published. Values may change until results are published.'
            : `Published version ${String(c.publicationVersion)} on ${c.publishedAt ? new Date(c.publishedAt).toLocaleDateString() : ''}`}
        </p>
      </header>
      <table className="mt-4 w-full text-left text-sm">
        <caption className="sr-only">Subject and paper results</caption>
        <thead className="text-xs uppercase text-slate-600">
          <tr>
            <th scope="col" className="py-1">
              Subject / paper
            </th>
            <th scope="col" className="py-1">
              Marks
            </th>
            <th scope="col" className="py-1">
              %
            </th>
            <th scope="col" className="py-1">
              Grade
            </th>
            <th scope="col" className="py-1">
              Result
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {c.subjects.map((s) => [
            <tr key={s.subjectName} className="font-medium">
              <td className="py-1">{s.subjectName}</td>
              <td className="py-1">
                {s.obtained !== null ? `${s.obtained} / ${s.maxMarks ?? ''}` : '—'}
              </td>
              <td className="py-1">{s.percentageDisplay ?? '—'}</td>
              <td className="py-1">{s.grade ?? '—'}</td>
              <td className="py-1">{STATUS_LABEL[s.outcome]}</td>
            </tr>,
            ...s.components.map((p) => (
              <tr key={`${s.subjectName}-${p.name}`} className="text-xs text-slate-600">
                <td className="py-1 pl-4">{p.name}</td>
                <td className="py-1">
                  {p.status === 'ABSENT'
                    ? 'Absent'
                    : p.status === 'EXEMPT'
                      ? 'Exempt'
                      : p.marks !== null
                        ? `${p.marks} / ${p.maxMarks}`
                        : '—'}
                </td>
                <td colSpan={3} className="py-1">
                  {p.passed === false ? 'Below pass mark' : ''}
                </td>
              </tr>
            )),
          ])}
        </tbody>
      </table>
      <footer className="mt-4 border-t border-slate-200 pt-3 text-sm">
        <p>
          Total:{' '}
          <strong>
            {c.obtained} / {c.maxMarks}
          </strong>{' '}
          · Percentage: <strong>{c.percentageDisplay ?? '—'}</strong> · Grade:{' '}
          <strong>{c.grade ?? '—'}</strong> · Result: <strong>{STATUS_LABEL[c.status]}</strong>
        </p>
        {c.remark ? (
          <p className="mt-2 whitespace-pre-line">Class teacher’s remark: {c.remark}</p>
        ) : null}
      </footer>
    </article>
  );
}

export async function GradingPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('assignment_grade.manage')) return <NoAccess what="assignment grading" />;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const g = await load(() => ctx.assessment.grading(id));
  if (!g.ok) {
    if (g.status === 404) notFound();
    return <LoadError status={g.status} />;
  }
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Academics' },
          { label: 'Assignments', href: '/assignments' },
          { label: g.data.title, href: `/assignments/${id}` },
          { label: 'Grading' },
        ]}
      />
      <PageHeader title={`Grading — ${g.data.title}`}>
        {g.data.className} · {g.data.subjectName} ·{' '}
        {g.data.maxMarks ? `out of ${g.data.maxMarks}` : 'feedback only (no maximum marks)'}. A
        grade belongs to one submission version; students see it only after you publish it.
      </PageHeader>
      <GradingEditor grading={g.data} />
    </>
  );
}
