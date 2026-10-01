import type { TenantStatus } from '@acadlyx/tenant-config';
import type { PlatformPrismaService } from '../../src/database/platform-prisma.service.js';

/**
 * Deterministic test tenants. Keys are prefixed per spec file so suites never touch each other's
 * (or the development seed's) data. Three tenants catch logic that assumes "one other tenant".
 */
export interface FixtureTenant {
  id: string;
  key: string;
  slug: string;
  domain: string;
  configId: string;
  featureId: string;
  color: string;
}

export const FIXTURE_LETTERS = ['A', 'B', 'C'] as const;
export type FixtureLetter = (typeof FIXTURE_LETTERS)[number];

const COLORS: Record<FixtureLetter, string> = { A: '#1D4ED8', B: '#15803D', C: '#B91C1C' };

/**
 * TEST-ONLY hard delete of every tenant whose key starts with `prefix`.
 * Hard deletion is never exposed through the API; this helper exists solely for test cleanup.
 */
export async function purgeTenants(prisma: PlatformPrismaService, prefix: string): Promise<void> {
  const where = { tenant: { key: { startsWith: prefix } } };
  const tenantIds = (
    await prisma.tenant.findMany({ where: { key: { startsWith: prefix } }, select: { id: true } })
  ).map((t) => t.id);
  const byTenant = { tenantId: { in: tenantIds } };
  await prisma.$transaction([
    // Phase 9 (history/snapshots first, then marks/sheets, then configuration).
    prisma.assignmentSubmissionGradeHistory.deleteMany({ where: byTenant }),
    prisma.assignmentSubmissionGrade.deleteMany({ where: byTenant }),
    prisma.resultComponentSnapshot.deleteMany({ where: byTenant }),
    prisma.resultSubjectSnapshot.deleteMany({ where: byTenant }),
    prisma.resultStudentSnapshot.deleteMany({ where: byTenant }),
    prisma.resultPublication.deleteMany({ where: byTenant }),
    prisma.studentExamRemark.deleteMany({ where: byTenant }),
    prisma.studentExamMarkHistory.deleteMany({ where: byTenant }),
    prisma.studentExamMark.deleteMany({ where: byTenant }),
    prisma.examMarkSheetEvent.deleteMany({ where: byTenant }),
    prisma.examMarkSheet.deleteMany({ where: byTenant }),
    prisma.examComponentSchedule.deleteMany({ where: byTenant }),
    prisma.examComponent.deleteMany({ where: byTenant }),
    prisma.examSubject.deleteMany({ where: byTenant }),
    prisma.exam.deleteMany({ where: byTenant }),
    prisma.gradeBand.deleteMany({ where: byTenant }),
    prisma.gradeScale.deleteMany({ where: byTenant }),
    // Phase 8 submissions reference assignments/students — delete them first.
    prisma.assignmentSubmissionHistory.deleteMany({ where: byTenant }),
    prisma.assignmentSubmission.deleteMany({ where: byTenant }),
    // Phase 7 (reference sections/students/teachers — delete them first). The platform role
    // bypasses the draft-only delete policy, which applies to the application role only.
    prisma.attendanceRecordHistory.deleteMany({ where: byTenant }),
    prisma.attendanceRecord.deleteMany({ where: byTenant }),
    prisma.attendanceSession.deleteMany({ where: byTenant }),
    prisma.homework.deleteMany({ where: byTenant }),
    prisma.assignment.deleteMany({ where: byTenant }),
    prisma.timetableEntry.deleteMany({ where: byTenant }),
    prisma.timetablePeriod.deleteMany({ where: byTenant }),
    // Phase 5 (profiles reference users/sections — delete them first).
    prisma.bulkImportRow.deleteMany({ where: byTenant }),
    prisma.bulkImportJob.deleteMany({ where: byTenant }),
    prisma.teacherAssignment.deleteMany({ where: byTenant }),
    prisma.studentEnrollment.deleteMany({ where: byTenant }),
    prisma.studentGuardian.deleteMany({ where: byTenant }),
    prisma.studentStatusHistory.deleteMany({ where: byTenant }),
    prisma.student.deleteMany({ where: byTenant }),
    prisma.parent.deleteMany({ where: byTenant }),
    prisma.teacher.deleteMany({ where: byTenant }),
    prisma.auditLog.deleteMany({ where: byTenant }),
    prisma.platformAuditLog.deleteMany({ where: byTenant }),
    prisma.otpChallenge.deleteMany({ where: byTenant }),
    prisma.refreshToken.deleteMany({ where: byTenant }),
    prisma.session.deleteMany({ where: byTenant }),
    prisma.userDevice.deleteMany({ where: byTenant }),
    prisma.mfaRecoveryCode.deleteMany({ where: byTenant }),
    prisma.mfaMethod.deleteMany({ where: byTenant }),
    prisma.userRole.deleteMany({ where: byTenant }),
    prisma.user.deleteMany({ where: byTenant }),
    prisma.gradeSubject.deleteMany({ where: byTenant }),
    prisma.section.deleteMany({ where: byTenant }),
    prisma.subject.deleteMany({ where: byTenant }),
    prisma.grade.deleteMany({ where: byTenant }),
    prisma.academicYear.deleteMany({ where: byTenant }),
    prisma.branch.deleteMany({ where: byTenant }),
    prisma.school.deleteMany({ where: byTenant }),
    prisma.tenantConfiguration.deleteMany({ where }),
    prisma.tenantFeature.deleteMany({ where }),
    prisma.tenantBranding.deleteMany({ where }),
    prisma.tenantDomain.deleteMany({ where }),
    prisma.tenant.deleteMany({ where: { key: { startsWith: prefix } } }),
  ]);
}

/** Creates ACTIVE tenants <prefix>_A/B/C, each with a *.localhost domain, branding, a feature and a config row. */
export async function createFixtureTenants(
  prisma: PlatformPrismaService,
  prefix: string,
): Promise<Record<FixtureLetter, FixtureTenant>> {
  await purgeTenants(prisma, prefix);
  const result = {} as Record<FixtureLetter, FixtureTenant>;
  for (const letter of FIXTURE_LETTERS) {
    const key = `${prefix}_${letter}`;
    const slug = key.toLowerCase().replace(/_/g, '-');
    const domain = `${slug}.localhost`;
    const tenant = await prisma.tenant.create({
      data: {
        key,
        slug,
        displayName: `Test School ${letter}`,
        status: 'ACTIVE',
        firstActivatedAt: new Date(),
        domains: { create: { domain, type: 'ADMIN', isPrimary: true } },
        branding: { create: { schoolName: `Test School ${letter}`, primaryColor: COLORS[letter] } },
        features: { create: { featureKey: 'ATTENDANCE', enabled: true } },
        configurations: { create: { key: 'general.locale', value: 'en-IN' } },
      },
      include: { features: true, configurations: true },
    });
    result[letter] = {
      id: tenant.id,
      key,
      slug,
      domain,
      configId: tenant.configurations[0]?.id ?? '',
      featureId: tenant.features[0]?.id ?? '',
      color: COLORS[letter],
    };
  }
  return result;
}

export async function setStatus(
  prisma: PlatformPrismaService,
  tenantId: string,
  status: TenantStatus,
): Promise<void> {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { status, archivedAt: status === 'ARCHIVED' ? new Date() : null },
  });
}

/**
 * Provisions the academic School of each fixture tenant (what TenantsService.create and the
 * Phase 4 migration backfill do for real tenants). Returns school ids by letter.
 */
export async function createFixtureSchools(
  prisma: PlatformPrismaService,
  tenants: Record<FixtureLetter, FixtureTenant>,
): Promise<Record<FixtureLetter, string>> {
  const result = {} as Record<FixtureLetter, string>;
  for (const letter of FIXTURE_LETTERS) {
    const school = await prisma.school.create({
      data: {
        tenantId: tenants[letter].id,
        name: `Test School ${letter}`,
        timezone: 'Asia/Kolkata',
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
      },
    });
    result[letter] = school.id;
  }
  return result;
}

export interface AcademicFixture {
  branchId: string;
  yearId: string;
  closedYearId: string;
  gradeId: string;
  sectionA: string;
  sectionB: string;
  closedSection: string;
  inactiveSection: string;
  mathId: string;
  artId: string;
}

/**
 * Phase 5 fixture: one branch, an ACTIVE current year + a CLOSED year, one grade with sections
 * A/B (active year), a section in the closed year, an inactive section, and two subjects of
 * which only MATH is mapped to the grade. Codes are identical in every tenant on purpose.
 */
export async function createAcademicFixture(
  prisma: PlatformPrismaService,
  tenantId: string,
  schoolId: string,
): Promise<AcademicFixture> {
  const scope = { tenantId, schoolId };
  const branch = await prisma.branch.create({
    data: { ...scope, name: 'Main', code: 'MAIN', timezone: 'Asia/Kolkata', isPrimary: true },
  });
  const year = await prisma.academicYear.create({
    data: {
      ...scope,
      name: '2026–27',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2027-03-31'),
      status: 'ACTIVE',
      isCurrent: true,
    },
  });
  const closed = await prisma.academicYear.create({
    data: {
      ...scope,
      name: '2025–26',
      startDate: new Date('2025-04-01'),
      endDate: new Date('2026-03-31'),
      status: 'CLOSED',
    },
  });
  const grade = await prisma.grade.create({
    data: { ...scope, name: 'Grade 5', code: 'G5', displayOrder: 0 },
  });
  const section = (academicYearId: string, code: string, displayOrder: number, isActive = true) =>
    prisma.section.create({
      data: {
        ...scope,
        branchId: branch.id,
        academicYearId,
        gradeId: grade.id,
        name: code,
        code,
        displayOrder,
        isActive,
      },
    });
  const a = await section(year.id, 'A', 0);
  const b = await section(year.id, 'B', 1);
  const c = await section(year.id, 'C', 2, false);
  const old = await section(closed.id, 'A', 0);
  const math = await prisma.subject.create({
    data: { ...scope, name: 'Mathematics', code: 'MATH' },
  });
  const art = await prisma.subject.create({ data: { ...scope, name: 'Art', code: 'ART' } });
  await prisma.gradeSubject.create({ data: { ...scope, gradeId: grade.id, subjectId: math.id } });
  return {
    branchId: branch.id,
    yearId: year.id,
    closedYearId: closed.id,
    gradeId: grade.id,
    sectionA: a.id,
    sectionB: b.id,
    closedSection: old.id,
    inactiveSection: c.id,
    mathId: math.id,
    artId: art.id,
  };
}
