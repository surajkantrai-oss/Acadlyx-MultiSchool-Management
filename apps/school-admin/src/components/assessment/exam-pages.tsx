import type { ExamStatus, MarkSheetSummary } from '@acadlyx/types';
import { Badge, Card, EmptyState } from '@acadlyx/web-ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pager } from '@/components/people/shared';
import { SearchBox } from '@/components/people/search-box';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { load, setupContext } from '@/lib/setup';
import { ExamForm, ExamLifecycle, ExamStructure } from './exam-editor';
import { GradeScaleEditor } from './grade-scale-editor';
import { MarkSheetEditor } from './mark-sheet';

/**
 * Phase 9 exam pages. Every decision (scope, state, eligibility) is made by the API; the UI only
 * mirrors the server-computed `can` flags. Teachers see published exams of the grades they teach
 * and only the mark sheets of their own Section + Subject assignments.
 */
export const EXAM_STATUS_LABEL: Record<ExamStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Scheduled',
  MARKS_ENTRY: 'Marks entry',
  MARKS_FINALIZED: 'Marks finalized',
  RESULTS_PUBLISHED: 'Results published',
  ARCHIVED: 'Archived',
};
const EXAM_TONE: Record<ExamStatus, 'neutral' | 'success' | 'warning' | 'info'> = {
  DRAFT: 'warning',
  PUBLISHED: 'info',
  MARKS_ENTRY: 'info',
  MARKS_FINALIZED: 'neutral',
  RESULTS_PUBLISHED: 'success',
  ARCHIVED: 'neutral',
};
export const SHEET_LABEL: Record<MarkSheetSummary['status'], string> = {
  NOT_STARTED: 'Not started',
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  FINALIZED: 'Finalized',
  REOPENED: 'Reopened',
};
const UUID = /^[0-9a-f-]{36}$/i;
const btn =
  'inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800';
const btn2 =
  'inline-flex rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50';

export function ExamBadge({ status }: { status: ExamStatus }) {
  return <Badge tone={EXAM_TONE[status]}>{EXAM_STATUS_LABEL[status]}</Badge>;
}

export async function ExamListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; academicYearId?: string }>;
}) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('exam.read')) return <NoAccess what="exams" />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? '').slice(0, 100);
  const status = sp.status && sp.status in EXAM_STATUS_LABEL ? sp.status : undefined;
  const academicYearId =
    sp.academicYearId && UUID.test(sp.academicYearId) ? sp.academicYearId : undefined;
  const list = await load(() =>
    ctx.assessment.exams({
      ...(q ? { q } : {}),
      ...(status ? { status } : {}),
      ...(academicYearId ? { academicYearId } : {}),
      page,
      pageSize: 20,
    }),
  );
  const manage = ctx.can('exam.manage');
  return (
    <>
      <Breadcrumbs items={[{ label: 'Academics' }, { label: 'Exams' }]} />
      <PageHeader title="Exams">
        Exams, papers and marks for each grade. Results are released to parents and students only
        when leadership publishes them.
      </PageHeader>
      {manage ? (
        <p className="flex flex-wrap gap-2">
          <Link href="/exams/new" className={btn}>
            New exam
          </Link>
          <Link href="/exams/grade-scales" className={btn2}>
            Grade scales
          </Link>
        </p>
      ) : null}
      <SearchBox
        base="/exams"
        q={q}
        label="Search exams"
        hint="Exam name"
        hidden={academicYearId ? { academicYearId } : {}}
        status={{
          value: status ?? '',
          options: [
            { value: '', label: 'Current (not archived)' },
            ...Object.entries(EXAM_STATUS_LABEL).map(([value, label]) => ({ value, label })),
          ],
        }}
      />
      {!list.ok ? (
        <LoadError status={list.status} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title={q || status ? 'No exam matches' : 'No exams yet'}>
          {!(q || status) && manage ? 'Create the first exam of the academic year.' : null}
        </EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm" data-testid="exams-table">
              <caption className="sr-only">Exams</caption>
              <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-2">
                    Exam
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Grades
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Dates
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.data.items.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-2">
                      <Link
                        href={`/exams/${e.id}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {e.name}
                      </Link>
                      <div className="text-xs text-slate-500">{e.academicYearName}</div>
                    </td>
                    <td className="px-4 py-2">{e.gradeNames.join(', ') || '—'}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {e.startDate} – {e.endDate}
                    </td>
                    <td className="px-4 py-2">
                      <ExamBadge status={e.status} />
                      {e.currentPublicationVersion ? (
                        <span className="ml-2 text-xs text-slate-500">
                          v{e.currentPublicationVersion}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            page={list.data.page}
            totalPages={list.data.totalPages}
            total={list.data.total}
            base="/exams"
            params={{ q: q || undefined, status, academicYearId }}
          />
        </>
      )}
    </>
  );
}

async function yearsAndScales(ctx: Awaited<ReturnType<typeof setupContext>> & { ok: true }) {
  const years = await load(() => ctx.academic.academicYears());
  const usable = years.ok ? years.data.filter((y) => y.status !== 'CLOSED') : [];
  const scales = await Promise.all(
    usable.map(async (y) => {
      const r = await load(() => ctx.assessment.gradeScales(y.id));
      return r.ok ? r.data.map((s) => ({ id: s.id, name: s.name, academicYearId: y.id })) : [];
    }),
  );
  return {
    years: usable.map((y) => ({ id: y.id, name: y.name, isCurrent: y.isCurrent })),
    scales: scales.flat(),
  };
}

export async function NewExamPage() {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('exam.manage')) return <NoAccess what="creating exams" />;
  const { years, scales } = await yearsAndScales(ctx);
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Academics' }, { label: 'Exams', href: '/exams' }, { label: 'New exam' }]}
      />
      <PageHeader title="New exam">
        Start with the name and dates. Subjects, components (papers) and branch schedules are added
        next, while the exam is a draft.
      </PageHeader>
      {years.length === 0 ? (
        <EmptyState title="No open academic year">
          Create or open an academic year first.
        </EmptyState>
      ) : (
        <ExamForm years={years} scales={scales} exam={null} />
      )}
    </>
  );
}

export async function ExamDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('exam.read')) return <NoAccess what="exams" />;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const exam = await load(() => ctx.assessment.exam(id));
  if (!exam.ok) {
    if (exam.status === 404) notFound();
    return <LoadError status={exam.status} />;
  }
  const e = exam.data;
  const showSheets = e.status !== 'DRAFT' && e.status !== 'PUBLISHED';
  const sheetPage = Math.max(1, Number((await searchParams).page) || 1);
  const sheets = showSheets
    ? await load(() => ctx.assessment.sheets(id, { page: sheetPage, pageSize: 50 }))
    : null;
  const edit = e.can.edit && ctx.can('exam.manage');
  const extra = edit ? await yearsAndScales(ctx) : null;
  const grades = edit ? await load(() => ctx.academic.grades()) : null;
  const subjects = edit ? await load(() => ctx.academic.subjects({ active: true })) : null;
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Academics' }, { label: 'Exams', href: '/exams' }, { label: e.name }]}
      />
      <div className="flex flex-wrap items-center gap-3">
        <PageHeader title={e.name} />
        <ExamBadge status={e.status} />
      </div>
      <p className="text-sm text-slate-600">
        {e.academicYearName} · {e.startDate} – {e.endDate}
        {e.gradeScale ? ` · Grade scale: ${e.gradeScale.name}` : ' · No grade scale'}
        {e.currentPublicationVersion
          ? ` · Results version ${String(e.currentPublicationVersion)} published`
          : ''}
      </p>
      {e.description ? <p className="text-sm whitespace-pre-line">{e.description}</p> : null}
      <ExamLifecycle exam={e} />
      {(e.status === 'MARKS_FINALIZED' ||
        e.status === 'RESULTS_PUBLISHED' ||
        e.status === 'MARKS_ENTRY') &&
      ctx.can('results.read') ? (
        <p>
          <Link href={`/exams/${e.id}/results`} className={btn2}>
            Results
          </Link>
        </p>
      ) : null}
      {edit && extra ? (
        <Card title="Exam details">
          <ExamForm years={extra.years} scales={extra.scales} exam={e} />
        </Card>
      ) : null}
      <ExamStructure
        exam={e}
        editable={edit}
        grades={
          grades?.ok
            ? grades.data.filter((g) => g.isActive).map((g) => ({ id: g.id, name: g.name }))
            : []
        }
        subjects={subjects?.ok ? subjects.data.map((s) => ({ id: s.id, name: s.name })) : []}
      />
      {sheets ? (
        <Card title="Mark sheets">
          {!sheets.ok ? (
            <LoadError status={sheets.status} />
          ) : sheets.data.items.length === 0 ? (
            <p className="text-sm text-slate-600">
              No mark sheets are available to you for this exam.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="sheets-table">
                <caption className="sr-only">Mark sheets for {e.name}</caption>
                <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Class
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Subject
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Progress
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sheets.data.items.map((s) => (
                    <tr key={`${s.examSubjectId}-${s.sectionId}`}>
                      <td className="px-3 py-2">
                        {s.className}
                        <div className="text-xs text-slate-500">{s.branchName}</div>
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/exams/${e.id}/marks/${s.examSubjectId}/${s.sectionId}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {s.subjectName}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        {s.enteredCount} / {s.requiredCount} marks · {s.studentCount} students
                      </td>
                      <td className="px-3 py-2">{SHEET_LABEL[s.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sheets.ok && sheets.data.totalPages > 1 ? (
            <Pager
              page={sheets.data.page}
              totalPages={sheets.data.totalPages}
              total={sheets.data.total}
              base={`/exams/${e.id}`}
              params={{}}
            />
          ) : null}
        </Card>
      ) : null}
    </>
  );
}

export async function MarkSheetPage({
  params,
}: {
  params: Promise<{ id: string; examSubjectId: string; sectionId: string }>;
}) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('exam.read')) return <NoAccess what="mark sheets" />;
  const { id, examSubjectId, sectionId } = await params;
  if (![id, examSubjectId, sectionId].every((v) => UUID.test(v))) notFound();
  const sheet = await load(() => ctx.assessment.sheet(id, examSubjectId, sectionId));
  if (!sheet.ok) {
    if (sheet.status === 404) notFound();
    return <LoadError status={sheet.status} />;
  }
  const s = sheet.data;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Academics' },
          { label: 'Exams', href: '/exams' },
          { label: s.examName, href: `/exams/${id}` },
          { label: `${s.className} · ${s.subjectName}` },
        ]}
      />
      <PageHeader title={`${s.subjectName} marks — ${s.className}`}>
        Status: {SHEET_LABEL[s.status]}. Enter marks, or mark a student Absent (counts as zero and
        fails the paper) or Exempt (excluded from the totals).
      </PageHeader>
      {/* key = version: after a save/transition the editor restarts from the server's values. */}
      <MarkSheetEditor key={`${s.status}-${String(s.version)}`} sheet={s} />
    </>
  );
}

export async function GradeScalesPage({
  searchParams,
}: {
  searchParams: Promise<{ academicYearId?: string }>;
}) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('exam.read')) return <NoAccess what="grade scales" />;
  const years = await load(() => ctx.academic.academicYears());
  if (!years.ok) return <LoadError status={years.status} />;
  const sp = await searchParams;
  const year =
    years.data.find((y) => y.id === sp.academicYearId) ??
    years.data.find((y) => y.isCurrent) ??
    years.data[0];
  const scales = year ? await load(() => ctx.assessment.gradeScales(year.id)) : null;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Academics' },
          { label: 'Exams', href: '/exams' },
          { label: 'Grade scales' },
        ]}
      />
      <PageHeader title="Grade scales">
        Percentage bands that turn a result into a grade. Bands must cover 0–100 exactly: each band
        includes its minimum and excludes its maximum, except the top band which includes 100.
      </PageHeader>
      <nav aria-label="Academic year" className="flex flex-wrap gap-2 text-sm">
        {years.data.map((y) => (
          <Link
            key={y.id}
            href={`/exams/grade-scales?academicYearId=${y.id}`}
            aria-current={y.id === year?.id ? 'page' : undefined}
            className={
              y.id === year?.id ? 'font-semibold underline' : 'underline-offset-2 hover:underline'
            }
          >
            {y.name}
          </Link>
        ))}
      </nav>
      {!year ? (
        <EmptyState title="No academic year">Create an academic year first.</EmptyState>
      ) : !scales?.ok ? (
        <LoadError status={scales?.status ?? 500} />
      ) : (
        <GradeScaleEditor
          academicYearId={year.id}
          scales={scales.data}
          editable={ctx.can('exam.manage') && year.status !== 'CLOSED'}
        />
      )}
    </>
  );
}
