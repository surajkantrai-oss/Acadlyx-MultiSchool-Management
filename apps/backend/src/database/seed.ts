/**
 * Development seed: three demo tenants with distinct branding, domains and features.
 *
 *   pnpm db:seed
 *
 * Deterministic and idempotent (upserts by tenant key / domain). Refuses to run when
 * NODE_ENV=production. Never executed automatically. Uses the platform role (DATABASE_URL).
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type TenantStatus } from '../generated/prisma/client.js';

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

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo tenants in production');
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

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
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
