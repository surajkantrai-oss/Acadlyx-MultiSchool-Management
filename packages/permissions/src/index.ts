/**
 * Acadlyx RBAC registry (Phase 3).
 *
 * Code is the source of truth for SYSTEM roles and permissions. The backend syncs this registry
 * into the roles / permissions / role_permissions tables at startup, and authorisation always
 * checks PERMISSIONS (never role names). Later phases add module permissions here.
 *
 * Feature flags (tenant-config) and permissions are separate: future module access requires
 * BOTH the tenant feature to be enabled AND the user to hold the permission.
 */

export const AUTH_SCOPES = ['PLATFORM', 'TENANT'] as const;
export type AuthScope = (typeof AUTH_SCOPES)[number];

export const PERMISSION_REGISTRY = [
  {
    key: 'platform.tenant.read',
    scope: 'PLATFORM',
    description: 'View schools/tenants and their configuration',
  },
  {
    key: 'platform.tenant.manage',
    scope: 'PLATFORM',
    description: 'Create and configure schools/tenants',
  },
  { key: 'platform.tenant_user.read', scope: 'PLATFORM', description: 'View school user accounts' },
  {
    key: 'platform.tenant_user.manage',
    scope: 'PLATFORM',
    description: 'Create school user accounts and manage roles/status',
  },
  {
    key: 'tenant.workspace.access',
    scope: 'TENANT',
    description: 'Open the authenticated school workspace',
  },
  {
    key: 'tenant.settings.read',
    scope: 'TENANT',
    description: "View the school's enabled features and settings",
  },
  // Phase 4 — school & academic configuration.
  { key: 'school.read', scope: 'TENANT', description: 'View the school profile' },
  { key: 'school.manage', scope: 'TENANT', description: 'Edit the school profile' },
  { key: 'branch.read', scope: 'TENANT', description: 'View branches/campuses' },
  {
    key: 'branch.manage',
    scope: 'TENANT',
    description: 'Create, edit, (de)activate branches and set the primary branch',
  },
  { key: 'academic_year.read', scope: 'TENANT', description: 'View academic years' },
  {
    key: 'academic_year.manage',
    scope: 'TENANT',
    description: 'Create, edit, activate, close and set the current academic year',
  },
  { key: 'grade.read', scope: 'TENANT', description: 'View grades/classes' },
  {
    key: 'grade.manage',
    scope: 'TENANT',
    description: 'Create, edit, reorder and (de)activate grades',
  },
  { key: 'section.read', scope: 'TENANT', description: 'View sections' },
  {
    key: 'section.manage',
    scope: 'TENANT',
    description: 'Create, edit, reorder and (de)activate sections',
  },
  { key: 'subject.read', scope: 'TENANT', description: 'View subjects and grade–subject mappings' },
  {
    key: 'subject.manage',
    scope: 'TENANT',
    description: 'Create, edit, (de)activate subjects and assign them to grades',
  },
  {
    key: 'academic_configuration.read',
    scope: 'TENANT',
    description: 'View academic settings (week, working days, defaults)',
  },
  {
    key: 'academic_configuration.manage',
    scope: 'TENANT',
    description: 'Edit academic settings',
  },
  // Phase 5 — people, enrollment and bulk onboarding.
  { key: 'student.read', scope: 'TENANT', description: 'View student profiles' },
  {
    key: 'student.manage',
    scope: 'TENANT',
    description: 'Create and edit student profiles, status and guardian links',
  },
  { key: 'parent.read', scope: 'TENANT', description: 'View parent/guardian profiles' },
  { key: 'parent.manage', scope: 'TENANT', description: 'Create and edit parent profiles' },
  { key: 'teacher.read', scope: 'TENANT', description: 'View teacher profiles' },
  { key: 'teacher.manage', scope: 'TENANT', description: 'Create and edit teacher profiles' },
  { key: 'enrollment.read', scope: 'TENANT', description: 'View student enrollments' },
  {
    key: 'enrollment.manage',
    scope: 'TENANT',
    description: 'Enroll, transfer, withdraw and complete student enrollments',
  },
  {
    key: 'teacher_assignment.read',
    scope: 'TENANT',
    description: 'View teacher class/subject assignments',
  },
  {
    key: 'teacher_assignment.manage',
    scope: 'TENANT',
    description: 'Assign teachers to sections and subjects',
  },
  { key: 'bulk_import.read', scope: 'TENANT', description: 'View bulk import jobs and results' },
  {
    key: 'bulk_import.manage',
    scope: 'TENANT',
    description: 'Upload, confirm and cancel bulk imports (per import type permission also needed)',
  },
  {
    key: 'people_account.manage',
    scope: 'TENANT',
    description: 'Create or link login accounts for student/parent/teacher profiles',
  },
] as const satisfies readonly { key: string; scope: AuthScope; description: string }[];

export type PermissionKey = (typeof PERMISSION_REGISTRY)[number]['key'];

/** Session lifetimes (approved Phase 3 policy). Activity = successful token refresh. */
export const SESSION_POLICIES = {
  PLATFORM: { idleMinutes: 30, absoluteMinutes: 12 * 60 },
  PRIVILEGED: { idleMinutes: 12 * 60, absoluteMinutes: 7 * 24 * 60 },
  STAFF: { idleMinutes: 7 * 24 * 60, absoluteMinutes: 30 * 24 * 60 },
  FAMILY: { idleMinutes: 30 * 24 * 60, absoluteMinutes: 90 * 24 * 60 },
} as const;
export type SessionPolicyKey = keyof typeof SESSION_POLICIES;

/** Identifiers a role requires when an account is created (union across a user's roles). */
export type RequiredIdentifier = 'email' | 'phone' | 'studentId' | 'employeeIdOrEmail';

interface RoleDefinition {
  key: string;
  name: string;
  scope: AuthScope;
  permissions: readonly PermissionKey[];
  /** MFA is mandatory once the account is active. */
  mfaRequired: boolean;
  /** Low-entropy 6-digit PIN allowed instead of a password. */
  pinAllowed: boolean;
  sessionPolicy: SessionPolicyKey;
  requires: RequiredIdentifier;
}

const TENANT_WORKSPACE: readonly PermissionKey[] = ['tenant.workspace.access'];

/** Phase 4: full school & academic configuration (leadership/administration). */
const ACADEMIC_MANAGE: readonly PermissionKey[] = [
  'school.read',
  'school.manage',
  'branch.read',
  'branch.manage',
  'academic_year.read',
  'academic_year.manage',
  'grade.read',
  'grade.manage',
  'section.read',
  'section.manage',
  'subject.read',
  'subject.manage',
  'academic_configuration.read',
  'academic_configuration.manage',
];

/** Phase 5: full people administration (leadership/administration). */
const PEOPLE_MANAGE: readonly PermissionKey[] = [
  'student.read',
  'student.manage',
  'parent.read',
  'parent.manage',
  'teacher.read',
  'teacher.manage',
  'enrollment.read',
  'enrollment.manage',
  'teacher_assignment.read',
  'teacher_assignment.manage',
  'bulk_import.read',
  'bulk_import.manage',
  'people_account.manage',
];

/** Phase 4: read-only academic structure needed by staff in later modules. */
const ACADEMIC_STRUCTURE_READ: readonly PermissionKey[] = [
  'school.read',
  'branch.read',
  'academic_year.read',
  'grade.read',
  'section.read',
];

export const ROLE_REGISTRY = [
  {
    key: 'PLATFORM_ADMIN',
    name: 'Platform Admin',
    scope: 'PLATFORM',
    permissions: [
      'platform.tenant.read',
      'platform.tenant.manage',
      'platform.tenant_user.read',
      'platform.tenant_user.manage',
    ],
    mfaRequired: true,
    pinAllowed: false,
    sessionPolicy: 'PLATFORM',
    requires: 'email',
  },
  {
    key: 'PRINCIPAL',
    name: 'Principal',
    scope: 'TENANT',
    permissions: [
      'tenant.workspace.access',
      'tenant.settings.read',
      ...ACADEMIC_MANAGE,
      ...PEOPLE_MANAGE,
    ],
    mfaRequired: true,
    pinAllowed: false,
    sessionPolicy: 'PRIVILEGED',
    requires: 'email',
  },
  {
    key: 'SCHOOL_ADMIN',
    name: 'School Admin',
    scope: 'TENANT',
    permissions: [
      'tenant.workspace.access',
      'tenant.settings.read',
      ...ACADEMIC_MANAGE,
      ...PEOPLE_MANAGE,
    ],
    mfaRequired: true,
    pinAllowed: false,
    sessionPolicy: 'PRIVILEGED',
    requires: 'email',
  },
  {
    key: 'ACCOUNTANT',
    name: 'Accountant',
    scope: 'TENANT',
    permissions: [
      ...TENANT_WORKSPACE,
      ...ACADEMIC_STRUCTURE_READ,
      'student.read',
      'enrollment.read',
    ],
    mfaRequired: true,
    pinAllowed: false,
    sessionPolicy: 'PRIVILEGED',
    requires: 'email',
  },
  {
    key: 'TEACHER',
    name: 'Teacher',
    scope: 'TENANT',
    permissions: [
      ...TENANT_WORKSPACE,
      ...ACADEMIC_STRUCTURE_READ,
      'subject.read',
      'student.read',
      'parent.read',
      'teacher.read',
      'enrollment.read',
      'teacher_assignment.read',
    ],
    mfaRequired: false,
    pinAllowed: false,
    sessionPolicy: 'STAFF',
    requires: 'employeeIdOrEmail',
  },
  {
    key: 'ADMISSION_OFFICER',
    name: 'Admission Officer',
    scope: 'TENANT',
    permissions: [
      ...TENANT_WORKSPACE,
      ...ACADEMIC_STRUCTURE_READ,
      'student.read',
      'student.manage',
      'parent.read',
      'parent.manage',
      'enrollment.read',
      'enrollment.manage',
      'bulk_import.read',
      'bulk_import.manage',
    ],
    mfaRequired: false,
    pinAllowed: false,
    sessionPolicy: 'STAFF',
    requires: 'email',
  },
  {
    key: 'TRANSPORT_MANAGER',
    name: 'Transport Manager',
    scope: 'TENANT',
    permissions: [...TENANT_WORKSPACE, 'school.read', 'branch.read'],
    mfaRequired: false,
    pinAllowed: false,
    sessionPolicy: 'STAFF',
    requires: 'email',
  },
  {
    key: 'PARENT',
    name: 'Parent',
    scope: 'TENANT',
    permissions: TENANT_WORKSPACE,
    mfaRequired: false,
    pinAllowed: true,
    sessionPolicy: 'FAMILY',
    requires: 'phone',
  },
  {
    key: 'STUDENT',
    name: 'Student',
    scope: 'TENANT',
    permissions: TENANT_WORKSPACE,
    mfaRequired: false,
    pinAllowed: true,
    sessionPolicy: 'FAMILY',
    requires: 'studentId',
  },
] as const satisfies readonly RoleDefinition[];

export type RoleKey = (typeof ROLE_REGISTRY)[number]['key'];
export type TenantRoleKey = Extract<(typeof ROLE_REGISTRY)[number], { scope: 'TENANT' }>['key'];

const ROLES_BY_KEY: ReadonlyMap<string, RoleDefinition> = new Map(
  ROLE_REGISTRY.map((role) => [role.key, role]),
);

export const TENANT_ROLE_KEYS: TenantRoleKey[] = ROLE_REGISTRY.filter(
  (r): r is Extract<(typeof ROLE_REGISTRY)[number], { scope: 'TENANT' }> => r.scope === 'TENANT',
).map((r) => r.key);

export function getRole(key: string): RoleDefinition | undefined {
  return ROLES_BY_KEY.get(key);
}

export function isTenantRoleKey(key: string): key is TenantRoleKey {
  return ROLES_BY_KEY.get(key)?.scope === 'TENANT';
}

export function isPermissionKey(key: string): key is PermissionKey {
  return PERMISSION_REGISTRY.some((p) => p.key === key);
}

/** Union of permissions granted by the given roles. */
export function permissionsForRoles(roleKeys: readonly string[]): PermissionKey[] {
  const set = new Set<PermissionKey>();
  for (const key of roleKeys) for (const p of getRole(key)?.permissions ?? []) set.add(p);
  return [...set].sort();
}

export function mfaRequiredForRoles(roleKeys: readonly string[]): boolean {
  return roleKeys.some((key) => getRole(key)?.mfaRequired === true);
}

/** A PIN is allowed only if EVERY role of the user allows it (most restrictive wins). */
export function pinAllowedForRoles(roleKeys: readonly string[]): boolean {
  return roleKeys.length > 0 && roleKeys.every((key) => getRole(key)?.pinAllowed === true);
}

/** Most restrictive session policy across the user's roles (shortest idle and absolute). */
export function sessionPolicyForRoles(roleKeys: readonly string[]): {
  idleMinutes: number;
  absoluteMinutes: number;
} {
  const policies = roleKeys
    .map((key) => getRole(key))
    .filter((role): role is RoleDefinition => role !== undefined)
    .map((role) => SESSION_POLICIES[role.sessionPolicy]);
  if (policies.length === 0) return SESSION_POLICIES.PLATFORM;
  return {
    idleMinutes: Math.min(...policies.map((p) => p.idleMinutes)),
    absoluteMinutes: Math.min(...policies.map((p) => p.absoluteMinutes)),
  };
}

/** Identifier kinds required to create an account holding these roles. */
export function requiredIdentifiers(roleKeys: readonly string[]): RequiredIdentifier[] {
  return [...new Set(roleKeys.map((key) => getRole(key)?.requires).filter((r) => r !== undefined))];
}
