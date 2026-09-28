import type { TimetableWeek } from '@acadlyx/types';
import { Card } from '@acadlyx/web-ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AddLesson, RemoveLesson } from '@/components/operations/timetable-editor';
import { WeekGrid } from '@/components/operations/week-grid';
import { personName } from '@/components/people/shared';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { ContextBar } from '@/components/shell/context-bar';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { academicContext, contextQuery } from '@/lib/context';
import { load, setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Weekly timetable: a class's week (`?section=`) or a teacher's week (`?teacher=`, `me` for the
 * signed-in teacher). Teachers see their own week and the classes they teach; only
 * `timetable.manage` edits (the API enforces both).
 */
export default async function TimetablePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; branch?: string; section?: string; teacher?: string }>;
}) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('timetable.read')) return <NoAccess what="timetables" />;
  const sp = await searchParams;
  const academic = await academicContext(ctx, sp);
  const schoolWide = ctx.can('people.read_all');
  const [classes, teachers] = await Promise.all([
    ctx.can('enrollment.read') ? load(() => ctx.admin.classes(contextQuery(academic))) : null,
    schoolWide && ctx.can('teacher.read')
      ? load(() => ctx.people.teachers({ status: 'ACTIVE', pageSize: 100 }))
      : null,
  ]);
  const classList = classes?.ok ? classes.data : [];
  const teacherList = teachers?.ok ? teachers.data.items : [];
  const section = sp.section && UUID.test(sp.section) ? sp.section : undefined;
  const teacher =
    sp.teacher === 'me' || (sp.teacher && UUID.test(sp.teacher)) ? sp.teacher : undefined;
  // Default view: a teacher's own week; for leadership the first class of the context.
  const view: { kind: 'section'; id: string } | { kind: 'teacher'; id: string } | null = section
    ? { kind: 'section', id: section }
    : teacher
      ? { kind: 'teacher', id: teacher }
      : !schoolWide
        ? { kind: 'teacher', id: 'me' }
        : classList[0]
          ? { kind: 'section', id: classList[0].sectionId }
          : null;
  const week = view
    ? await load<TimetableWeek>(() =>
        view.kind === 'section'
          ? ctx.ops.sectionWeek(view.id)
          : ctx.ops.teacherWeek(view.id, academic.year?.id),
      )
    : null;
  if (week && !week.ok && week.status === 404) notFound();
  const editable = Boolean(week?.ok && week.data.editable && view?.kind === 'section');
  const detail = editable && view ? await load(() => ctx.admin.class(view.id)) : null;
  const pairs = detail?.ok
    ? (detail.data.teachers ?? [])
        .filter((t) => t.type === 'SUBJECT_TEACHER' && t.subjectId && t.teacherStatus === 'ACTIVE')
        .map((t) => ({
          subjectId: t.subjectId ?? '',
          subjectName: t.subjectName ?? '',
          teacherId: t.teacherId,
          teacherName: t.teacherName,
        }))
    : [];
  const keep = {
    ...(academic.year ? { year: academic.year.id } : {}),
    branch: academic.branch?.id ?? 'all',
  };
  const q = (extra: Record<string, string>) =>
    `/timetable?${new URLSearchParams({ ...keep, ...extra }).toString()}`;
  return (
    <>
      <Breadcrumbs items={[{ label: 'Academics' }, { label: 'Timetable' }]} />
      <PageHeader title="Timetable">
        The recurring weekly schedule for the academic year. Times are local to each branch.
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
      <nav
        aria-label="Choose a timetable"
        className="flex flex-wrap gap-2 text-sm"
        data-testid="timetable-picker"
      >
        {!schoolWide ? (
          <Link
            href={q({ teacher: 'me' })}
            aria-current={view?.kind === 'teacher' ? 'page' : undefined}
            className={`rounded-full px-3 py-1 ring-1 ring-slate-200 ${view?.kind === 'teacher' ? 'bg-slate-900 text-white' : 'bg-white'}`}
          >
            My timetable
          </Link>
        ) : null}
        {classList.map((c) => (
          <Link
            key={c.sectionId}
            href={q({ section: c.sectionId })}
            aria-current={view?.kind === 'section' && view.id === c.sectionId ? 'page' : undefined}
            className={`rounded-full px-3 py-1 ring-1 ring-slate-200 ${
              view?.kind === 'section' && view.id === c.sectionId
                ? 'bg-slate-900 text-white'
                : 'bg-white'
            }`}
          >
            {c.sectionName}
            {academic.branch ? '' : ` · ${c.branchName}`}
          </Link>
        ))}
      </nav>
      {teacherList.length ? (
        <form method="get" className="flex flex-wrap items-end gap-2">
          {Object.entries(keep).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <label className="flex flex-col text-xs font-medium text-slate-600">
            Teacher’s week
            <select
              name="teacher"
              defaultValue={view?.kind === 'teacher' ? view.id : ''}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">Choose a teacher</option>
              {teacherList.map((t) => (
                <option key={t.id} value={t.id}>
                  {personName(t)} ({t.employeeId})
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-md px-3 py-1.5 text-sm ring-1 ring-slate-300">
            Show
          </button>
        </form>
      ) : null}
      {ctx.can('timetable.manage') ? (
        <p className="text-sm">
          <Link
            className="underline"
            href={`/timetable/periods?${new URLSearchParams(keep).toString()}`}
          >
            Set up periods (bell schedule)
          </Link>
        </p>
      ) : null}
      {!week ? (
        <p className="text-sm text-slate-600">
          No classes are configured for this academic year yet.
        </p>
      ) : !week.ok ? (
        <LoadError status={week.status} />
      ) : (
        <section aria-labelledby="week-heading" className="flex flex-col gap-3">
          <h2 id="week-heading" className="text-lg font-semibold">
            {week.data.view === 'teacher' ? `Week of ${week.data.title}` : week.data.title} ·{' '}
            {week.data.academicYearName}
          </h2>
          <WeekGrid
            week={week.data}
            renderActions={
              editable
                ? (e) => (
                    <RemoveLesson
                      entryId={e.id}
                      label={`${e.subjectName} on ${e.weekday.toLowerCase()} ${e.periodName}`}
                    />
                  )
                : undefined
            }
          />
          {editable && view ? (
            <Card title="Add a lesson">
              <AddLesson
                sectionId={view.id}
                workingDays={week.data.workingDays}
                periods={week.data.periods
                  .filter((p) => p.type === 'INSTRUCTIONAL')
                  .map((p) => ({ id: p.id, label: `${p.name} (${p.startTime}–${p.endTime})` }))}
                pairs={pairs}
              />
            </Card>
          ) : null}
        </section>
      )}
    </>
  );
}
