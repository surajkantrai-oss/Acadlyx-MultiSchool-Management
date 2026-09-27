/**
 * Development seed: three demo tenants with distinct branding, domains and features, plus
 * development identities for Phase 3 (school A/B principal, teacher, parent, student and a
 * multi-role teacher+parent), plus a fictional Phase 4 academic structure per school (branches,
 * academic years, grades, sections, subjects and grade–subject mappings).
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
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
