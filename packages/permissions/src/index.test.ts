import { describe, expect, it } from 'vitest';
import {
  getRole,
  isTenantRoleKey,
  mfaRequiredForRoles,
  PERMISSION_REGISTRY,
  permissionsForRoles,
  pinAllowedForRoles,
  ROLE_REGISTRY,
  sessionPolicyForRoles,
  TENANT_ROLE_KEYS,
} from './index.js';

describe('RBAC registry', () => {
  it('defines the approved system roles with unique keys and valid permissions', () => {
    expect(ROLE_REGISTRY.map((r) => r.key)).toEqual([
      'PLATFORM_ADMIN',
      'PRINCIPAL',
      'SCHOOL_ADMIN',
      'ACCOUNTANT',
      'TEACHER',
      'ADMISSION_OFFICER',
      'TRANSPORT_MANAGER',
      'PARENT',
      'STUDENT',
    ]);
    const permissionKeys = new Set(PERMISSION_REGISTRY.map((p) => p.key));
    for (const role of ROLE_REGISTRY) {
      for (const permission of role.permissions) {
        expect(permissionKeys.has(permission)).toBe(true);
        // A role only ever holds permissions of its own scope.
        expect(PERMISSION_REGISTRY.find((p) => p.key === permission)?.scope).toBe(role.scope);
      }
    }
  });

  it('never treats PLATFORM_ADMIN as a tenant role', () => {
    expect(isTenantRoleKey('PLATFORM_ADMIN')).toBe(false);
    expect(TENANT_ROLE_KEYS).not.toContain('PLATFORM_ADMIN');
    expect(getRole('LIBRARIAN')).toBeUndefined();
  });

  it('unions permissions for multi-role users', () => {
    expect(permissionsForRoles(['PARENT'])).toEqual(['tenant.workspace.access']);
    const teacherParent = permissionsForRoles(['TEACHER', 'PARENT']);
    expect(teacherParent).toEqual(permissionsForRoles(['TEACHER']));
    expect(permissionsForRoles(['TEACHER', 'PRINCIPAL'])).toEqual(
      permissionsForRoles(['PRINCIPAL']),
    );
  });

  it('grants Phase 4 academic permissions without over-granting', () => {
    const manage = PERMISSION_REGISTRY.map((p) => p.key).filter((k) => k.endsWith('.manage'));
    const tenantManage = manage.filter((k) => !k.startsWith('platform.'));
    expect(
      tenantManage.filter((k) =>
        [
          'school',
          'branch',
          'academic_year',
          'grade',
          'section',
          'subject',
          'academic_configuration',
        ].includes(k.split('.')[0] ?? ''),
      ),
    ).toHaveLength(7);
    for (const role of ['PRINCIPAL', 'SCHOOL_ADMIN']) {
      expect(permissionsForRoles([role])).toEqual(expect.arrayContaining(tenantManage));
    }
    for (const role of ['ACCOUNTANT', 'TEACHER', 'TRANSPORT_MANAGER']) {
      expect(permissionsForRoles([role]).filter((k) => k.endsWith('.manage'))).toEqual([]);
    }
    expect(permissionsForRoles(['TEACHER'])).toEqual(
      expect.arrayContaining(['grade.read', 'section.read', 'subject.read']),
    );
    expect(permissionsForRoles(['TRANSPORT_MANAGER'])).not.toContain('grade.read');
    expect(permissionsForRoles(['TRANSPORT_MANAGER']).some((k) => k.startsWith('student.'))).toBe(
      false,
    );
    for (const role of ['PARENT', 'STUDENT']) {
      expect(permissionsForRoles([role])).toEqual(['tenant.workspace.access']);
    }
    // No tenant role holds a platform permission.
    for (const role of TENANT_ROLE_KEYS) {
      expect(permissionsForRoles([role]).some((k) => k.startsWith('platform.'))).toBe(false);
    }
  });

  it('applies the most restrictive MFA, PIN and session rules', () => {
    expect(mfaRequiredForRoles(['TEACHER'])).toBe(false);
    expect(mfaRequiredForRoles(['TEACHER', 'ACCOUNTANT'])).toBe(true);
    expect(pinAllowedForRoles(['PARENT'])).toBe(true);
    expect(pinAllowedForRoles(['PARENT', 'TEACHER'])).toBe(false);
    expect(sessionPolicyForRoles(['PARENT', 'TEACHER'])).toEqual({
      idleMinutes: 7 * 24 * 60,
      absoluteMinutes: 30 * 24 * 60,
    });
    expect(sessionPolicyForRoles(['PLATFORM_ADMIN'])).toEqual({
      idleMinutes: 30,
      absoluteMinutes: 720,
    });
  });
});

describe('Phase 5 people grants', () => {
  it('leadership manages people; staff get conservative read access', () => {
    for (const role of ['PRINCIPAL', 'SCHOOL_ADMIN']) {
      expect(permissionsForRoles([role])).toEqual(
        expect.arrayContaining([
          'student.manage',
          'teacher.manage',
          'bulk_import.manage',
          'people_account.manage',
        ]),
      );
    }
    const ao = permissionsForRoles(['ADMISSION_OFFICER']);
    expect(ao).toEqual(
      expect.arrayContaining([
        'student.manage',
        'parent.manage',
        'enrollment.manage',
        'bulk_import.manage',
      ]),
    );
    expect(ao).not.toContain('teacher.manage');
    expect(ao).not.toContain('people_account.manage');
    expect(ao).not.toContain('teacher_assignment.manage');
    const teacher = permissionsForRoles(['TEACHER']);
    expect(teacher).toEqual(
      expect.arrayContaining(['student.read', 'parent.read', 'teacher_assignment.read']),
    );
    expect(teacher.filter((k) => k.endsWith('.manage'))).toEqual([]);
    expect(teacher).not.toContain('bulk_import.read');
    expect(
      permissionsForRoles(['ACCOUNTANT']).filter((k) => /^(student|enrollment)\./.test(k)),
    ).toEqual(['enrollment.read', 'student.read']);
  });
});
