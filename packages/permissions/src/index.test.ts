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

/** Phase 7 per-class operations teachers may perform (scoped by TeacherAssignment). */
const CLASS_OPERATIONS: string[] = [
  'attendance.manage',
  'homework.manage',
  'assignment.manage',
  'assignment_grade.manage',
];

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
      // Phase 7 class operations (attendance/homework/assignment) are the only teacher manage
      // permissions, and they are resource-scoped to assigned sections/subjects.
      expect(
        permissionsForRoles([role]).filter(
          (k) => k.endsWith('.manage') && !CLASS_OPERATIONS.includes(k),
        ),
      ).toEqual([]);
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
    expect(teacher.filter((k) => k.endsWith('.manage') && !CLASS_OPERATIONS.includes(k))).toEqual(
      [],
    );
    expect(teacher).not.toContain('bulk_import.read');
    expect(
      permissionsForRoles(['ACCOUNTANT']).filter((k) => /^(student|enrollment)\./.test(k)),
    ).toEqual(['enrollment.read', 'student.read']);
  });
});

describe('Phase 6 people data scope', () => {
  it('school-wide people reads for administration; teachers are limited to assigned sections', () => {
    for (const role of ['PRINCIPAL', 'SCHOOL_ADMIN', 'ADMISSION_OFFICER', 'ACCOUNTANT'])
      expect(permissionsForRoles([role]), role).toContain('people.read_all');
    for (const role of ['TEACHER', 'TRANSPORT_MANAGER', 'PARENT', 'STUDENT'])
      expect(permissionsForRoles([role]), role).not.toContain('people.read_all');
    // A teacher who is also a parent gains nothing school-wide from the parent role.
    expect(permissionsForRoles(['TEACHER', 'PARENT'])).not.toContain('people.read_all');
  });
});

describe('Phase 6 school activity', () => {
  it('only leadership reads the activity feed', () => {
    for (const role of ['PRINCIPAL', 'SCHOOL_ADMIN'])
      expect(permissionsForRoles([role]), role).toContain('school_activity.read');
    for (const role of [
      'ADMISSION_OFFICER',
      'ACCOUNTANT',
      'TEACHER',
      'TRANSPORT_MANAGER',
      'PARENT',
      'STUDENT',
    ])
      expect(permissionsForRoles([role]), role).not.toContain('school_activity.read');
  });
});

describe('Phase 7 academic operations', () => {
  it('leadership manages everything; teachers operate (not configure); others get nothing', () => {
    const ops = [
      'attendance.read',
      'attendance.manage',
      'attendance.backdate',
      'homework.read',
      'homework.manage',
      'assignment.read',
      'assignment.manage',
      'timetable.read',
      'timetable.manage',
    ];
    for (const role of ['PRINCIPAL', 'SCHOOL_ADMIN'])
      expect(permissionsForRoles([role]), role).toEqual(expect.arrayContaining(ops));
    const teacher = permissionsForRoles(['TEACHER']);
    expect(teacher).toEqual(
      expect.arrayContaining([
        'attendance.manage',
        'homework.manage',
        'assignment.manage',
        'timetable.read',
      ]),
    );
    expect(teacher).not.toContain('timetable.manage');
    expect(teacher).not.toContain('attendance.backdate');
    for (const role of [
      'ADMISSION_OFFICER',
      'ACCOUNTANT',
      'TRANSPORT_MANAGER',
      'PARENT',
      'STUDENT',
    ])
      expect(
        permissionsForRoles([role]).filter((k) => ops.includes(k)),
        role,
      ).toEqual([]);
  });

  it('Phase 9: leadership runs assessment; teachers are scoped; no one else gets results', () => {
    const all = [
      'exam.read',
      'exam.manage',
      'marks.enter',
      'marks.finalize',
      'results.read',
      'results.publish',
      'assignment_grade.manage',
    ];
    for (const role of ['PRINCIPAL', 'SCHOOL_ADMIN'])
      expect(permissionsForRoles([role])).toEqual(expect.arrayContaining(all));
    const teacher = permissionsForRoles(['TEACHER']);
    expect(teacher).toEqual(
      expect.arrayContaining([
        'exam.read',
        'marks.enter',
        'results.read',
        'assignment_grade.manage',
      ]),
    );
    for (const k of ['exam.manage', 'marks.finalize', 'results.publish'])
      expect(teacher).not.toContain(k);
    for (const role of ['ACCOUNTANT', 'PARENT', 'STUDENT', 'TRANSPORT_MANAGER'])
      expect(permissionsForRoles([role]).filter((k) => all.includes(k))).toEqual([]);
  });
});
