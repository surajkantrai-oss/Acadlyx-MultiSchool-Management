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
    expect(permissionsForRoles(['TEACHER', 'PARENT'])).toEqual(['tenant.workspace.access']);
    expect(permissionsForRoles(['TEACHER', 'PRINCIPAL'])).toEqual([
      'tenant.settings.read',
      'tenant.workspace.access',
    ]);
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
