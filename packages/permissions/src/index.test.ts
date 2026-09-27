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
    expect(tenantManage).toHaveLength(7);
    for (const role of ['PRINCIPAL', 'SCHOOL_ADMIN']) {
      expect(permissionsForRoles([role])).toEqual(expect.arrayContaining(tenantManage));
    }
    for (const role of ['ACCOUNTANT', 'TEACHER', 'ADMISSION_OFFICER', 'TRANSPORT_MANAGER']) {
      expect(permissionsForRoles([role]).filter((k) => k.endsWith('.manage'))).toEqual([]);
    }
    expect(permissionsForRoles(['TEACHER'])).toEqual(
      expect.arrayContaining(['grade.read', 'section.read', 'subject.read']),
    );
    expect(permissionsForRoles(['TRANSPORT_MANAGER'])).not.toContain('grade.read');
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
