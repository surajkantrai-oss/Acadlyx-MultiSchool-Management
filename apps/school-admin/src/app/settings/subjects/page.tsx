import type { GradeSubject } from '@acadlyx/types';
import { LoadError, NoAccess, PageHeader } from '@/components/setup/states';
import { GradeSubjectsPanel, SubjectsManager } from '@/components/setup/subjects-manager';
import { load, setupContext } from '@/lib/setup';

export const dynamic = 'force-dynamic';

export default async function SubjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; grade?: string }>;
}) {
  const ctx = await setupContext();
  if (!ctx.ok) return null;
  if (!ctx.can('subject.read')) return <NoAccess what="subjects" />;
  const params = await searchParams;
  const q = (params.q ?? '').slice(0, 100);
  const [subjects, allSubjects, grades] = await Promise.all([
    load(() => ctx.academic.subjects(q ? { q } : {})),
    load(() => ctx.academic.subjects()),
    ctx.can('grade.read') ? load(() => ctx.academic.grades()) : Promise.resolve(null),
  ]);
  if (!subjects.ok) return <LoadError status={subjects.status} />;
  const gradeList = grades?.ok ? grades.data : [];
  const grade = gradeList.find((g) => g.id === params.grade) ?? gradeList.find((g) => g.isActive);
  const mapping = grade
    ? await load(() => ctx.academic.gradeSubjects(grade.id))
    : { ok: true as const, data: [] as GradeSubject[] };
  return (
    <>
      <PageHeader title="Subjects">
        The school’s subject catalogue, and which subjects each grade offers.
      </PageHeader>
      <SubjectsManager subjects={subjects.data} query={q} canManage={ctx.can('subject.manage')} />
      {grade && allSubjects.ok ? (
        mapping.ok ? (
          <GradeSubjectsPanel
            grades={gradeList}
            gradeId={grade.id}
            subjects={allSubjects.data}
            mapping={mapping.data}
            canManage={ctx.can('subject.manage')}
          />
        ) : (
          <LoadError status={mapping.status} />
        )
      ) : null}
    </>
  );
}
