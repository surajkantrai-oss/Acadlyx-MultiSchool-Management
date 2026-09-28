import type { PermissionKey } from '@acadlyx/permissions';

export interface NavLink {
  href: string;
  label: string;
  /** Extra path prefixes that mark this link as active. */
  match?: string[];
}
export interface NavGroup {
  label: string;
  links: NavLink[];
}

/**
 * School Admin information architecture (Phase 6). Visibility is derived from permissions only —
 * never role names. Hiding a link is NOT authorisation: every page and API re-checks.
 */
export function buildNav(can: (p: PermissionKey) => boolean): NavGroup[] {
  const groups: NavGroup[] = [
    { label: 'Overview', links: [{ href: '/', label: 'Dashboard' }] },
    {
      label: 'People',
      links: [
        can('student.read') && { href: '/people/students', label: 'Students' },
        can('parent.read') && { href: '/people/parents', label: 'Parents / guardians' },
        can('teacher.read') && { href: '/people/teachers', label: 'Teachers' },
        can('people_account.manage') && { href: '/people/access', label: 'Login access' },
        can('bulk_import.read') && { href: '/people/imports', label: 'Bulk import' },
      ].filter((l): l is NavLink => Boolean(l)),
    },
    {
      label: 'Academics',
      links: [
        can('enrollment.read') && { href: '/classes', label: 'Classes' },
        can('grade.read') && { href: '/settings/grades', label: 'Grades & sections' },
        can('subject.read') && { href: '/settings/subjects', label: 'Subjects' },
      ].filter((l): l is NavLink => Boolean(l)),
    },
    {
      label: 'School setup',
      links: [
        can('school.read') && { href: '/settings/school', label: 'School profile' },
        can('branch.read') && { href: '/settings/branches', label: 'Branches' },
        can('academic_year.read') && { href: '/settings/academic-years', label: 'Academic years' },
        can('academic_configuration.read') && {
          href: '/settings/academic',
          label: 'Academic settings',
        },
      ].filter((l): l is NavLink => Boolean(l)),
    },
    { label: 'Account', links: [{ href: '/security', label: 'Security & sessions' }] },
  ];
  return groups.filter((g) => g.links.length > 0);
}
