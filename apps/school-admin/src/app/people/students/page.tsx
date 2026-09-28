import { Badge, EmptyState } from '@acadlyx/web-ui';
import Link from 'next/link';
import { CreateStudentForm, StudentFilters } from '@/components/people/students';
import { accountFilter, AccountBadge, Pager, personName } from '@/components/people/shared';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { load, setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

type Search = {
  q?: string;
  page?: string;
  status?: string;
  academicYearId?: string;
  sectionId?: string;
  gradeId?: string;
  branchId?: string;
  account?: string;
  quality?: string;
};
const UUID = /^[0-9a-f-]{36}$/i;
const STATUSES = ['ACTIVE', 'INACTIVE', 'WITHDRAWN', 'GRADUATED'] as const;

export default async function StudentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('student.read')) return <NoAccess what="students" />;
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status);
  const ids = Object.fromEntries(
    (['academicYearId', 'sectionId', 'gradeId', 'branchId'] as const)
      .map((k) => [k, sp[k] && UUID.test(sp[k]) ? sp[k] : undefined])
      .filter(([, v]) => v),
  ) as Partial<Record<'academicYearId' | 'sectionId' | 'gradeId' | 'branchId', string>>;
  const account = accountFilter(sp.account);
  const quality =
    sp.quality === 'NO_ENROLLMENT' || sp.quality === 'NO_GUARDIAN' ? sp.quality : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? '').slice(0, 100);
  const canStructure =
    ctx.can('grade.read') &&
    ctx.can('section.read') &&
    ctx.can('academic_year.read') &&
    ctx.can('branch.read');
  const [list, years, grades, sections, branches] = await Promise.all([
    load(() =>
      ctx.people.students({
        ...(q ? { q } : {}),
        ...(status ? { status } : {}),
        ...(account ? { account } : {}),
        ...(quality ? { quality } : {}),
        ...ids,
        page,
        pageSize: 25,
      }),
    ),
    canStructure ? load(() => ctx.academic.academicYears()) : null,
    canStructure ? load(() => ctx.academic.grades()) : null,
    canStructure ? load(() => ctx.academic.sections()) : null,
    canStructure ? load(() => ctx.academic.branches()) : null,
  ]);
  if (!list.ok) return <LoadError status={list.status} />;
  const ok = <T,>(r: { ok: true; data: T } | { ok: false } | null, fallback: T): T =>
    r && r.ok ? r.data : fallback;
  const structure = {
    years: ok(years, []),
    grades: ok(grades, []),
    sections: ok(sections, []),
    branches: ok(branches, []),
  };
  const { items, total, totalPages } = list.data;
  return (
    <>
      <Breadcrumbs items={[{ label: 'People' }, { label: 'Students' }]} />
      <PageHeader title="Students">
        School profiles, placement and guardians. Profiles are separate from login accounts.
      </PageHeader>
      {ctx.can('student.manage') ? (
        <CreateStudentForm structure={structure} canEnroll={ctx.can('enrollment.manage')} />
      ) : null}
      <StudentFilters
        q={q}
        status={status ?? ''}
        structure={structure}
        selected={ids}
        account={account ?? ''}
        quality={quality ?? ''}
      />
      {items.length === 0 ? (
        <EmptyState
          title={
            q || status || account || quality || Object.keys(ids).length
              ? 'No students match these filters'
              : 'No students yet'
          }
        >
          {!(q || status || account || quality || Object.keys(ids).length) &&
          ctx.can('student.manage') ? (
            <>
              Add a student above
              {ctx.can('bulk_import.manage') ? (
                <>
                  {' '}
                  or{' '}
                  <Link className="underline" href="/people/imports">
                    import a CSV/XLSX file
                  </Link>
                </>
              ) : null}
              .
            </>
          ) : null}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm" data-testid="students-table">
            <caption className="sr-only">Students</caption>
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2">
                  Name
                </th>
                <th scope="col" className="px-4 py-2">
                  Admission no.
                </th>
                <th scope="col" className="px-4 py-2">
                  Current placement
                </th>
                <th scope="col" className="px-4 py-2">
                  Status
                </th>
                <th scope="col" className="px-4 py-2">
                  Login
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <th scope="row" className="px-4 py-2 font-medium">
                    <Link
                      href={`/people/students/${s.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {personName(s)}
                    </Link>
                  </th>
                  <td className="px-4 py-2 font-mono">{s.admissionNumber}</td>
                  <td className="px-4 py-2">
                    {s.currentPlacement
                      ? `${s.currentPlacement.gradeName} ${s.currentPlacement.sectionName} · ${s.currentPlacement.branchName} · ${s.currentPlacement.academicYearName}`
                      : '—'}
                  </td>
                  <td className="px-4 py-2">
                    <Badge
                      tone={
                        s.status === 'ACTIVE'
                          ? 'success'
                          : s.status === 'GRADUATED'
                            ? 'info'
                            : 'neutral'
                      }
                    >
                      {s.status.toLowerCase()}
                    </Badge>
                  </td>
                  <td className="px-4 py-2">
                    <AccountBadge account={s.account} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager
        page={page}
        totalPages={totalPages}
        total={total}
        base="/people/students"
        params={{ q, status, account, quality, ...ids }}
      />
    </>
  );
}
