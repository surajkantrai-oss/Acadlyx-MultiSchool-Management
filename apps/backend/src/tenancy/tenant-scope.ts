/**
 * Application-layer tenant scoping for the tenant Prisma client (defense layer in front of RLS).
 *
 * Every query issued through TenantPrismaService passes through scopeQueryArgs(), which
 * injects the current tenant into `where` clauses and create payloads. Developers therefore
 * never write `where: { tenantId }` by hand, and a query that tries to target another tenant
 * explicitly is rejected before it reaches PostgreSQL. RLS remains the authoritative backstop.
 */

/** Tenant-owned models and the column that holds their tenant. Unlisted models are refused. */
export const TENANT_SCOPED_MODELS: Readonly<Record<string, 'id' | 'tenantId'>> = {
  Tenant: 'id',
  TenantDomain: 'tenantId',
  TenantBranding: 'tenantId',
  TenantFeature: 'tenantId',
  TenantConfiguration: 'tenantId',
  User: 'tenantId',
  UserRole: 'tenantId',
  UserDevice: 'tenantId',
  Session: 'tenantId',
  RefreshToken: 'tenantId',
  OtpChallenge: 'tenantId',
  MfaMethod: 'tenantId',
  MfaRecoveryCode: 'tenantId',
  AuditLog: 'tenantId',
  // Phase 4 — school & academic configuration.
  School: 'tenantId',
  Branch: 'tenantId',
  AcademicYear: 'tenantId',
  Grade: 'tenantId',
  Section: 'tenantId',
  Subject: 'tenantId',
  GradeSubject: 'tenantId',
  // Phase 5 — people, enrollment and bulk onboarding.
  Student: 'tenantId',
  StudentStatusHistory: 'tenantId',
  Parent: 'tenantId',
  StudentGuardian: 'tenantId',
  Teacher: 'tenantId',
  StudentEnrollment: 'tenantId',
  TeacherAssignment: 'tenantId',
  BulkImportJob: 'tenantId',
  BulkImportRow: 'tenantId',
  // Phase 7 — attendance, homework, assignments & timetable.
  AttendanceSession: 'tenantId',
  AttendanceRecord: 'tenantId',
  AttendanceRecordHistory: 'tenantId',
  Homework: 'tenantId',
  Assignment: 'tenantId',
  TimetablePeriod: 'tenantId',
  TimetableEntry: 'tenantId',
  // Phase 8 — assignment submissions.
  AssignmentSubmission: 'tenantId',
  AssignmentSubmissionHistory: 'tenantId',
};

/**
 * Global reference data readable (never writable) on the tenant path: the RBAC catalogue has
 * no tenant rows. Queries pass through unscoped; the database grants are SELECT-only.
 */
export const TENANT_READONLY_GLOBAL_MODELS: ReadonlySet<string> = new Set([
  'Role',
  'Permission',
  'RolePermission',
]);
const READ_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
]);

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn', 'upsert']);

export class TenantScopeViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeViolationError';
  }
}

type Args = Record<string, unknown>;

function isRecord(value: unknown): value is Args {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scopeWhere(where: unknown, column: string, tenantId: string): Args {
  const base = isRecord(where) ? where : {};
  if (column in base && base[column] !== tenantId) {
    throw new TenantScopeViolationError('Query targets a different tenant than the current one');
  }
  return { ...base, [column]: tenantId };
}

function scopeData(data: unknown, column: string, tenantId: string): Args {
  const base = isRecord(data) ? data : {};
  if (column in base && base[column] !== tenantId) {
    throw new TenantScopeViolationError('Write targets a different tenant than the current one');
  }
  return { ...base, [column]: tenantId };
}

export function scopeQueryArgs(
  model: string | undefined,
  operation: string,
  args: unknown,
  tenantId: string,
): Args {
  if (model !== undefined && TENANT_READONLY_GLOBAL_MODELS.has(model)) {
    if (!READ_OPERATIONS.has(operation)) {
      throw new TenantScopeViolationError(`${model} is read-only on the tenant path`);
    }
    return isRecord(args) ? { ...args } : {};
  }
  const column = model === undefined ? undefined : TENANT_SCOPED_MODELS[model];
  if (model === undefined || column === undefined) {
    throw new TenantScopeViolationError(
      `Model ${model ?? '(raw)'} is not registered as tenant-scoped; refusing tenant query`,
    );
  }
  const scoped: Args = isRecord(args) ? { ...args } : {};

  if (WHERE_OPERATIONS.has(operation)) {
    scoped.where = scopeWhere(scoped.where, column, tenantId);
  }
  if (CREATE_OPERATIONS.has(operation)) {
    if (column === 'id') {
      throw new TenantScopeViolationError('Tenants cannot be created through the tenant client');
    }
    if (operation === 'upsert') {
      scoped.create = scopeData(scoped.create, column, tenantId);
    } else if (Array.isArray(scoped.data)) {
      scoped.data = scoped.data.map((row) => scopeData(row, column, tenantId));
    } else {
      scoped.data = scopeData(scoped.data, column, tenantId);
    }
  }
  return scoped;
}
