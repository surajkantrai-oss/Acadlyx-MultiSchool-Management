import type { ImportRowError, ImportType } from '@acadlyx/types';
import {
  GUARDIAN_RELATIONSHIPS,
  parentProfileSchema,
  studentProfileSchema,
  teacherProfileSchema,
} from '@acadlyx/validation';
import { normalizeEmail, normalizePhone } from '../../auth/core/identifiers.js';
import type { School } from '../../generated/prisma/client.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import type { ParsedRow } from './import-parser.js';

export type RowData = Record<string, string | null>;

export interface ValidatedRow {
  rowNumber: number;
  valid: boolean;
  data: RowData;
  errors: ImportRowError[];
}

/** Tenant-scoped reference data, loaded once per upload (never another tenant's objects). */
interface Context {
  sections: Map<string, { id: string; usable: boolean }>;
  existingKeys: Set<string>;
  parentCodes: Map<string, { active: boolean }>;
}

const SNAKE: Record<string, string> = {
  admissionNumber: 'admission_number',
  firstName: 'first_name',
  middleName: 'middle_name',
  lastName: 'last_name',
  preferredName: 'preferred_name',
  dateOfBirth: 'date_of_birth',
  admissionDate: 'admission_date',
  parentCode: 'parent_code',
  employeeId: 'employee_id',
  joiningDate: 'joining_date',
  email: 'email',
  phone: 'phone',
};

const YES = new Set(['yes', 'y', 'true', '1']);
const NO = new Set(['no', 'n', 'false', '0', '']);

/**
 * Validates every row BEFORE anything is created. References (branch/year/grade/section codes,
 * parent codes) resolve only within the current school; duplicate keys — already in the school
 * or earlier in the same file — are rejected (approved policy: no "update existing").
 */
export async function validateRows(
  tx: TenantTransaction,
  school: School,
  type: ImportType,
  rows: ParsedRow[],
): Promise<ValidatedRow[]> {
  const ctx = await loadContext(tx, school, type);
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const errors: ImportRowError[] = [...row.problems];
    const v = row.values;
    let data: RowData = {};
    let key: string | null = null;

    if (type === 'STUDENTS') {
      const parsed = studentProfileSchema.safeParse({
        admissionNumber: v.admission_number ?? '',
        firstName: v.first_name ?? '',
        middleName: v.middle_name,
        lastName: v.last_name,
        preferredName: v.preferred_name,
        dateOfBirth: v.date_of_birth,
        admissionDate: v.admission_date,
      });
      if (parsed.success) {
        data = snake(parsed.data);
        key = parsed.data.admissionNumber;
      } else errors.push(...zodErrors(parsed.error.issues));
      placement(v, ctx, data, errors);
      guardians(v, ctx, data, errors);
    } else if (type === 'PARENTS') {
      const parsed = parentProfileSchema.safeParse({
        parentCode: v.parent_code,
        firstName: v.first_name ?? '',
        middleName: v.middle_name,
        lastName: v.last_name,
        email: v.email,
        phone: v.phone,
      });
      if (parsed.success) {
        data = snake(parsed.data);
        contact(data, errors);
        key = parsed.data.parentCode ?? null;
      } else errors.push(...zodErrors(parsed.error.issues));
    } else {
      const parsed = teacherProfileSchema.safeParse({
        employeeId: v.employee_id ?? '',
        firstName: v.first_name ?? '',
        middleName: v.middle_name,
        lastName: v.last_name,
        email: v.email,
        phone: v.phone,
        joiningDate: v.joining_date,
      });
      if (parsed.success) {
        data = snake(parsed.data);
        contact(data, errors);
        key = parsed.data.employeeId;
      } else errors.push(...zodErrors(parsed.error.issues));
    }

    if (key) {
      const field =
        type === 'STUDENTS'
          ? 'admission_number'
          : type === 'PARENTS'
            ? 'parent_code'
            : 'employee_id';
      const label =
        type === 'STUDENTS'
          ? 'admission number'
          : type === 'PARENTS'
            ? 'parent code'
            : 'employee ID';
      if (ctx.existingKeys.has(key))
        errors.push({
          field,
          code: 'DUPLICATE_EXISTING',
          message: `A record with ${label} "${key}" already exists`,
        });
      const earlier = seen.get(key);
      if (earlier !== undefined)
        errors.push({
          field,
          code: 'DUPLICATE_IN_FILE',
          message: `Duplicate ${label} "${key}" (also on row ${String(earlier)})`,
        });
      else seen.set(key, row.rowNumber);
    }
    return { rowNumber: row.rowNumber, valid: errors.length === 0, data, errors };
  });
}

async function loadContext(
  tx: TenantTransaction,
  school: School,
  type: ImportType,
): Promise<Context> {
  const ctx: Context = { sections: new Map(), existingKeys: new Set(), parentCodes: new Map() };
  if (type === 'STUDENTS') {
    const sections = await tx.section.findMany({
      where: { schoolId: school.id },
      include: { branch: true, grade: true, academicYear: true },
    });
    for (const s of sections) {
      const key = placementKey(s.branch.code, s.academicYear.name, s.grade.code, s.code);
      ctx.sections.set(key, {
        id: s.id,
        usable:
          s.isActive && s.branch.isActive && s.grade.isActive && s.academicYear.status !== 'CLOSED',
      });
    }
    for (const s of await tx.student.findMany({
      where: { schoolId: school.id },
      select: { admissionNumber: true },
    }))
      ctx.existingKeys.add(s.admissionNumber);
    for (const p of await tx.parent.findMany({
      where: { schoolId: school.id, parentCode: { not: null } },
      select: { parentCode: true, isActive: true },
    }))
      if (p.parentCode) ctx.parentCodes.set(p.parentCode, { active: p.isActive });
  } else if (type === 'PARENTS') {
    for (const p of await tx.parent.findMany({
      where: { schoolId: school.id, parentCode: { not: null } },
      select: { parentCode: true },
    }))
      if (p.parentCode) ctx.existingKeys.add(p.parentCode);
  } else {
    for (const t of await tx.teacher.findMany({
      where: { schoolId: school.id },
      select: { employeeId: true },
    }))
      ctx.existingKeys.add(t.employeeId);
  }
  return ctx;
}

export function placementKey(branch: string, year: string, grade: string, section: string): string {
  return [
    branch.trim().toUpperCase(),
    year.trim().toLowerCase(),
    grade.trim().toUpperCase(),
    section.trim().toUpperCase(),
  ].join('|');
}

function placement(
  v: Record<string, string>,
  ctx: Context,
  data: RowData,
  errors: ImportRowError[],
): void {
  const parts = ['branch_code', 'academic_year', 'grade_code', 'section_code'].map(
    (k) => v[k] ?? '',
  );
  const given = parts.filter((p) => p !== '').length;
  if (given === 0) return;
  if (given < 4) {
    errors.push({
      field: 'section_code',
      code: 'PLACEMENT_INCOMPLETE',
      message: 'Give branch_code, academic_year, grade_code and section_code together (or none)',
    });
    return;
  }
  const [branch, year, grade, section] = parts as [string, string, string, string];
  const found = ctx.sections.get(placementKey(branch, year, grade, section));
  const label = `${grade}-${section} (${branch}, ${year})`;
  if (!found)
    errors.push({
      field: 'section_code',
      code: 'UNKNOWN_SECTION',
      message: `Unknown section "${label}"`,
    });
  else if (!found.usable)
    errors.push({
      field: 'section_code',
      code: 'SECTION_UNAVAILABLE',
      message: `Section "${label}" is inactive or its academic year is closed`,
    });
  else {
    data.section_id = found.id;
    data.placement = label;
  }
}

function guardians(
  v: Record<string, string>,
  ctx: Context,
  data: RowData,
  errors: ImportRowError[],
): void {
  let primaries = 0;
  const codes = new Set<string>();
  for (const n of [1, 2]) {
    const p = `guardian${String(n)}_`;
    const code = (v[`${p}parent_code`] ?? '').trim().toUpperCase();
    const rel = (v[`${p}relationship`] ?? '').trim().toUpperCase();
    const primary = (v[`${p}primary`] ?? '').trim().toLowerCase();
    const pickup = (v[`${p}pickup`] ?? '').trim().toLowerCase();
    if (!code && !rel && !YES.has(primary) && !YES.has(pickup)) continue;
    if (!code) {
      errors.push({
        field: `${p}parent_code`,
        code: 'REQUIRED',
        message: 'Parent code is required for this guardian',
      });
      continue;
    }
    const parent = ctx.parentCodes.get(code);
    if (!parent)
      errors.push({
        field: `${p}parent_code`,
        code: 'UNKNOWN_PARENT',
        message: `Unknown parent code "${code}" — import parents first`,
      });
    else if (!parent.active)
      errors.push({
        field: `${p}parent_code`,
        code: 'PARENT_INACTIVE',
        message: `Parent "${code}" is inactive`,
      });
    if (codes.has(code))
      errors.push({
        field: `${p}parent_code`,
        code: 'DUPLICATE_GUARDIAN',
        message: `Parent "${code}" is listed twice`,
      });
    codes.add(code);
    if (!(GUARDIAN_RELATIONSHIPS as readonly string[]).includes(rel))
      errors.push({
        field: `${p}relationship`,
        code: 'INVALID_RELATIONSHIP',
        message: `Relationship must be one of ${GUARDIAN_RELATIONSHIPS.join(', ')}`,
      });
    for (const [field, value] of [
      [`${p}primary`, primary],
      [`${p}pickup`, pickup],
    ] as const)
      if (!YES.has(value) && !NO.has(value))
        errors.push({ field, code: 'INVALID_BOOLEAN', message: 'Use yes or no' });
    if (YES.has(primary)) primaries += 1;
    data[`guardian${String(n)}_parent_code`] = code;
    data[`guardian${String(n)}_relationship`] = rel;
    data[`guardian${String(n)}_primary`] = YES.has(primary) ? 'yes' : 'no';
    data[`guardian${String(n)}_pickup`] = YES.has(pickup) ? 'yes' : 'no';
  }
  if (primaries > 1)
    errors.push({
      field: 'guardian2_primary',
      code: 'MULTIPLE_PRIMARY',
      message: 'Only one guardian can be primary',
    });
}

/** Phase 3 normalisation for contact values (email lower-case, phone E.164). */
function contact(data: RowData, errors: ImportRowError[]): void {
  if (data.email) {
    const e = normalizeEmail(data.email);
    if (e) data.email = e;
    else
      errors.push({ field: 'email', code: 'INVALID_EMAIL', message: 'Not a valid email address' });
  }
  if (data.phone) {
    const p = normalizePhone(data.phone);
    if (p) data.phone = p;
    else
      errors.push({ field: 'phone', code: 'INVALID_PHONE', message: 'Not a valid mobile number' });
  }
}

function snake(obj: Record<string, string | null | undefined>): RowData {
  const out: RowData = {};
  for (const [k, value] of Object.entries(obj)) out[SNAKE[k] ?? k] = value ?? null;
  return out;
}

function zodErrors(issues: { path: PropertyKey[]; message: string }[]): ImportRowError[] {
  return issues.map((i) => {
    const field = SNAKE[String(i.path[0] ?? '')] ?? String(i.path[0] ?? '*');
    const required = i.message === 'Too small: expected string to have >=1 characters';
    const code = required
      ? 'REQUIRED'
      : field === 'email'
        ? 'INVALID_EMAIL'
        : field === 'phone'
          ? 'INVALID_PHONE'
          : field.endsWith('_date') || field === 'date_of_birth'
            ? 'INVALID_DATE'
            : 'INVALID_VALUE';
    return { field, code, message: required ? 'Required' : i.message };
  });
}
