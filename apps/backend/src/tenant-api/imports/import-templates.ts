import type { ImportTemplate, ImportTemplateColumn, ImportType } from '@acadlyx/types';

/**
 * Import templates — the SINGLE source for the downloadable CSV/XLSX templates AND the header
 * validation (validators use the same column names), so templates can never drift from the
 * rules. Bump `TEMPLATE_VERSION` when columns change.
 */
export const TEMPLATE_VERSION = 1;

const col = (
  name: string,
  required: boolean,
  description: string,
  example: string,
): ImportTemplateColumn => ({
  name,
  required,
  description,
  example,
});

const guardianColumns = (n: 1 | 2): ImportTemplateColumn[] => [
  col(
    `guardian${String(n)}_parent_code`,
    false,
    'Parent code of an EXISTING parent (import parents first)',
    n === 1 ? 'PAR-0001' : '',
  ),
  col(
    `guardian${String(n)}_relationship`,
    false,
    'FATHER, MOTHER, GUARDIAN, GRANDPARENT, SIBLING or OTHER',
    n === 1 ? 'MOTHER' : '',
  ),
  col(
    `guardian${String(n)}_primary`,
    false,
    'yes/no — at most one primary guardian per student',
    n === 1 ? 'yes' : '',
  ),
  col(
    `guardian${String(n)}_pickup`,
    false,
    'yes/no — authorised to pick the student up',
    n === 1 ? 'yes' : '',
  ),
];

export const IMPORT_TEMPLATES: Record<ImportType, ImportTemplateColumn[]> = {
  STUDENTS: [
    col(
      'admission_number',
      true,
      'Unique within the school; letters, digits, / _ . -',
      'ADM-2026-001',
    ),
    col('first_name', true, 'Given name', 'Aarav'),
    col('middle_name', false, 'Optional', ''),
    col('last_name', false, 'Family name (optional)', 'Sharma'),
    col('preferred_name', false, 'Optional', ''),
    col('date_of_birth', false, 'YYYY-MM-DD', '2019-06-15'),
    col('admission_date', false, 'YYYY-MM-DD', '2026-04-01'),
    col(
      'branch_code',
      false,
      'Placement — branch code (all four placement columns or none)',
      'MAIN',
    ),
    col('academic_year', false, 'Placement — academic year name (planned or active)', '2026–27'),
    col('grade_code', false, 'Placement — grade code', 'G1'),
    col('section_code', false, 'Placement — section code', 'A'),
    ...guardianColumns(1),
    ...guardianColumns(2),
  ],
  PARENTS: [
    col(
      'parent_code',
      false,
      'Recommended: unique code used to link students to this parent',
      'PAR-0001',
    ),
    col('first_name', true, 'Given name', 'Meera'),
    col('middle_name', false, 'Optional', ''),
    col('last_name', false, 'Family name (optional)', 'Sharma'),
    col('email', false, 'Contact email (optional)', 'meera@example.com'),
    col(
      'phone',
      false,
      'Mobile number, e.g. 9876543210 or +919876543210 (needed for a parent login later)',
      '9876543210',
    ),
  ],
  TEACHERS: [
    col('employee_id', true, 'Unique within the school', 'EMP-042'),
    col('first_name', true, 'Given name', 'Ravi'),
    col('middle_name', false, 'Optional', ''),
    col('last_name', false, 'Family name (optional)', 'Kumar'),
    col('email', false, 'Contact email (optional)', 'ravi.kumar@example.com'),
    col('phone', false, 'Mobile number (optional)', '9876500000'),
    col('joining_date', false, 'YYYY-MM-DD', '2024-06-01'),
  ],
};

export function template(type: ImportType): ImportTemplate {
  return { type, version: TEMPLATE_VERSION, columns: IMPORT_TEMPLATES[type] };
}

/** Header check: exact set (order-independent, case/space-insensitive). */
export function checkHeaders(type: ImportType, headers: string[]): string[] {
  const expected = IMPORT_TEMPLATES[type].map((c) => c.name);
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const h of headers) {
    if (seen.has(h)) problems.push(`Duplicate column "${h}"`);
    seen.add(h);
    if (!expected.includes(h)) problems.push(`Unknown column "${h}"`);
  }
  for (const c of IMPORT_TEMPLATES[type])
    if (c.required && !seen.has(c.name)) problems.push(`Missing required column "${c.name}"`);
  return problems;
}
