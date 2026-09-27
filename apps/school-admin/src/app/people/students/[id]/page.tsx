import Link from 'next/link';
import { notFound } from 'next/navigation';
import { personName } from '@/components/people/shared';
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
  const [student, years, grades, sections, branches] = await Promise.all([
    load(() => ctx.people.student(id)),
    canStructure ? load(() => ctx.academic.academicYears()) : null,
    canStructure ? load(() => ctx.academic.grades()) : null,
    canStructure ? load(() => ctx.academic.sections()) : null,
    canStructure ? load(() => ctx.academic.branches()) : null,
  ]);
  if (!student.ok) {
    if (student.status === 404) notFound();
    return <LoadError status={student.status} />;
  }
  const ok = <T,>(r: { ok: true; data: T } | { ok: false } | null, f: T): T =>
    r && r.ok ? r.data : f;
  return (
    <>
      <p className="text-sm">
        <Link className="underline" href="/people/students">
          ← Students
        </Link>
      </p>
      <PageHeader title={personName(student.data)} />
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
