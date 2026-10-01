import type {
  AcademicSettings,
  AcademicYear as AcademicYearDto,
  Branch as BranchDto,
  Grade as GradeDto,
  School as SchoolDto,
  Section as SectionDto,
  Subject as SubjectDto,
} from '@acadlyx/types';
import { Injectable } from '@nestjs/common';
import type {
  AcademicYear,
  Branch,
  Grade,
  School,
  Section,
  Subject,
} from '../../generated/prisma/client.js';
import { type AuditEvent, AuditService } from '../../common/audit/audit.service.js';
import {
  type TenantTransaction,
  TenantPrismaService,
} from '../../tenancy/tenant-prisma.service.js';
import { ACADEMIC_ERRORS } from './academic-errors.js';

/**
 * Tenant-path data access shared by the academic services. Every call runs through
 * TenantPrismaService (role acadlyx_app → tenant scoping extension → FORCE RLS); the tenant is
 * never taken from the request. The school is resolved server-side as the tenant's School
 * (V1: exactly one per tenant — provisioned with the tenant; the schema allows more later).
 */
@Injectable()
export class AcademicStore {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  run<T>(fn: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    return this.db.run(fn);
  }

  /**
   * Runs a mutation with the school row-locked, then records its audit events — only after the
   * transaction committed, so a rolled-back change never leaves an audit row behind.
   */
  async mutate<T>(
    fn: (tx: TenantTransaction, school: School, events: AuditEvent[]) => Promise<T>,
  ): Promise<T> {
    const events: AuditEvent[] = [];
    const result = await this.db.run(async (tx) => fn(tx, await this.lockSchool(tx), events));
    for (const event of events) await this.audit.recordTenant(event);
    return result;
  }

  /**
   * Like mutate() but WITHOUT the school row lock — for high-volume people operations whose
   * invariants are guaranteed by unique indexes (violations are mapped to domain errors).
   */
  async transact<T>(
    fn: (tx: TenantTransaction, school: School, events: AuditEvent[]) => Promise<T>,
    options?: { timeout?: number },
  ): Promise<T> {
    const events: AuditEvent[] = [];
    const result = await this.db.run(async (tx) => fn(tx, await this.school(tx), events), options);
    for (const event of events) await this.audit.recordTenant(event);
    return result;
  }

  async school(tx: TenantTransaction): Promise<School> {
    const school = await tx.school.findFirst({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    if (!school) throw ACADEMIC_ERRORS.schoolNotFound();
    return school;
  }

  /**
   * Resolves the school AND takes a row lock on it for the rest of the transaction. Structural
   * changes that must stay consistent across rows (primary branch, current year, ordering,
   * overlap checks) are serialised per school this way — concurrent requests queue, never race.
   */
  async lockSchool(tx: TenantTransaction): Promise<School> {
    const school = await this.school(tx);
    await tx.$queryRaw`SELECT "id" FROM "schools" WHERE "id" = ${school.id}::uuid FOR UPDATE`;
    return school;
  }
}

// ---- Mapping (Prisma rows → API contracts; no internal columns leak) -------------------------

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
/** Date-only input → UTC midnight, so @db.Date stores exactly that calendar day. */
export const fromIsoDate = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

const address = (r: {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
}) => ({
  addressLine1: r.addressLine1,
  addressLine2: r.addressLine2,
  city: r.city,
  state: r.state,
  postalCode: r.postalCode,
  country: r.country,
});

export function toSchool(r: School): SchoolDto {
  return {
    id: r.id,
    name: r.name,
    shortName: r.shortName,
    code: r.code,
    board: r.board,
    boardName: r.boardName,
    email: r.email,
    phone: r.phone,
    website: r.website,
    ...address(r),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toAcademicSettings(r: School): AcademicSettings {
  return {
    timezone: r.timezone,
    weekStartDay: r.weekStartDay,
    workingDays: r.workingDays,
    academicYearStartMonth: r.academicYearStartMonth,
  };
}

export function toBranch(r: Branch): BranchDto {
  return {
    id: r.id,
    schoolId: r.schoolId,
    name: r.name,
    code: r.code,
    email: r.email,
    phone: r.phone,
    ...address(r),
    timezone: r.timezone,
    isPrimary: r.isPrimary,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toAcademicYear(r: AcademicYear): AcademicYearDto {
  return {
    id: r.id,
    schoolId: r.schoolId,
    name: r.name,
    startDate: isoDate(r.startDate),
    endDate: isoDate(r.endDate),
    status: r.status,
    isCurrent: r.isCurrent,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toGrade(r: Grade): GradeDto {
  return {
    id: r.id,
    schoolId: r.schoolId,
    name: r.name,
    code: r.code,
    displayOrder: r.displayOrder,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toSection(r: Section): SectionDto {
  return {
    id: r.id,
    schoolId: r.schoolId,
    branchId: r.branchId,
    academicYearId: r.academicYearId,
    gradeId: r.gradeId,
    name: r.name,
    code: r.code,
    displayOrder: r.displayOrder,
    capacity: r.capacity,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toSubject(r: Subject): SubjectDto {
  return {
    id: r.id,
    schoolId: r.schoolId,
    name: r.name,
    code: r.code,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Names of fields whose value actually changes (for audit — names only, never values). */
export function changedFields(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): string[] {
  return Object.keys(patch).filter((key) => {
    const next = patch[key];
    if (next === undefined) return false;
    const prev = before[key];
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : JSON.stringify(v ?? null));
    return norm(prev) !== norm(next);
  });
}

/** Keeps only defined keys (PATCH semantics: undefined = unchanged, null = clear). */
export function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Validates a complete reorder request: `ids` must be exactly the current set, once each.
 * Returns the new order (index = display_order).
 */
export function assertCompleteOrder(current: string[], ids: string[]): void {
  const want = new Set(current);
  if (
    ids.length !== want.size ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !want.has(id))
  )
    throw ACADEMIC_ERRORS.reorderMismatch();
}
