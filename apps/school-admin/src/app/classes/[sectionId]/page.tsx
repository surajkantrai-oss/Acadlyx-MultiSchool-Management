import { Badge, Card, EmptyState } from '@acadlyx/web-ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  AssignTeacher,
  EndAssignmentButton,
  EnrollIntoClass,
} from '@/components/classes/class-actions';
import { AccountBadge, Dl, personName } from '@/components/people/shared';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { load, setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

const REL: Record<string, string> = {
  FATHER: 'Father',
  MOTHER: 'Mother',
  GUARDIAN: 'Guardian',
  GRANDPARENT: 'Grandparent',
  SIBLING: 'Sibling',
  OTHER: 'Other',
};

/** Class roster: who is in this class, who teaches it, and which subjects the grade has. */
export default async function ClassPage({ params }: { params: Promise<{ sectionId: string }> }) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('enrollment.read')) return <NoAccess what="classes" />;
  const { sectionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(sectionId)) notFound();
  const canAssign = ctx.can('teacher_assignment.manage') && ctx.can('teacher.read');
  const [detail, teachers] = await Promise.all([
    load(() => ctx.admin.class(sectionId)),
    canAssign ? load(() => ctx.people.teachers({ status: 'ACTIVE', pageSize: 100 })) : null,
  ]);
  if (!detail.ok) {
    if (detail.status === 404) notFound();
    return <LoadError status={detail.status} />;
  }
  const c = detail.data;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Academics' },
          { label: 'Classes', href: '/classes' },
          { label: c.sectionName },
        ]}
      />
      <PageHeader title={c.sectionName}>
        {c.branchName} · {c.academicYearName}
        {c.isActive ? '' : ' · inactive'}
      </PageHeader>
      <nav
        aria-label="Class operations"
        className="flex flex-wrap gap-2 text-sm"
        data-testid="class-ops"
      >
        {[
          ctx.can('attendance.read') && { href: `/attendance/${c.sectionId}`, label: 'Attendance' },
          ctx.can('timetable.read') && {
            href: `/timetable?section=${c.sectionId}`,
            label: 'Timetable',
          },
          ctx.can('homework.read') && {
            href: `/homework?sectionId=${c.sectionId}`,
            label: 'Homework',
          },
          ctx.can('assignment.read') && {
            href: `/assignments?sectionId=${c.sectionId}`,
            label: 'Assignments',
          },
        ]
          .filter((l): l is { href: string; label: string } => Boolean(l))
          .map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200 hover:bg-slate-50"
            >
              {l.label}
            </Link>
          ))}
      </nav>
      <Card title="Class">
        <Dl
          items={[
            ['Grade', c.gradeName],
            ['Section code', c.sectionCode],
            ['Branch', c.branchName],
            ['Academic year', c.academicYearName],
            [
              'Students',
              `${String(c.studentCount)}${c.capacity ? ` of ${String(c.capacity)} places` : ''}`,
            ],
            ['Teacher assignments', c.teachers ? String(c.teachers.length) : '—'],
          ]}
        />
      </Card>

      <section aria-labelledby="roster-heading" className="flex flex-col gap-3">
        <h2 id="roster-heading" className="text-lg font-semibold">
          Students
        </h2>
        {c.roster.length === 0 ? (
          <EmptyState title="No students in this class yet" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm" data-testid="roster-table">
              <caption className="sr-only">Students enrolled in {c.sectionName}</caption>
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2">
                    Admission no.
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Student
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Guardians
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Login
                  </th>
                </tr>
              </thead>
              <tbody>
                {c.roster.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono">{s.admissionNumber}</td>
                    <th scope="row" className="px-4 py-2 font-medium">
                      <Link
                        href={`/people/students/${s.id}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {personName(s)}
                      </Link>
                    </th>
                    <td className="px-4 py-2">
                      <Badge tone={s.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {s.status.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      {s.primaryGuardian
                        ? `${personName(s.primaryGuardian)} (${REL[s.primaryGuardian.relationship] ?? 'Guardian'})`
                        : s.guardianCount
                          ? `${String(s.guardianCount)} linked`
                          : 'None linked'}
                      {s.primaryGuardian && s.guardianCount > 1 ? (
                        <span className="text-slate-500"> +{s.guardianCount - 1}</span>
                      ) : null}
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
        {ctx.can('enrollment.manage') && ctx.can('student.read') ? (
          <Card title="Add a student to this class">
            <EnrollIntoClass sectionId={c.sectionId} />
          </Card>
        ) : null}
      </section>

      {c.teachers ? (
        <section aria-labelledby="teachers-heading" className="flex flex-col gap-3">
          <h2 id="teachers-heading" className="text-lg font-semibold">
            Teachers
          </h2>
          {c.teachers.length === 0 ? (
            <EmptyState title="No teachers assigned yet" />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-left text-sm" data-testid="class-teachers-table">
                <caption className="sr-only">Teachers assigned to {c.sectionName}</caption>
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-2">
                      Teacher
                    </th>
                    <th scope="col" className="px-4 py-2">
                      Role
                    </th>
                    <th scope="col" className="px-4 py-2">
                      Subject
                    </th>
                    {canAssign ? (
                      <th scope="col" className="px-4 py-2">
                        <span className="sr-only">Actions</span>
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {c.teachers.map((t) => (
                    <tr key={t.assignmentId} className="border-t border-slate-100">
                      <th scope="row" className="px-4 py-2 font-medium">
                        {ctx.can('teacher.read') ? (
                          <Link
                            href={`/people/teachers/${t.teacherId}`}
                            className="underline-offset-2 hover:underline"
                          >
                            {t.teacherName}
                          </Link>
                        ) : (
                          t.teacherName
                        )}{' '}
                        <span className="font-mono text-xs text-slate-500">{t.employeeId}</span>
                        {t.teacherStatus === 'INACTIVE' ? <Badge>inactive</Badge> : null}
                      </th>
                      <td className="px-4 py-2">
                        {t.type === 'CLASS_TEACHER' ? 'Class teacher' : 'Subject teacher'}
                      </td>
                      <td className="px-4 py-2">{t.subjectName ?? '—'}</td>
                      {canAssign ? (
                        <td className="px-4 py-2 text-right">
                          <EndAssignmentButton
                            teacherId={t.teacherId}
                            assignmentId={t.assignmentId}
                            label={`${t.teacherName} (${t.subjectName ?? 'class teacher'})`}
                          />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {canAssign && teachers?.ok ? (
            <Card title="Assign a teacher">
              <AssignTeacher
                sectionId={c.sectionId}
                teachers={teachers.data.items.map((t) => ({
                  id: t.id,
                  label: `${personName(t)} (${t.employeeId})`,
                }))}
                subjects={c.subjects ?? []}
              />
            </Card>
          ) : null}
        </section>
      ) : null}

      {c.subjects ? (
        <section aria-labelledby="subjects-heading" className="flex flex-col gap-3">
          <h2 id="subjects-heading" className="text-lg font-semibold">
            Subjects for {c.gradeName}
          </h2>
          {c.subjects.length === 0 ? (
            <EmptyState title="No subjects configured for this grade">
              {ctx.can('subject.manage') ? (
                <Link className="underline" href="/settings/subjects">
                  Configure subjects
                </Link>
              ) : null}
            </EmptyState>
          ) : (
            <ul className="flex flex-wrap gap-2" data-testid="class-subjects">
              {c.subjects.map((s) => (
                <li
                  key={s.id}
                  className="rounded-full bg-white px-3 py-1 text-sm ring-1 ring-slate-200"
                >
                  {s.name}
                  {s.isRequired ? '' : <span className="text-slate-500"> (optional)</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </>
  );
}
