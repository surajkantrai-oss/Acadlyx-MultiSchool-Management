/**
 * Development seed: three demo tenants with distinct branding, domains and features, plus
 * development identities for Phase 3 (school A/B principal, teacher, parent, student and a
 * multi-role teacher+parent), plus a fictional Phase 4 academic structure per school (branches,
 * academic years, grades, sections, subjects and grade–subject mappings), plus fictional Phase 5
 * students, parents, teachers, enrollments, guardians and teacher assignments, plus fictional
 * Phase 7 periods, a weekly timetable, attendance days and homework/assignments.
 *
 *   DEV_SEED_PASSWORD='<12+ chars>' DEV_SEED_PIN='<6 digits>' pnpm db:seed
 *
 * Deterministic and idempotent. Refuses to run when NODE_ENV=production. Never executed
 * automatically. Credentials are NEVER committed: they come from DEV_SEED_PASSWORD / DEV_SEED_PIN
 * at seed time; without them identities are created PENDING_ACTIVATION (use the activation flow).
 * Privileged identities (principals) must still enroll TOTP MFA at first sign-in.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app/app.module.js';
import { PasswordHasher } from '../auth/core/crypto/password-hasher.js';
import { validatePassword, validatePin } from '../auth/core/credential-policy.js';
import type {
  AcademicYearStatus,
  PrismaClient,
  SchoolBoard,
  TenantStatus,
  Weekday,
} from '../generated/prisma/client.js';
import { PlatformPrismaService } from './platform-prisma.service.js';
import { calculateStudent } from '../tenant-api/assessment/result-calc.js';
import { Prisma } from '../generated/prisma/client.js';

interface DemoTenant {
  key: string;
  slug: string;
  displayName: string;
  status: TenantStatus;
  domain: string;
  primaryColor: string;
  accentColor: string;
  features: string[];
  timezone: string;
}

const DEMO_TENANTS: DemoTenant[] = [
  {
    key: 'SCHOOL_A',
    slug: 'school-a',
    displayName: 'Acadlyx Demo School A',
    status: 'ACTIVE',
    domain: 'school-a.localhost',
    primaryColor: '#1D4ED8',
    accentColor: '#F59E0B',
    features: ['STUDENTS', 'PARENTS', 'TEACHERS', 'ATTENDANCE', 'HOMEWORK', 'NOTICES'],
    timezone: 'Asia/Kolkata',
  },
  {
    key: 'SCHOOL_B',
    slug: 'school-b',
    displayName: 'Acadlyx Demo School B',
    status: 'ACTIVE',
    domain: 'school-b.localhost',
    primaryColor: '#15803D',
    accentColor: '#0EA5E9',
    features: ['STUDENTS', 'ATTENDANCE', 'FEES', 'PAYMENTS', 'TRANSPORT'],
    timezone: 'Asia/Dubai',
  },
  {
    key: 'SCHOOL_C',
    slug: 'school-c',
    displayName: 'Acadlyx Demo School C',
    status: 'DRAFT',
    domain: 'school-c.localhost',
    primaryColor: '#7C3AED',
    accentColor: '#EC4899',
    features: ['STUDENTS', 'EXAMS', 'RESULTS'],
    timezone: 'Asia/Kolkata',
  },
];

interface DemoIdentity {
  tenantKey: string;
  displayName: string;
  roles: string[];
  email?: string;
  phone?: string;
  loginId?: string;
  loginIdKind?: 'STUDENT_ID' | 'EMPLOYEE_ID';
  credential: 'PASSWORD' | 'PIN';
}

/** Same parent mobile in SCHOOL_A and SCHOOL_B: independent accounts per school (approved). */
const DEMO_IDENTITIES: DemoIdentity[] = [
  {
    tenantKey: 'SCHOOL_A',
    displayName: 'Asha Principal',
    roles: ['PRINCIPAL'],
    email: 'principal@school-a.example.com',
    credential: 'PASSWORD',
  },
  {
    tenantKey: 'SCHOOL_A',
    displayName: 'Sunita School Admin',
    roles: ['SCHOOL_ADMIN'],
    email: 'admin@school-a.example.com',
    credential: 'PASSWORD',
  },
  {
    tenantKey: 'SCHOOL_A',
    displayName: 'Ravi Teacher',
    roles: ['TEACHER'],
    email: 'teacher@school-a.example.com',
    loginId: 'TCH001',
    loginIdKind: 'EMPLOYEE_ID',
    credential: 'PASSWORD',
  },
  {
    tenantKey: 'SCHOOL_A',
    displayName: 'Neha Sharma',
    roles: ['TEACHER', 'PARENT'],
    email: 'neha@school-a.example.com',
    phone: '+919800000002',
    loginId: 'TCH002',
    loginIdKind: 'EMPLOYEE_ID',
    credential: 'PASSWORD',
  },
  {
    tenantKey: 'SCHOOL_A',
    displayName: 'Pooja Parent',
    roles: ['PARENT'],
    phone: '+919800000001',
    credential: 'PIN',
  },
  {
    tenantKey: 'SCHOOL_A',
    displayName: 'Aarav Student',
    roles: ['STUDENT'],
    loginId: 'STU001',
    loginIdKind: 'STUDENT_ID',
    credential: 'PIN',
  },
  {
    tenantKey: 'SCHOOL_B',
    displayName: 'Bina Principal',
    roles: ['PRINCIPAL'],
    email: 'principal@school-b.example.com',
    credential: 'PASSWORD',
  },
  {
    tenantKey: 'SCHOOL_B',
    displayName: 'Karan Teacher',
    roles: ['TEACHER'],
    email: 'teacher@school-b.example.com',
    loginId: 'TCH001',
    loginIdKind: 'EMPLOYEE_ID',
    credential: 'PASSWORD',
  },
  {
    tenantKey: 'SCHOOL_B',
    displayName: 'Pooja Parent (School B)',
    roles: ['PARENT'],
    phone: '+919800000001',
    credential: 'PIN',
  },
];

async function seedIdentities(prisma: PrismaClient, hasher: PasswordHasher): Promise<void> {
  const password = process.env.DEV_SEED_PASSWORD;
  const pin = process.env.DEV_SEED_PIN;
  if (password) validatePassword(password, 12);
  if (pin) validatePin(pin);
  const passwordHash = password ? await hasher.hash(password) : null;
  const pinHash = pin ? await hasher.hash(pin) : null;

  for (const identity of DEMO_IDENTITIES) {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { key: identity.tenantKey } });
    const hash = identity.credential === 'PIN' ? pinHash : passwordHash;
    const where = identity.loginId
      ? { tenantId: tenant.id, loginId: identity.loginId }
      : identity.email
        ? { tenantId: tenant.id, email: identity.email }
        : { tenantId: tenant.id, phone: identity.phone ?? '' };
    const existing = await prisma.user.findFirst({ where });
    if (existing) {
      process.stdout.write(
        `  identity ${identity.displayName} (${identity.tenantKey}) exists — unchanged\n`,
      );
      continue;
    }
    const roles = await prisma.role.findMany({
      where: { key: { in: identity.roles }, scope: 'TENANT' },
    });
    const now = new Date();
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        displayName: identity.displayName,
        email: identity.email ?? null,
        phone: identity.phone ?? null,
        loginId: identity.loginId ?? null,
        loginIdKind: identity.loginIdKind ?? null,
        status: hash ? 'ACTIVE' : 'PENDING_ACTIVATION',
        credentialType: hash ? identity.credential : null,
        credentialHash: hash,
        credentialUpdatedAt: hash ? now : null,
        emailVerifiedAt: hash && identity.email ? now : null,
        phoneVerifiedAt: hash && identity.phone ? now : null,
        roles: { create: roles.map((r) => ({ roleId: r.id, roleScope: 'TENANT' as const })) },
      },
    });
    process.stdout.write(
      `  identity ${identity.displayName} [${identity.roles.join('+')}] (${identity.tenantKey}) ${hash ? 'ACTIVE' : 'PENDING_ACTIVATION'}\n`,
    );
  }
}

// ---- Phase 4: fictional academic structure (idempotent; never overwrites admin changes) ----

interface DemoAcademic {
  tenantKey: string;
  school: {
    code: string;
    board: SchoolBoard;
    email: string;
    phone: string;
    city: string;
    state: string;
    country: string;
  };
  weekStartDay: Weekday;
  workingDays: Weekday[];
  academicYearStartMonth: number;
  branches: { code: string; name: string; city: string }[];
  years: {
    name: string;
    start: string;
    end: string;
    status: AcademicYearStatus;
    current?: boolean;
  }[];
  grades: { code: string; name: string }[];
  /** [branchCode, yearName, gradeCodes, sectionCodes] */
  sections: [string, string, string[], string[]][];
  subjects: { code: string; name: string }[];
  /** gradeCode → [subjectCode, required][] */
  gradeSubjects: Record<string, [string, boolean][]>;
}

const MON_SAT: Weekday[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const PRIMARY_CORE: [string, boolean][] = [
  ['ENG', true],
  ['MATH', true],
  ['EVS', true],
  ['HIN', true],
  ['CS', true],
  ['ART', false],
  ['PE', false],
];

const DEMO_ACADEMIC: DemoAcademic[] = [
  {
    tenantKey: 'SCHOOL_A',
    school: {
      code: 'DSA',
      board: 'CBSE',
      email: 'office@school-a.example.com',
      phone: '+91 755 000 0001',
      city: 'Lakeview',
      state: 'Demo State',
      country: 'IN',
    },
    weekStartDay: 'MONDAY',
    workingDays: MON_SAT,
    academicYearStartMonth: 4,
    branches: [
      { code: 'MAIN', name: 'Main Campus', city: 'Lakeview' },
      { code: 'NORTH', name: 'North Campus', city: 'Lakeview North' },
    ],
    years: [
      { name: '2025–26', start: '2025-04-01', end: '2026-03-31', status: 'CLOSED' },
      { name: '2026–27', start: '2026-04-01', end: '2027-03-31', status: 'ACTIVE', current: true },
      { name: '2027–28', start: '2027-04-01', end: '2028-03-31', status: 'PLANNED' },
    ],
    grades: [
      { code: 'NUR', name: 'Nursery' },
      { code: 'LKG', name: 'LKG' },
      { code: 'UKG', name: 'UKG' },
      { code: 'G1', name: 'Grade 1' },
      { code: 'G2', name: 'Grade 2' },
      { code: 'G3', name: 'Grade 3' },
      { code: 'G4', name: 'Grade 4' },
      { code: 'G5', name: 'Grade 5' },
    ],
    sections: [
      ['MAIN', '2026–27', ['NUR', 'LKG', 'UKG', 'G1', 'G2', 'G3', 'G4', 'G5'], ['A', 'B']],
      ['NORTH', '2026–27', ['G1', 'G2', 'G3'], ['A']],
    ],
    subjects: [
      { code: 'ENG', name: 'English' },
      { code: 'MATH', name: 'Mathematics' },
      { code: 'EVS', name: 'Environmental Studies' },
      { code: 'HIN', name: 'Hindi (Second Language)' },
      { code: 'CS', name: 'Computer Science' },
      { code: 'ART', name: 'Art & Craft' },
      { code: 'PE', name: 'Physical Education' },
    ],
    gradeSubjects: {
      NUR: [
        ['ENG', true],
        ['MATH', true],
        ['ART', false],
      ],
      LKG: [
        ['ENG', true],
        ['MATH', true],
        ['ART', false],
      ],
      UKG: [
        ['ENG', true],
        ['MATH', true],
        ['HIN', true],
        ['ART', false],
      ],
      G1: PRIMARY_CORE,
      G2: PRIMARY_CORE,
      G3: PRIMARY_CORE,
      G4: PRIMARY_CORE,
      G5: PRIMARY_CORE,
    },
  },
  {
    tenantKey: 'SCHOOL_B',
    school: {
      code: 'DSB',
      board: 'CAMBRIDGE',
      email: 'office@school-b.example.com',
      phone: '+971 4 000 0002',
      city: 'Harbour City',
      state: 'Demo Emirate',
      country: 'AE',
    },
    weekStartDay: 'MONDAY',
    workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    academicYearStartMonth: 9,
    branches: [{ code: 'DT', name: 'Downtown Campus', city: 'Harbour City' }],
    years: [
      { name: '2026–27', start: '2026-09-01', end: '2027-06-30', status: 'ACTIVE', current: true },
    ],
    grades: [1, 2, 3, 4, 5, 6].map((n) => ({ code: `Y${String(n)}`, name: `Year ${String(n)}` })),
    sections: [['DT', '2026–27', ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'], ['RED', 'BLUE']]],
    subjects: [
      { code: 'ENG', name: 'English' },
      { code: 'MATH', name: 'Mathematics' },
      { code: 'SCI', name: 'Science' },
      { code: 'ARB', name: 'Arabic' },
      { code: 'ICT', name: 'ICT' },
    ],
    gradeSubjects: Object.fromEntries(
      ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'].map((g): [string, [string, boolean][]] => [
        g,
        [
          ['ENG', true],
          ['MATH', true],
          ['SCI', true],
          ['ARB', true],
          ['ICT', false],
        ],
      ]),
    ),
  },
  {
    tenantKey: 'SCHOOL_C',
    school: {
      code: 'DSC',
      board: 'STATE_BOARD',
      email: 'office@school-c.example.com',
      phone: '+91 755 000 0003',
      city: 'Hill Town',
      state: 'Demo State',
      country: 'IN',
    },
    weekStartDay: 'MONDAY',
    workingDays: MON_SAT,
    academicYearStartMonth: 6,
    branches: [{ code: 'MAIN', name: 'Main Campus', city: 'Hill Town' }],
    years: [{ name: '2026–27', start: '2026-06-01', end: '2027-04-30', status: 'PLANNED' }],
    grades: [
      { code: 'G1', name: 'Grade 1' },
      { code: 'G2', name: 'Grade 2' },
    ],
    sections: [['MAIN', '2026–27', ['G1', 'G2'], ['A']]],
    subjects: [
      { code: 'ENG', name: 'English' },
      { code: 'MATH', name: 'Mathematics' },
    ],
    gradeSubjects: {
      G1: [
        ['ENG', true],
        ['MATH', true],
      ],
      G2: [
        ['ENG', true],
        ['MATH', true],
      ],
    },
  },
];

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function seedAcademic(
  prisma: PrismaClient,
  timezones: Record<string, string>,
): Promise<void> {
  for (const demo of DEMO_ACADEMIC) {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { key: demo.tenantKey } });
    const tenantId = tenant.id;
    const timezone = timezones[demo.tenantKey] ?? 'Asia/Kolkata';
    let school = await prisma.school.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
    school ??= await prisma.school.create({
      data: { tenantId, name: tenant.displayName, timezone, workingDays: demo.workingDays },
    });
    // Profile fields only filled when empty — admin edits are never overwritten.
    if (!school.code) {
      school = await prisma.school.update({
        where: { id: school.id },
        data: {
          code: demo.school.code,
          board: demo.school.board,
          email: demo.school.email,
          phone: demo.school.phone,
          city: demo.school.city,
          state: demo.school.state,
          country: demo.school.country,
          timezone,
          weekStartDay: demo.weekStartDay,
          workingDays: demo.workingDays,
          academicYearStartMonth: demo.academicYearStartMonth,
        },
      });
    }
    const schoolId = school.id;
    const scope = { tenantId, schoolId };

    const branches: Record<string, string> = {};
    for (const b of demo.branches) {
      const hasPrimary = (await prisma.branch.count({ where: { schoolId, isPrimary: true } })) > 0;
      const row = await prisma.branch.upsert({
        where: { schoolId_code: { schoolId, code: b.code } },
        create: {
          ...scope,
          code: b.code,
          name: b.name,
          city: b.city,
          country: demo.school.country,
          timezone,
          isPrimary: !hasPrimary,
        },
        update: {},
      });
      branches[b.code] = row.id;
    }

    const years: Record<string, string> = {};
    for (const y of demo.years) {
      const existing = await prisma.academicYear.findFirst({ where: { schoolId, name: y.name } });
      const row =
        existing ??
        (await prisma.academicYear.create({
          data: {
            ...scope,
            name: y.name,
            startDate: day(y.start),
            endDate: day(y.end),
            status: y.status,
          },
        }));
      years[y.name] = row.id;
    }
    const current = demo.years.find((y) => y.current);
    if (
      current &&
      !(await prisma.academicYear.findFirst({ where: { schoolId, isCurrent: true } }))
    ) {
      await prisma.academicYear.update({
        where: { id: years[current.name] },
        data: { isCurrent: true },
      });
    }

    const grades: Record<string, string> = {};
    for (const g of demo.grades) {
      const existing = await prisma.grade.findUnique({
        where: { schoolId_code: { schoolId, code: g.code } },
      });
      if (existing) {
        grades[g.code] = existing.id;
        continue;
      }
      const last = await prisma.grade.aggregate({
        where: { schoolId },
        _max: { displayOrder: true },
      });
      const row = await prisma.grade.create({
        data: {
          ...scope,
          code: g.code,
          name: g.name,
          displayOrder: (last._max.displayOrder ?? -1) + 1,
        },
      });
      grades[g.code] = row.id;
    }

    let sectionCount = 0;
    for (const [branchCode, yearName, gradeCodes, sectionCodes] of demo.sections) {
      for (const gradeCode of gradeCodes) {
        const key = {
          branchId: branches[branchCode] ?? '',
          academicYearId: years[yearName] ?? '',
          gradeId: grades[gradeCode] ?? '',
        };
        for (const code of sectionCodes) {
          const exists = await prisma.section.findUnique({
            where: { branchId_academicYearId_gradeId_code: { ...key, code } },
          });
          if (exists) continue;
          const last = await prisma.section.aggregate({ where: key, _max: { displayOrder: true } });
          await prisma.section.create({
            data: {
              ...scope,
              ...key,
              code,
              name: code.length === 1 ? code : code.charAt(0) + code.slice(1).toLowerCase(),
              capacity: 40,
              displayOrder: (last._max.displayOrder ?? -1) + 1,
            },
          });
          sectionCount += 1;
        }
      }
    }

    const subjects: Record<string, string> = {};
    for (const sub of demo.subjects) {
      const row = await prisma.subject.upsert({
        where: { schoolId_code: { schoolId, code: sub.code } },
        create: { ...scope, code: sub.code, name: sub.name },
        update: {},
      });
      subjects[sub.code] = row.id;
    }
    for (const [gradeCode, list] of Object.entries(demo.gradeSubjects)) {
      for (const [index, [subjectCode, isRequired]] of list.entries()) {
        const gradeId = grades[gradeCode] ?? '';
        const subjectId = subjects[subjectCode] ?? '';
        await prisma.gradeSubject.upsert({
          where: { gradeId_subjectId: { gradeId, subjectId } },
          create: { ...scope, gradeId, subjectId, isRequired, displayOrder: index },
          update: {},
        });
      }
    }
    process.stdout.write(
      `  academic ${demo.tenantKey}: ${String(demo.branches.length)} branches, ${String(demo.years.length)} years, ${String(demo.grades.length)} grades, +${String(sectionCount)} sections, ${String(demo.subjects.length)} subjects\n`,
    );
  }
}

/**
 * Phase 5 fictional people. Profiles are linked to the seeded identities above only when that
 * User already holds the matching role (no silent grants); other profiles have no login.
 * Idempotent: keyed by admission number / parent code / employee ID; existing rows are left alone.
 */
interface DemoPeople {
  tenantKey: string;
  parents: { code: string; first: string; last: string; phone?: string; linkPhone?: string }[];
  teachers: {
    employeeId: string;
    first: string;
    last: string;
    email?: string;
    linkLoginId?: string;
  }[];
  students: {
    admission: string;
    first: string;
    last: string;
    dob: string;
    section?: [string, string, string]; // branch, grade, section in the current year
    guardians?: [string, 'FATHER' | 'MOTHER' | 'GUARDIAN', boolean][];
    linkLoginId?: string;
  }[];
  assignments?: [string, string, string, string | null][]; // employeeId, grade, section, subject|null (class teacher)
}

const DEMO_PEOPLE: DemoPeople[] = [
  {
    tenantKey: 'SCHOOL_A',
    parents: [
      {
        code: 'PAR-A001',
        first: 'Pooja',
        last: 'Verma',
        phone: '+919800000001',
        linkPhone: '+919800000001',
      },
      {
        code: 'PAR-A002',
        first: 'Neha',
        last: 'Sharma',
        phone: '+919800000002',
        linkPhone: '+919800000002',
      },
      { code: 'PAR-A003', first: 'Imran', last: 'Qureshi' },
    ],
    teachers: [
      {
        employeeId: 'TCH001',
        first: 'Ravi',
        last: 'Kumar',
        email: 'teacher@school-a.example.com',
        linkLoginId: 'TCH001',
      },
      {
        employeeId: 'TCH002',
        first: 'Neha',
        last: 'Sharma',
        email: 'neha@school-a.example.com',
        linkLoginId: 'TCH002',
      },
      { employeeId: 'TCH003', first: 'Farah', last: 'Iqbal' },
    ],
    students: [
      {
        admission: 'STU001',
        first: 'Aarav',
        last: 'Verma',
        dob: '2016-06-12',
        section: ['MAIN', 'G5', 'A'],
        guardians: [['PAR-A001', 'MOTHER', true]],
        linkLoginId: 'STU001',
      },
      {
        // Aarav's younger sister — Pooja's second child, for the Phase 8 child switcher.
        admission: 'STU007',
        first: 'Anaya',
        last: 'Verma',
        dob: '2018-03-09',
        section: ['MAIN', 'G4', 'A'],
        guardians: [['PAR-A001', 'MOTHER', true]],
      },
      {
        admission: 'STU002',
        first: 'Diya',
        last: 'Sharma',
        dob: '2017-02-03',
        section: ['MAIN', 'G4', 'A'],
        guardians: [['PAR-A002', 'MOTHER', true]],
      },
      {
        admission: 'STU003',
        first: 'Kabir',
        last: 'Qureshi',
        dob: '2016-09-21',
        section: ['MAIN', 'G5', 'A'],
        guardians: [['PAR-A003', 'FATHER', true]],
      },
      {
        admission: 'STU004',
        first: 'Mira',
        last: 'Qureshi',
        dob: '2019-11-30',
        section: ['NORTH', 'G1', 'A'],
        guardians: [['PAR-A003', 'FATHER', true]],
      },
      { admission: 'STU005', first: 'Ishaan', last: 'Nair', dob: '2016-01-15' },
    ],
    assignments: [
      ['TCH001', 'G5', 'A', null],
      ['TCH001', 'G5', 'A', 'MATH'],
      ['TCH002', 'G5', 'A', 'ENG'],
      ['TCH002', 'G4', 'A', null],
      ['TCH003', 'G5', 'A', 'EVS'],
    ],
  },
  {
    tenantKey: 'SCHOOL_B',
    parents: [
      {
        code: 'PAR-B001',
        first: 'Pooja',
        last: 'Verma',
        phone: '+919800000001',
        linkPhone: '+919800000001',
      },
    ],
    teachers: [
      {
        employeeId: 'TCH001',
        first: 'Karan',
        last: 'Mehta',
        email: 'teacher@school-b.example.com',
        linkLoginId: 'TCH001',
      },
    ],
    students: [
      {
        admission: 'B-0001',
        first: 'Rohan',
        last: 'Verma',
        dob: '2015-04-04',
        guardians: [['PAR-B001', 'MOTHER', true]],
      },
    ],
  },
];

async function seedPeople(prisma: PrismaClient): Promise<void> {
  for (const demo of DEMO_PEOPLE) {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { key: demo.tenantKey } });
    const tenantId = tenant.id;
    const school = await prisma.school.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
    if (!school) {
      process.stdout.write(`  people ${demo.tenantKey}: no school yet, skipped\n`);
      continue;
    }
    const scope = { tenantId, schoolId: school.id };
    const userWithRole = async (where: { phone?: string; loginId?: string }, role: string) => {
      const user = await prisma.user.findFirst({
        where: { tenantId, ...where, roles: { some: { role: { key: role } } } },
      });
      return user?.id ?? null;
    };
    const freeLink = async (model: 'student' | 'parent' | 'teacher', userId: string | null) => {
      if (!userId) return null;
      const taken =
        model === 'student'
          ? await prisma.student.findFirst({ where: { userId } })
          : model === 'parent'
            ? await prisma.parent.findFirst({ where: { userId } })
            : await prisma.teacher.findFirst({ where: { userId } });
      return taken ? null : userId;
    };

    const parents: Record<string, string> = {};
    for (const p of demo.parents) {
      const existing = await prisma.parent.findFirst({
        where: { schoolId: school.id, parentCode: p.code },
      });
      const userId = existing
        ? null
        : await freeLink(
            'parent',
            p.linkPhone ? await userWithRole({ phone: p.linkPhone }, 'PARENT') : null,
          );
      const row =
        existing ??
        (await prisma.parent.create({
          data: {
            ...scope,
            parentCode: p.code,
            firstName: p.first,
            lastName: p.last,
            phone: p.phone ?? null,
            userId,
          },
        }));
      parents[p.code] = row.id;
    }

    const teachers: Record<string, string> = {};
    for (const t of demo.teachers) {
      const existing = await prisma.teacher.findUnique({
        where: { schoolId_employeeId: { schoolId: school.id, employeeId: t.employeeId } },
      });
      const userId = existing
        ? null
        : await freeLink(
            'teacher',
            t.linkLoginId ? await userWithRole({ loginId: t.linkLoginId }, 'TEACHER') : null,
          );
      const row =
        existing ??
        (await prisma.teacher.create({
          data: {
            ...scope,
            employeeId: t.employeeId,
            firstName: t.first,
            lastName: t.last,
            email: t.email ?? null,
            userId,
          },
        }));
      teachers[t.employeeId] = row.id;
    }

    const year = await prisma.academicYear.findFirst({
      where: { schoolId: school.id, isCurrent: true },
    });
    const section = async (branch: string, grade: string, code: string) =>
      year
        ? prisma.section.findFirst({
            where: {
              schoolId: school.id,
              academicYearId: year.id,
              code,
              branch: { code: branch },
              grade: { code: grade },
            },
          })
        : null;

    let created = 0;
    for (const s of demo.students) {
      if (
        await prisma.student.findUnique({
          where: {
            schoolId_admissionNumber: { schoolId: school.id, admissionNumber: s.admission },
          },
        })
      )
        continue;
      const userId = await freeLink(
        'student',
        s.linkLoginId ? await userWithRole({ loginId: s.linkLoginId }, 'STUDENT') : null,
      );
      const student = await prisma.student.create({
        data: {
          ...scope,
          admissionNumber: s.admission,
          firstName: s.first,
          lastName: s.last,
          dateOfBirth: day(s.dob),
          admissionDate: day('2026-04-01'),
          userId,
        },
      });
      created += 1;
      await prisma.studentStatusHistory.create({
        data: { ...scope, studentId: student.id, toStatus: 'ACTIVE', reason: 'Seeded' },
      });
      const sec = s.section ? await section(...s.section) : null;
      if (sec && year)
        await prisma.studentEnrollment.create({
          data: {
            ...scope,
            studentId: student.id,
            sectionId: sec.id,
            academicYearId: year.id,
            startDate: day('2026-04-01'),
          },
        });
      for (const [code, relationship, isPrimary] of s.guardians ?? []) {
        const parentId = parents[code];
        if (parentId)
          await prisma.studentGuardian.create({
            data: {
              ...scope,
              studentId: student.id,
              parentId,
              relationship,
              isPrimary,
              pickupAuthorized: true,
              isEmergencyContact: isPrimary,
            },
          });
      }
    }

    for (const [employeeId, grade, code, subjectCode] of demo.assignments ?? []) {
      const teacherId = teachers[employeeId];
      const sec = await section('MAIN', grade, code);
      if (!teacherId || !sec) continue;
      const subject = subjectCode
        ? await prisma.subject.findUnique({
            where: { schoolId_code: { schoolId: school.id, code: subjectCode } },
          })
        : null;
      if (subjectCode && !subject) continue;
      const exists = await prisma.teacherAssignment.findFirst({
        where: { teacherId, sectionId: sec.id, subjectId: subject?.id ?? null, endedAt: null },
      });
      if (exists) continue;
      if (
        !subject &&
        (await prisma.teacherAssignment.findFirst({
          where: { sectionId: sec.id, type: 'CLASS_TEACHER', endedAt: null },
        }))
      )
        continue;
      await prisma.teacherAssignment.create({
        data: {
          ...scope,
          teacherId,
          sectionId: sec.id,
          subjectId: subject?.id ?? null,
          type: subject ? 'SUBJECT_TEACHER' : 'CLASS_TEACHER',
        },
      });
    }
    process.stdout.write(
      `  people ${demo.tenantKey}: ${String(demo.parents.length)} parents, ${String(demo.teachers.length)} teachers, +${String(created)} students\n`,
    );
  }
}

/**
 * Phase 7 fictional academic operations: a bell schedule per demo school, a weekly timetable for
 * SCHOOL_A Grade 5 A built from the seeded teacher assignments, attendance for the three previous
 * working days (today is left for the teacher walkthrough), and a little homework / assignments.
 * Idempotent: periods by name, lessons by slot, attendance by class + date, work by title.
 * Dates are relative to the seed day (school-local).
 */
const DEMO_PERIODS: [string, 'INSTRUCTIONAL' | 'BREAK' | 'LUNCH' | 'ASSEMBLY', string, string][] = [
  ['Assembly', 'ASSEMBLY', '08:15', '08:30'],
  ['Period 1', 'INSTRUCTIONAL', '08:30', '09:15'],
  ['Period 2', 'INSTRUCTIONAL', '09:15', '10:00'],
  ['Break', 'BREAK', '10:00', '10:15'],
  ['Period 3', 'INSTRUCTIONAL', '10:15', '11:00'],
  ['Period 4', 'INSTRUCTIONAL', '11:00', '11:45'],
  ['Lunch', 'LUNCH', '11:45', '12:15'],
  ['Period 5', 'INSTRUCTIONAL', '12:15', '13:00'],
];
/** SCHOOL_A Grade 5 A weekly lessons: [employeeId, subject, weekday, period]. */
const DEMO_LESSONS: [string, string, Weekday, string][] = [
  ['TCH001', 'MATH', 'MONDAY', 'Period 1'],
  ['TCH001', 'MATH', 'WEDNESDAY', 'Period 2'],
  ['TCH001', 'MATH', 'FRIDAY', 'Period 3'],
  ['TCH002', 'ENG', 'MONDAY', 'Period 2'],
  ['TCH002', 'ENG', 'TUESDAY', 'Period 1'],
  ['TCH002', 'ENG', 'THURSDAY', 'Period 3'],
  ['TCH003', 'EVS', 'TUESDAY', 'Period 2'],
  ['TCH003', 'EVS', 'THURSDAY', 'Period 1'],
];

async function seedOperations(prisma: PrismaClient): Promise<void> {
  const localDate = (tz: string, offsetDays = 0) => {
    const d = new Date(Date.now() + offsetDays * 86_400_000);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  };
  const DAYS: Weekday[] = [
    'SUNDAY',
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
    'SATURDAY',
  ];
  const weekdayOf = (iso: string) => DAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()] ?? 'MONDAY';

  for (const key of ['SCHOOL_A', 'SCHOOL_B']) {
    const tenant = await prisma.tenant.findUnique({ where: { key } });
    if (!tenant) continue;
    const tenantId = tenant.id;
    const school = await prisma.school.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
    const year = school
      ? await prisma.academicYear.findFirst({ where: { schoolId: school.id, isCurrent: true } })
      : null;
    // SCHOOL_A's demo classes live on the MAIN campus (the primary branch may be changed by admins).
    const branch = school
      ? ((await prisma.branch.findFirst({ where: { schoolId: school.id, code: 'MAIN' } })) ??
        (await prisma.branch.findFirst({ where: { schoolId: school.id, isPrimary: true } })))
      : null;
    if (!school || !year || !branch) continue;
    const scope = { tenantId, schoolId: school.id };
    const actor = await prisma.user.findFirst({
      where: {
        tenantId,
        roles: { some: { role: { key: { in: ['SCHOOL_ADMIN', 'PRINCIPAL'] } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!actor) continue;

    // Bell schedule (primary branch, current year).
    const periods: Record<string, { id: string; start: string; end: string }> = {};
    for (const [i, [name, type, start, end]] of DEMO_PERIODS.entries()) {
      const existing = await prisma.timetablePeriod.findUnique({
        where: {
          branchId_academicYearId_name: { branchId: branch.id, academicYearId: year.id, name },
        },
      });
      const row =
        existing ??
        (await prisma.timetablePeriod.create({
          data: {
            ...scope,
            branchId: branch.id,
            academicYearId: year.id,
            name,
            type,
            startTime: new Date(`1970-01-01T${start}:00Z`),
            endTime: new Date(`1970-01-01T${end}:00Z`),
            displayOrder: i,
          },
        }));
      periods[name] = { id: row.id, start, end };
    }

    let lessons = 0;
    let days = 0;
    let work = 0;
    const g5a =
      key === 'SCHOOL_A'
        ? await prisma.section.findFirst({
            where: {
              schoolId: school.id,
              academicYearId: year.id,
              branchId: branch.id,
              code: 'A',
              grade: { code: 'G5' },
            },
          })
        : null;
    if (g5a) {
      for (const [employeeId, subjectCode, weekday, periodName] of DEMO_LESSONS) {
        const teacher = await prisma.teacher.findUnique({
          where: { schoolId_employeeId: { schoolId: school.id, employeeId } },
        });
        const subject = await prisma.subject.findUnique({
          where: { schoolId_code: { schoolId: school.id, code: subjectCode } },
        });
        const period = periods[periodName];
        if (!teacher || !subject || !period || !school.workingDays.includes(weekday)) continue;
        const holds = await prisma.teacherAssignment.findFirst({
          where: {
            teacherId: teacher.id,
            sectionId: g5a.id,
            subjectId: subject.id,
            endedAt: null,
            type: 'SUBJECT_TEACHER',
          },
        });
        if (!holds) continue;
        const exists = await prisma.timetableEntry.findFirst({
          where: { sectionId: g5a.id, weekday, periodId: period.id },
        });
        if (exists) continue;
        // Raw SQL: Prisma cannot serialise the @db.Time parts of the entry→period composite key.
        await prisma.$executeRaw`
          INSERT INTO "timetable_entries" ("id", "tenant_id", "school_id", "branch_id", "academic_year_id", "section_id",
            "period_id", "period_type", "start_time", "end_time", "weekday", "subject_id", "teacher_id", "updated_at")
          VALUES (gen_random_uuid(), ${tenantId}::uuid, ${school.id}::uuid, ${branch.id}::uuid, ${year.id}::uuid,
            ${g5a.id}::uuid, ${period.id}::uuid, 'INSTRUCTIONAL', ${period.start}::time, ${period.end}::time,
            ${weekday}::"weekday", ${subject.id}::uuid, ${teacher.id}::uuid, now())`;
        lessons += 1;
      }

      // Attendance for the three previous working days (fictional pattern, no health data).
      const pattern: ('PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED')[] = [
        'PRESENT',
        'PRESENT',
        'LATE',
        'PRESENT',
        'ABSENT',
      ];
      let offset = -1;
      let recorded = 0;
      while (recorded < 3 && offset > -14) {
        const date = localDate(branch.timezone, offset);
        offset -= 1;
        if (!school.workingDays.includes(weekdayOf(date))) continue;
        if (date < year.startDate.toISOString().slice(0, 10)) break;
        recorded += 1;
        const d = new Date(`${date}T00:00:00Z`);
        if (
          await prisma.attendanceSession.findUnique({
            where: { sectionId_date: { sectionId: g5a.id, date: d } },
          })
        )
          continue;
        const roster = await prisma.studentEnrollment.findMany({
          where: {
            sectionId: g5a.id,
            startDate: { lte: d },
            OR: [{ endDate: null }, { endDate: { gt: d } }],
          },
          orderBy: { studentId: 'asc' },
        });
        if (!roster.length) continue;
        const session = await prisma.attendanceSession.create({
          data: {
            ...scope,
            sectionId: g5a.id,
            academicYearId: year.id,
            date: d,
            createdByUserId: actor.id,
            updatedByUserId: actor.id,
          },
        });
        for (const [i, e] of roster.entries()) {
          const status = pattern[(i + recorded) % pattern.length] ?? 'PRESENT';
          const rec = await prisma.attendanceRecord.create({
            data: {
              ...scope,
              sessionId: session.id,
              studentId: e.studentId,
              status,
              note: status === 'LATE' ? 'Arrived after assembly' : null,
            },
          });
          await prisma.attendanceRecordHistory.create({
            data: {
              ...scope,
              recordId: rec.id,
              toStatus: status,
              toNote: rec.note,
              changedByUserId: actor.id,
            },
          });
        }
        days += 1;
      }
    }

    // Class work: SCHOOL_A Grade 5 A (by the assigned teachers); SCHOOL_B one admin-set item.
    const target =
      key === 'SCHOOL_A'
        ? g5a
        : await prisma.section.findFirst({
            where: {
              schoolId: school.id,
              academicYearId: year.id,
              branchId: branch.id,
              isActive: true,
            },
            orderBy: [{ displayOrder: 'asc' }],
          });
    if (target) {
      const plus = (n: number) => new Date(`${localDate(branch.timezone, n)}T00:00:00Z`);
      const subjectOf = async (code: string | null) =>
        code
          ? prisma.subject.findUnique({ where: { schoolId_code: { schoolId: school.id, code } } })
          : ((
              await prisma.gradeSubject.findFirst({
                where: { gradeId: target.gradeId },
                include: { subject: true },
                orderBy: { displayOrder: 'asc' },
              })
            )?.subject ?? null);
      const teacherOf = async (employeeId: string | null) =>
        employeeId
          ? prisma.teacher.findUnique({
              where: { schoolId_employeeId: { schoolId: school.id, employeeId } },
            })
          : null;
      const items: {
        kind: 'homework' | 'assignment';
        title: string;
        subject: string | null;
        teacher: string | null;
        status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
        due: number;
        /** Days from today the work was assigned (default 0). */
        assigned?: number;
        text: string;
      }[] =
        key === 'SCHOOL_A'
          ? [
              {
                kind: 'homework',
                title: 'Fractions practice — page 42',
                subject: 'MATH',
                teacher: 'TCH001',
                status: 'PUBLISHED',
                due: 2,
                text: 'Solve questions 1 to 10. Show your working.',
              },
              {
                kind: 'homework',
                title: 'Spelling list week 6',
                subject: 'ENG',
                teacher: 'TCH002',
                status: 'DRAFT',
                due: 5,
                text: 'Learn the 15 words on the class list.',
              },
              {
                kind: 'assignment',
                title: 'Local plants field notes',
                subject: 'EVS',
                teacher: 'TCH003',
                status: 'PUBLISHED',
                due: 10,
                text: 'Observe three plants near your home and describe their leaves.',
              },
              // Phase 8 submission states: past due but still open (late), and closed.
              {
                kind: 'assignment',
                title: 'Water cycle poster',
                subject: 'EVS',
                teacher: 'TCH003',
                status: 'PUBLISHED',
                assigned: -6,
                due: -2,
                text: 'Draw the water cycle and label each stage.',
              },
              {
                kind: 'assignment',
                title: 'Seeds and sprouts quiz',
                subject: 'EVS',
                teacher: 'TCH003',
                status: 'CLOSED',
                assigned: -9,
                due: -4,
                text: 'Answer the five questions about how seeds sprout.',
              },
            ]
          : [
              {
                kind: 'homework',
                title: 'Reading log — chapter 3',
                subject: null,
                teacher: null,
                status: 'PUBLISHED',
                due: 3,
                text: 'Read chapter 3 and write two sentences about it.',
              },
            ];
      for (const it of items) {
        const subject = await subjectOf(it.subject);
        const teacher = await teacherOf(it.teacher);
        // Only subjects taught in the class's grade (the same rule the API enforces).
        if (
          !subject ||
          !(await prisma.gradeSubject.findFirst({
            where: { gradeId: target.gradeId, subjectId: subject.id },
          }))
        )
          continue;
        const model = it.kind === 'homework' ? prisma.homework : prisma.assignment;
        if (
          await (model as typeof prisma.homework).findFirst({
            where: { sectionId: target.id, title: it.title },
          })
        )
          continue;
        // Assignment is the wider type (adds CLOSED); homework items are only DRAFT/PUBLISHED.
        await (model as typeof prisma.assignment).create({
          data: {
            ...scope,
            sectionId: target.id,
            subjectId: subject.id,
            teacherId: teacher?.id ?? null,
            title: it.title,
            instructions: it.text,
            assignedDate: plus(it.assigned ?? 0),
            dueDate: plus(it.due),
            status: it.status,
            publishedAt: it.status === 'DRAFT' ? null : new Date(),
            ...(it.status === 'CLOSED' ? { closedAt: new Date() } : {}),
            createdByUserId: actor.id,
          },
        });
        work += 1;
      }
    }
    process.stdout.write(
      `  operations ${key}: ${String(Object.keys(periods).length)} periods, +${String(lessons)} lessons, +${String(days)} attendance days, +${String(work)} homework/assignments\n`,
    );
  }
}

/**
 * Phase 9 demo assessment data (fictional, idempotent — skipped when the exam already exists).
 * SCHOOL_A: a grade scale; "Mid Term" for Grade 5 (Mathematics with Written + Internal, English,
 * EVS with Theory + Practical) with every Grade 5 A mark finalized and results PUBLISHED as version
 * 1 (computed by the SAME canonical engine the API uses); "Unit Test 2" open for marks entry
 * (nothing entered); and a gradable assignment with a submission and a published grade.
 * SCHOOL_B: its own grade scale and a draft exam. Official numbers are exact decimals.
 */
async function seedAssessment(prisma: PrismaClient): Promise<void> {
  const D = Prisma.Decimal;
  const BANDS: [string, number, number][] = [
    ['A1', 90, 100],
    ['A2', 80, 90],
    ['B1', 70, 80],
    ['B2', 60, 70],
    ['C1', 50, 60],
    ['C2', 40, 50],
    ['D', 33, 40],
    ['E', 0, 33],
  ];
  for (const key of ['SCHOOL_A', 'SCHOOL_B']) {
    const tenant = await prisma.tenant.findUnique({ where: { key } });
    const school = tenant
      ? await prisma.school.findFirst({
          where: { tenantId: tenant.id },
          orderBy: { createdAt: 'asc' },
        })
      : null;
    const year = school
      ? await prisma.academicYear.findFirst({ where: { schoolId: school.id, isCurrent: true } })
      : null;
    if (!tenant || !school || !year) continue;
    const scope = { tenantId: tenant.id, schoolId: school.id };
    const actor = await prisma.user.findFirst({
      where: { tenantId: tenant.id, roles: { some: { role: { key: 'PRINCIPAL' } } } },
    });
    if (!actor) continue;
    const scaleName = key === 'SCHOOL_A' ? 'CBSE 2026–27' : 'School grades 2026–27';
    let scale = await prisma.gradeScale.findFirst({
      where: { schoolId: school.id, academicYearId: year.id, name: scaleName },
    });
    if (!scale) {
      scale = await prisma.gradeScale.create({
        data: { ...scope, academicYearId: year.id, name: scaleName },
      });
      await prisma.gradeBand.createMany({
        data: BANDS.map(([label, min, max], i) => ({
          ...scope,
          gradeScaleId: scale?.id ?? '',
          label,
          minPercentage: min,
          maxPercentage: max,
          displayOrder: i,
        })),
      });
    }
    let created = 0;
    if (key === 'SCHOOL_B') {
      const grade = await prisma.grade.findFirst({
        where: { schoolId: school.id },
        orderBy: { displayOrder: 'desc' },
      });
      const gs = grade
        ? await prisma.gradeSubject.findFirst({
            where: { gradeId: grade.id },
            orderBy: { displayOrder: 'asc' },
          })
        : null;
      if (
        grade &&
        gs &&
        !(await prisma.exam.findFirst({
          where: { schoolId: school.id, name: 'Term 1 Assessment' },
        }))
      ) {
        const exam = await prisma.exam.create({
          data: {
            ...scope,
            academicYearId: year.id,
            gradeScaleId: scale.id,
            name: 'Term 1 Assessment',
            startDate: new Date('2026-11-09'),
            endDate: new Date('2026-11-13'),
            createdByUserId: actor.id,
          },
        });
        const sub = await prisma.examSubject.create({
          data: {
            ...scope,
            examId: exam.id,
            academicYearId: year.id,
            gradeId: grade.id,
            subjectId: gs.subjectId,
            passMarks: 33,
          },
        });
        await prisma.examComponent.create({
          data: {
            ...scope,
            examSubjectId: sub.id,
            examId: exam.id,
            gradeId: grade.id,
            name: 'Written',
            maxMarks: 100,
          },
        });
        created += 1;
      }
      process.stdout.write(`  assessment ${key}: grade scale + ${String(created)} exam(s)\n`);
      continue;
    }
    const grade = await prisma.grade.findFirst({ where: { schoolId: school.id, code: 'G5' } });
    const branch = await prisma.branch.findFirst({ where: { schoolId: school.id, code: 'MAIN' } });
    const section =
      grade && branch
        ? await prisma.section.findFirst({
            where: {
              schoolId: school.id,
              gradeId: grade.id,
              branchId: branch.id,
              academicYearId: year.id,
              code: 'A',
            },
          })
        : null;
    const subj = async (code: string) =>
      prisma.subject.findFirst({ where: { schoolId: school.id, code } });
    const [math, eng, evs] = [await subj('MATH'), await subj('ENG'), await subj('EVS')];
    if (!grade || !branch || !section || !math || !eng || !evs) continue;
    const branches = await prisma.section.findMany({
      where: { schoolId: school.id, gradeId: grade.id, academicYearId: year.id, isActive: true },
      select: { branchId: true },
      distinct: ['branchId'],
    });

    /** Exam + subjects + components + a schedule per branch; returns component ids by key. */
    const build = async (
      name: string,
      start: string,
      end: string,
      status: 'MARKS_ENTRY' | 'DRAFT',
      plan: [string, typeof math, string | null, [string, number, number | null, string][]][],
    ) => {
      const exam = await prisma.exam.create({
        data: {
          ...scope,
          academicYearId: year.id,
          gradeScaleId: scale.id,
          name,
          startDate: new Date(start),
          endDate: new Date(end),
          status,
          publishedAt: status === 'DRAFT' ? null : new Date(),
          createdByUserId: actor.id,
        },
      });
      const comps: Record<
        string,
        { id: string; subjectId: string; examSubjectId: string; date: string }
      > = {};
      let order = 0;
      for (const [skey, s, pass, components] of plan) {
        const es = await prisma.examSubject.create({
          data: {
            ...scope,
            examId: exam.id,
            academicYearId: year.id,
            gradeId: grade.id,
            subjectId: s.id,
            passMarks: pass ? new D(pass) : null,
            displayOrder: order++,
          },
        });
        let corder = 0;
        for (const [cname, max, cpass, date] of components) {
          const c = await prisma.examComponent.create({
            data: {
              ...scope,
              examSubjectId: es.id,
              examId: exam.id,
              gradeId: grade.id,
              name: cname,
              maxMarks: max,
              passMarks: cpass,
              displayOrder: corder++,
            },
          });
          const hour = 9 + corder;
          for (const b of branches)
            await prisma.$executeRaw`INSERT INTO exam_component_schedules (id, tenant_id, school_id, component_id, exam_id, grade_id, branch_id, exam_date, start_time, end_time, updated_at)
              VALUES (gen_random_uuid(), ${tenant.id}::uuid, ${school.id}::uuid, ${c.id}::uuid, ${exam.id}::uuid, ${grade.id}::uuid, ${b.branchId}::uuid, ${date}::date,
                ${`${String(hour).padStart(2, '0')}:00`}::time, ${`${String(hour).padStart(2, '0')}:50`}::time, now())`;
          comps[`${skey}.${cname}`] = { id: c.id, subjectId: s.id, examSubjectId: es.id, date };
        }
      }
      return { exam, comps };
    };

    if (!(await prisma.exam.findFirst({ where: { schoolId: school.id, name: 'Mid Term' } }))) {
      const { exam, comps } = await build('Mid Term', '2026-09-14', '2026-09-19', 'MARKS_ENTRY', [
        [
          'MATH',
          math,
          '33',
          [
            ['Written', 80, null, '2026-09-14'],
            ['Internal', 20, null, '2026-09-15'],
          ],
        ],
        ['ENG', eng, '33', [['Written', 100, null, '2026-09-16']]],
        [
          'EVS',
          evs,
          '17',
          [
            ['Theory', 40, 13, '2026-09-17'],
            ['Practical', 10, null, '2026-09-18'],
          ],
        ],
      ]);
      const enrolled = await prisma.studentEnrollment.findMany({
        where: {
          sectionId: section.id,
          startDate: { lte: new Date('2026-09-14') },
          OR: [{ endDate: null }, { endDate: { gt: new Date('2026-09-18') } }],
        },
        include: { student: true },
        orderBy: { student: { admissionNumber: 'asc' } },
      });
      // Fictional marks: [Written, Internal, English, EVS Theory, EVS Practical]; null = ABSENT.
      const table: (number | null)[][] = [
        [68, 17, 81, 35, 9],
        [52.5, 15, 64, 12, 8],
        [74, 18, null, 31, 10],
        [45, 12, 58, 22, 7],
      ];
      const keys = ['MATH.Written', 'MATH.Internal', 'ENG.Written', 'EVS.Theory', 'EVS.Practical'];
      const sheets = new Map<string, string>();
      for (const k of keys) {
        const c = comps[k];
        if (!c || sheets.has(c.examSubjectId)) continue;
        const sheet = await prisma.examMarkSheet.create({
          data: {
            ...scope,
            examSubjectId: c.examSubjectId,
            examId: exam.id,
            gradeId: grade.id,
            academicYearId: year.id,
            sectionId: section.id,
            status: 'FINALIZED',
            version: 4,
            submittedByUserId: actor.id,
            submittedAt: new Date(),
            finalizedByUserId: actor.id,
            finalizedAt: new Date(),
          },
        });
        sheets.set(c.examSubjectId, sheet.id);
        await prisma.examMarkSheetEvent.createMany({
          data: [
            {
              ...scope,
              sheetId: sheet.id,
              fromStatus: 'DRAFT',
              toStatus: 'SUBMITTED',
              actorUserId: actor.id,
            },
            {
              ...scope,
              sheetId: sheet.id,
              fromStatus: 'SUBMITTED',
              toStatus: 'FINALIZED',
              actorUserId: actor.id,
            },
          ],
        });
      }
      const marksBy = new Map<
        string,
        Map<string, { status: 'MARKED' | 'ABSENT'; marks: number | null }>
      >();
      for (const [i, e] of enrolled.entries()) {
        const row = table[i % table.length] ?? [];
        const map = new Map<string, { status: 'MARKED' | 'ABSENT'; marks: number | null }>();
        for (const [j, k] of keys.entries()) {
          const c = comps[k];
          if (!c) continue;
          const v = row[j] ?? null;
          const status = v === null ? 'ABSENT' : 'MARKED';
          const m = await prisma.studentExamMark.create({
            data: {
              ...scope,
              sheetId: sheets.get(c.examSubjectId) ?? '',
              examSubjectId: c.examSubjectId,
              componentId: c.id,
              studentId: e.studentId,
              status,
              marksObtained: v,
              updatedByUserId: actor.id,
            },
          });
          await prisma.studentExamMarkHistory.create({
            data: {
              ...scope,
              markId: m.id,
              version: 1,
              toStatus: status,
              toMarks: v,
              changedByUserId: actor.id,
            },
          });
          map.set(c.id, { status, marks: v });
        }
        marksBy.set(e.studentId, map);
      }
      // Publish version 1 through the canonical engine.
      const bands = BANDS.map(([label, min, max]) => ({ label, min, max }));
      const full = await prisma.exam.findUniqueOrThrow({
        where: { id: exam.id },
        include: { subjects: { include: { subject: true, components: true } } },
      });
      const subjects = full.subjects.map((s) => ({
        examSubjectId: s.id,
        subjectName: s.subject.name,
        passMarks: s.passMarks,
        displayOrder: s.displayOrder,
        components: s.components.map((c) => ({
          id: c.id,
          name: c.name,
          maxMarks: c.maxMarks,
          passMarks: c.passMarks,
          displayOrder: c.displayOrder,
        })),
      }));
      const pub = await prisma.resultPublication.create({
        data: {
          ...scope,
          examId: exam.id,
          version: 1,
          schoolName: school.name,
          examName: exam.name,
          academicYearName: year.name,
          publishedByUserId: actor.id,
          publishedAt: new Date(),
        },
      });
      for (const e of enrolled) {
        const r = calculateStudent({
          subjects,
          marks: marksBy.get(e.studentId) ?? new Map(),
          eligible: new Set(Object.values(comps).map((c) => c.id)),
          bands,
        });
        const snap = await prisma.resultStudentSnapshot.create({
          data: {
            ...scope,
            publicationId: pub.id,
            studentId: e.studentId,
            sectionId: section.id,
            studentName: [e.student.firstName, e.student.middleName, e.student.lastName]
              .filter(Boolean)
              .join(' '),
            admissionNumber: e.student.admissionNumber,
            gradeName: grade.name,
            sectionName: section.name,
            totalObtained: r.obtained,
            totalMax: r.maxMarks,
            percentage: r.percentage,
            gradeLabel: r.grade,
            outcome: r.status as 'PASS' | 'FAIL',
          },
        });
        for (const s of r.subjects) {
          const ss = await prisma.resultSubjectSnapshot.create({
            data: {
              ...scope,
              studentSnapshotId: snap.id,
              subjectName: s.subjectName,
              displayOrder: s.displayOrder,
              obtained: s.obtained,
              maxMarks: s.maxMarks,
              passMarks: s.passMarks,
              percentage: s.percentage,
              gradeLabel: s.grade,
              outcome: s.outcome as 'PASS' | 'FAIL',
            },
          });
          await prisma.resultComponentSnapshot.createMany({
            data: s.components.map((c) => ({
              ...scope,
              subjectSnapshotId: ss.id,
              componentName: c.name,
              displayOrder: c.displayOrder,
              maxMarks: c.maxMarks,
              passMarks: c.passMarks,
              status: c.status ?? 'EXEMPT',
              marksObtained: c.marks,
              passed: c.passed,
            })),
          });
        }
      }
      await prisma.exam.update({
        where: { id: exam.id },
        data: { status: 'RESULTS_PUBLISHED', version: 6 },
      });
      created += 1;
    }
    if (!(await prisma.exam.findFirst({ where: { schoolId: school.id, name: 'Unit Test 2' } }))) {
      await build('Unit Test 2', '2026-10-12', '2026-10-16', 'MARKS_ENTRY', [
        ['MATH', math, '10', [['Written', 25, null, '2026-10-13']]],
        ['ENG', eng, '10', [['Written', 25, null, '2026-10-14']]],
      ]);
      created += 1;
    }
    // A gradable assignment with Aarav's submission and a published grade (decisions O–Q).
    let graded = 0;
    const aarav = await prisma.student.findFirst({
      where: { schoolId: school.id, admissionNumber: 'STU001' },
    });
    const ravi = await prisma.teacher.findFirst({
      where: { schoolId: school.id, employeeId: 'TCH001' },
    });
    if (
      aarav &&
      ravi &&
      !(await prisma.assignment.findFirst({
        where: { sectionId: section.id, title: 'Fractions quiz' },
      }))
    ) {
      const a = await prisma.assignment.create({
        data: {
          ...scope,
          sectionId: section.id,
          subjectId: math.id,
          teacherId: ravi.id,
          title: 'Fractions quiz',
          instructions: 'Answer the ten fraction questions from the worksheet.',
          assignedDate: new Date('2026-09-21'),
          dueDate: new Date('2026-09-25'),
          status: 'PUBLISHED',
          publishedAt: new Date(),
          maxMarks: 20,
          createdByUserId: ravi.userId ?? actor.id,
        },
      });
      const when = new Date('2026-09-24T10:00:00Z');
      const sub = await prisma.assignmentSubmission.create({
        data: {
          ...scope,
          assignmentId: a.id,
          studentId: aarav.id,
          textContent: '1) 3/4  2) 5/8  3) 1/2 …',
          firstSubmittedAt: when,
          lastSubmittedAt: when,
        },
      });
      const hist = await prisma.assignmentSubmissionHistory.create({
        data: {
          ...scope,
          submissionId: sub.id,
          version: 1,
          textContent: sub.textContent,
          submittedAt: when,
          submittedByUserId: aarav.userId ?? actor.id,
        },
      });
      const g = await prisma.assignmentSubmissionGrade.create({
        data: {
          ...scope,
          submissionHistoryId: hist.id,
          submissionId: sub.id,
          assignmentId: a.id,
          studentId: aarav.id,
          status: 'PUBLISHED',
          marksAwarded: 16,
          feedback: 'Good work — check question 7.',
          version: 2,
          gradedByUserId: ravi.userId ?? actor.id,
          publishedAt: new Date(),
        },
      });
      await prisma.assignmentSubmissionGradeHistory.createMany({
        data: [
          {
            ...scope,
            gradeId: g.id,
            version: 1,
            status: 'DRAFT',
            marksAwarded: 16,
            feedback: g.feedback,
            changedByUserId: g.gradedByUserId,
          },
          {
            ...scope,
            gradeId: g.id,
            version: 2,
            status: 'PUBLISHED',
            marksAwarded: 16,
            feedback: g.feedback,
            changedByUserId: g.gradedByUserId,
          },
        ],
      });
      graded = 1;
    }
    process.stdout.write(
      `  assessment ${key}: grade scale + ${String(created)} exam(s), ${String(graded)} graded assignment\n`,
    );
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo tenants in production');
  }
  // Application context: validates env and syncs the RBAC registry into the database first.
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PlatformPrismaService);

  try {
    for (const demo of DEMO_TENANTS) {
      const tenant = await prisma.tenant.upsert({
        where: { key: demo.key },
        create: {
          key: demo.key,
          slug: demo.slug,
          displayName: demo.displayName,
          status: demo.status,
          firstActivatedAt: demo.status === 'ACTIVE' ? new Date() : null,
        },
        update: { displayName: demo.displayName },
      });

      const existingDomain = await prisma.tenantDomain.findUnique({
        where: { domain: demo.domain },
      });
      if (existingDomain && existingDomain.tenantId !== tenant.id) {
        throw new Error(`Domain ${demo.domain} belongs to another tenant; not overwriting`);
      }
      if (!existingDomain) {
        await prisma.tenantDomain.create({
          data: { tenantId: tenant.id, domain: demo.domain, type: 'ADMIN', isPrimary: true },
        });
      }

      const branding = {
        schoolName: demo.displayName,
        shortName: demo.displayName.replace('Acadlyx Demo ', ''),
        primaryColor: demo.primaryColor,
        accentColor: demo.accentColor,
        supportEmail: `support@${demo.slug}.example.com`,
        footerText: `${demo.displayName} · Powered by Acadlyx`,
      };
      await prisma.tenantBranding.upsert({
        where: { tenantId: tenant.id },
        create: { tenantId: tenant.id, ...branding },
        update: branding,
      });

      for (const featureKey of demo.features) {
        await prisma.tenantFeature.upsert({
          where: { tenantId_featureKey: { tenantId: tenant.id, featureKey } },
          create: { tenantId: tenant.id, featureKey, enabled: true },
          update: { enabled: true },
        });
      }

      await prisma.tenantConfiguration.upsert({
        where: { tenantId_key: { tenantId: tenant.id, key: 'general.timezone' } },
        create: { tenantId: tenant.id, key: 'general.timezone', value: demo.timezone },
        update: { value: demo.timezone },
      });

      process.stdout.write(`seeded ${demo.key} (${tenant.status}) → http://${demo.domain}:4002\n`);
    }
    await seedIdentities(prisma, app.get(PasswordHasher));
    await seedAcademic(prisma, Object.fromEntries(DEMO_TENANTS.map((d) => [d.key, d.timezone])));
    await seedPeople(prisma);
    await seedOperations(prisma);
    await seedAssessment(prisma);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
