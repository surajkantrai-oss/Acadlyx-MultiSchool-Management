import { Badge, EmptyState } from '@acadlyx/web-ui';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { ContextBar } from '@/components/shell/context-bar';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { academicContext, contextQuery } from '@/lib/context';
import { load, setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Classes = Sections of the selected academic year/branch (no separate Class entity). Teachers
 * only see classes they actively teach (enforced by the API).
 */
export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; branch?: string; grade?: string }>;
}) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('enrollment.read')) return <NoAccess what="classes" />;
  const sp = await searchParams;
  const academic = await academicContext(ctx, sp);
  const grades = ctx.can('grade.read') ? await load(() => ctx.academic.grades()) : null;
  const gradeList = grades?.ok ? grades.data : [];
  const grade = gradeList.find((g) => g.id === sp.grade && UUID.test(sp.grade));
  const list = await load(() =>
    ctx.admin.classes({ ...contextQuery(academic), ...(grade ? { gradeId: grade.id } : {}) }),
  );
  const keep = new URLSearchParams({
    ...(academic.year ? { year: academic.year.id } : {}),
    branch: academic.branch?.id ?? 'all',
  });
  return (
    <>
      <Breadcrumbs items={[{ label: 'Academics' }, { label: 'Classes' }]} />
      <PageHeader title="Classes">
        Each class is a section of a grade in one branch and academic year. Open a class to see its
        students, teachers and subjects.
      </PageHeader>
      {academic.selectable ? (
        <ContextBar
          years={academic.years.map((y) => ({
            id: y.id,
            label: `${y.name}${y.isCurrent ? ' (current)' : ''}`,
          }))}
          branches={academic.branches.map((b) => ({ id: b.id, label: b.name }))}
          yearId={academic.year?.id ?? null}
          branchId={academic.branch?.id ?? null}
          noCurrentYear={academic.noCurrentYear}
          canConfigureYears={ctx.can('academic_year.manage')}
        />
      ) : null}
      {gradeList.length ? (
        <nav aria-label="Filter by grade" className="flex flex-wrap gap-2 text-sm">
          <Link
            href={`/classes?${keep.toString()}`}
            aria-current={grade ? undefined : 'page'}
            className={`rounded-full px-3 py-1 ring-1 ring-slate-200 ${grade ? 'bg-white' : 'bg-slate-900 text-white'}`}
          >
            All grades
          </Link>
          {gradeList.map((g) => (
            <Link
              key={g.id}
              href={`/classes?${new URLSearchParams({ ...Object.fromEntries(keep), grade: g.id }).toString()}`}
              aria-current={grade?.id === g.id ? 'page' : undefined}
              className={`rounded-full px-3 py-1 ring-1 ring-slate-200 ${grade?.id === g.id ? 'bg-slate-900 text-white' : 'bg-white'}`}
            >
              {g.name}
            </Link>
          ))}
        </nav>
      ) : null}
      {!list.ok ? (
        <LoadError status={list.status} />
      ) : list.data.length === 0 ? (
        <EmptyState title="No classes to show">
          {ctx.can('enrollment.manage') || ctx.can('section.manage') ? (
            <>
              No classes are configured for this academic year.{' '}
              {ctx.can('section.manage') ? (
                <Link className="underline" href="/settings/grades">
                  Configure grades and sections
                </Link>
              ) : (
                'Ask your school administrator to configure grades and sections.'
              )}
            </>
          ) : (
            'You are not assigned to any class in this academic year.'
          )}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm" data-testid="classes-table">
            <caption className="sr-only">
              Classes in {academic.year?.name ?? 'all years'},{' '}
              {academic.branch?.name ?? 'all branches'}
            </caption>
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2">
                  Class
                </th>
                <th scope="col" className="px-4 py-2">
                  Branch
                </th>
                <th scope="col" className="px-4 py-2">
                  Academic year
                </th>
                <th scope="col" className="px-4 py-2 text-right">
                  Students
                </th>
                <th scope="col" className="px-4 py-2 text-right">
                  Teacher assignments
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.sectionId} className="border-t border-slate-100">
                  <th scope="row" className="px-4 py-2 font-medium">
                    <Link
                      href={`/classes/${c.sectionId}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {c.sectionName}
                    </Link>{' '}
                    {c.isActive ? null : <Badge>inactive</Badge>}
                  </th>
                  <td className="px-4 py-2">{c.branchName}</td>
                  <td className="px-4 py-2">{c.academicYearName}</td>
                  <td className="px-4 py-2 text-right">
                    {c.studentCount}
                    {c.capacity ? <span className="text-slate-500"> / {c.capacity}</span> : null}
                  </td>
                  <td className="px-4 py-2 text-right">{c.teacherAssignmentCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
