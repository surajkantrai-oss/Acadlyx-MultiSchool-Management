/**
 * Bootstraps a Platform Admin (the only way platform users are created in Phase 3).
 *
 *   PLATFORM_ADMIN_EMAIL=... PLATFORM_ADMIN_NAME="..." PLATFORM_ADMIN_PASSWORD=... \
 *     pnpm --filter @acadlyx/backend platform:create-admin
 *
 * Production-safe: no default credentials exist. The password is read from the environment only
 * for this one-off command (min 12 chars, never logged), the account refuses to be overwritten,
 * and TOTP MFA enrollment is forced at first sign-in before any platform access.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app/app.module.js';
import { PLATFORM_PASSWORD_MIN, validatePassword } from '../auth/core/credential-policy.js';
import { PasswordHasher } from '../auth/core/crypto/password-hasher.js';
import { normalizeEmail } from '../auth/core/identifiers.js';
import { RbacService } from '../auth/core/rbac.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { PlatformPrismaService } from '../database/platform-prisma.service.js';

async function main(): Promise<void> {
  const email = normalizeEmail(process.env.PLATFORM_ADMIN_EMAIL ?? '');
  const name = (process.env.PLATFORM_ADMIN_NAME ?? '').trim();
  const password = process.env.PLATFORM_ADMIN_PASSWORD ?? '';
  if (!email || !name) throw new Error('PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_NAME are required');
  validatePassword(password, PLATFORM_PASSWORD_MIN);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    await app.get(RbacService).syncRegistry();
    const prisma = app.get(PlatformPrismaService);
    if (await prisma.platformUser.findUnique({ where: { email } })) {
      throw new Error('A platform user with this email already exists; refusing to overwrite');
    }
    const hash = await app.get(PasswordHasher).hash(password);
    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'PLATFORM_ADMIN' } });
    const user = await prisma.platformUser.create({
      data: {
        email,
        displayName: name,
        status: 'ACTIVE',
        passwordHash: hash,
        credentialUpdatedAt: new Date(),
        roles: { create: { roleId: role.id, roleScope: 'PLATFORM' } },
      },
    });
    await app.get(AuditService).recordPlatform({
      action: 'PLATFORM_USER_CREATED',
      resourceType: 'platform_user',
      resourceId: user.id,
      actorLabel: 'system:cli',
      metadata: { role: 'PLATFORM_ADMIN' },
    });
    process.stdout.write(
      `Created Platform Admin ${email}. MFA enrollment is required at first sign-in.\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `create-platform-admin failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
