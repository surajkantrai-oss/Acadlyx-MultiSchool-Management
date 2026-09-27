/**
 * Development seed: three demo tenants with distinct branding, domains and features, plus
 * development identities for Phase 3 (school A/B principal, teacher, parent, student and a
 * multi-role teacher+parent).
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
import type { PrismaClient, TenantStatus } from '../generated/prisma/client.js';
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
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
