import { Badge } from '@acadlyx/web-ui';
import { notFound } from 'next/navigation';
import { AccountBadge, personName } from '@/components/people/shared';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { StudentDetailView } from '@/components/people/students';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { load, setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('student.read')) return <NoAccess what="students" />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const canStructure =
    ctx.can('section.read') &&
    ctx.can('grade.read') &&
    ctx.can('branch.read') &&
    ctx.can('academic_year.read');
  const [student, years, grades, sections, branches, attendance] = await Promise.all([
    load(() => ctx.people.student(id)),
    canStructure ? load(() => ctx.academic.academicYears()) : null,
    canStructure ? load(() => ctx.academic.grades()) : null,
    canStructure ? load(() => ctx.academic.sections()) : null,
    canStructure ? load(() => ctx.academic.branches()) : null,
    ctx.can('attendance.read') ? load(() => ctx.ops.studentAttendance(id)) : null,
  ]);
  if (!student.ok) {
    if (student.status === 404) notFound();
    return <LoadError status={student.status} />;
  }
  const ok = <T,>(r: { ok: true; data: T } | { ok: false } | null, f: T): T =>
    r && r.ok ? r.data : f;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'People' },
          { label: 'Students', href: '/people/students' },
          { label: personName(student.data) },
        ]}
      />
      <PageHeader title={personName(student.data)} />
      <dl
        className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm"
        data-testid="student-header"
      >
        <div>
          <dt className="text-xs text-slate-500">Admission no.</dt>
          <dd className="font-mono">{student.data.admissionNumber}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Status</dt>
          <dd>
            <Badge tone={student.data.status === 'ACTIVE' ? 'success' : 'neutral'}>
              {student.data.status.toLowerCase()}
            </Badge>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Class</dt>
          <dd>
            {student.data.currentPlacement
              ? `${student.data.currentPlacement.gradeName} ${student.data.currentPlacement.sectionName}`
              : 'Not placed'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Branch</dt>
          <dd>{student.data.currentPlacement?.branchName ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Academic year</dt>
          <dd>{student.data.currentPlacement?.academicYearName ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Login</dt>
          <dd>
            <AccountBadge account={student.data.account} />
          </dd>
        </div>
      </dl>
      {attendance?.ok && attendance.data ? (
        <section
          aria-labelledby="attendance-summary-heading"
          className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          data-testid="student-attendance"
        >
          <h2 id="attendance-summary-heading" className="text-base font-semibold">
            Attendance · {attendance.data.academicYearName}
          </h2>
          <p className="mt-1 text-sm text-slate-700">
            Present {attendance.data.counts.PRESENT} · Late {attendance.data.counts.LATE} · Absent{' '}
            {attendance.data.counts.ABSENT} · Excused {attendance.data.counts.EXCUSED}
            {attendance.data.attendanceRate !== null
              ? ` · Attendance ${String(attendance.data.attendanceRate)}%`
              : ''}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Attendance % = (present + late) ÷ (present + late + absent); excused days are not
            counted.
          </p>
        </section>
      ) : null}
      <StudentDetailView
        student={student.data}
        structure={{
          years: ok(years, []),
          grades: ok(grades, []),
          sections: ok(sections, []),
          branches: ok(branches, []),
        }}
        can={{
          manage: ctx.can('student.manage'),
          enroll: ctx.can('enrollment.manage'),
          accounts: ctx.can('people_account.manage'),
          parents: ctx.can('parent.read'),
        }}
      />
    </>
  );
}
