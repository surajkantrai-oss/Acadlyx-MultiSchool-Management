import type { AcademicYear, Branch, Grade, Section } from '@acadlyx/types';

export interface Structure {
  years: AcademicYear[];
  grades: Grade[];
  sections: Section[];
  branches: Branch[];
}

/** "Grade 5 A · Main Campus · 2026–27" options for sections that can receive students. */
export function sectionOptions(s: Structure, opts: { usableOnly?: boolean } = {}) {
  const grade = new Map(s.grades.map((g) => [g.id, g]));
  const branch = new Map(s.branches.map((b) => [b.id, b]));
  const year = new Map(s.years.map((y) => [y.id, y]));
  return s.sections
    .filter((x) => {
      if (!opts.usableOnly) return true;
      return (
        x.isActive &&
        grade.get(x.gradeId)?.isActive &&
        branch.get(x.branchId)?.isActive &&
        year.get(x.academicYearId)?.status !== 'CLOSED'
      );
    })
    .map((x) => ({
      value: x.id,
      label: `${grade.get(x.gradeId)?.name ?? '?'} ${x.name} · ${branch.get(x.branchId)?.name ?? '?'} · ${year.get(x.academicYearId)?.name ?? '?'}`,
      yearId: x.academicYearId,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}
