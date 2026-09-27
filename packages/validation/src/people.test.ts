import { describe, expect, it } from 'vitest';
import {
  canTransitionStudent,
  fullName,
  normalizePersonId,
  parentProfileSchema,
  studentProfileSchema,
  teacherProfileSchema,
} from './people.js';

describe('people validation', () => {
  it('follows the approved student lifecycle', () => {
    expect(canTransitionStudent('ACTIVE', 'INACTIVE')).toBe(true);
    expect(canTransitionStudent('INACTIVE', 'ACTIVE')).toBe(true);
    expect(canTransitionStudent('INACTIVE', 'GRADUATED')).toBe(true);
    expect(canTransitionStudent('WITHDRAWN', 'ACTIVE')).toBe(true);
    expect(canTransitionStudent('WITHDRAWN', 'INACTIVE')).toBe(false);
    expect(canTransitionStudent('GRADUATED', 'ACTIVE')).toBe(false);
    expect(canTransitionStudent('ACTIVE', 'ACTIVE')).toBe(false);
  });

  it('normalises identifiers but keeps names as typed', () => {
    expect(normalizePersonId(' adm/2026-001 ')).toBe('ADM/2026-001');
    const s = studentProfileSchema.parse({
      admissionNumber: 'adm1',
      firstName: "  D'Souza ",
      dateOfBirth: '2019-02-28',
    });
    expect(s).toMatchObject({
      admissionNumber: 'ADM1',
      firstName: "D'Souza",
      middleName: null,
      dateOfBirth: '2019-02-28',
    });
    expect(studentProfileSchema.safeParse({ admissionNumber: 'A 1', firstName: 'x' }).success).toBe(
      false,
    );
    expect(
      studentProfileSchema.safeParse({
        admissionNumber: 'A1',
        firstName: 'x',
        dateOfBirth: '2019-02-30',
      }).success,
    ).toBe(false);
    expect(
      studentProfileSchema.safeParse({ admissionNumber: 'A1', firstName: '<b>' }).success,
    ).toBe(false);
    expect(fullName({ firstName: 'Aarav', middleName: null, lastName: 'Shah' })).toBe('Aarav Shah');
  });

  it('parent contact data is optional and loosely validated; teacher needs an employee ID', () => {
    expect(
      parentProfileSchema.safeParse({ firstName: 'Meera', phone: '', email: '' }).success,
    ).toBe(true);
    expect(parentProfileSchema.safeParse({ firstName: 'Meera', email: 'nope' }).success).toBe(
      false,
    );
    expect(teacherProfileSchema.safeParse({ firstName: 'Ravi' }).success).toBe(false);
    expect(teacherProfileSchema.parse({ employeeId: 'emp-7', firstName: 'Ravi' }).employeeId).toBe(
      'EMP-7',
    );
  });
});
