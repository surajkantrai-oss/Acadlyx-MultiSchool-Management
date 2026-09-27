import Link from 'next/link';
import { notFound } from 'next/navigation';
import { personName } from '@/components/people/shared';
import { TeacherDetailView } from '@/components/people/teachers';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { load, setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

export default async function TeacherPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('teacher.read')) return <NoAccess what="teachers" />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const canAssign = ctx.can('teacher_assignment.manage');
  const [teacher, years, grades, sections, branches, subjects] = await Promise.all([
    load(() => ctx.people.teacher(id)),
    canAssign ? load(() => ctx.academic.academicYears()) : null,
    canAssign ? load(() => ctx.academic.grades()) : null,
    canAssign ? load(() => ctx.academic.sections()) : null,
    canAssign ? load(() => ctx.academic.branches()) : null,
    canAssign && ctx.can('subject.read') ? load(() => ctx.academic.subjects()) : null,
  ]);
  if (!teacher.ok) {
    if (teacher.status === 404) notFound();
    return <LoadError status={teacher.status} />;
  }
  const ok = <T,>(r: { ok: true; data: T } | { ok: false } | null, f: T): T =>
    r && r.ok ? r.data : f;
  return (
    <>
      <p className="text-sm">
        <Link className="underline" href="/people/teachers">
          ← Teachers
        </Link>
      </p>
      <PageHeader title={personName(teacher.data)} />
      <TeacherDetailView
        teacher={teacher.data}
        structure={{
          years: ok(years, []),
          grades: ok(grades, []),
          sections: ok(sections, []),
          branches: ok(branches, []),
        }}
        subjects={ok(subjects, [])}
        can={{
          manage: ctx.can('teacher.manage'),
          assign: canAssign,
          accounts: ctx.can('people_account.manage'),
        }}
      />
    </>
  );
}
