import {
  PERMISSION_REGISTRY,
  type PermissionKey,
  isPermissionKey,
  ROLE_REGISTRY,
} from '@acadlyx/permissions';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { PlatformPrismaService } from '../../database/platform-prisma.service.js';
import { AuthCacheService } from './auth-cache.service.js';
import { AuthStore } from './auth-store.service.js';

export interface Grants {
  roles: string[];
  permissions: PermissionKey[];
}

/**
 * RBAC resolution. Authorisation checks PERMISSIONS aggregated from the user's roles
 * (User → UserRole → Role → RolePermission → Permission), resolved server-side per request —
 * never embedded in tokens. Results are cached ≤30 s and invalidated explicitly whenever roles,
 * the catalogue or account status change.
 */
@Injectable()
export class RbacService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RbacService.name);

  constructor(
    private readonly platform: PlatformPrismaService,
    private readonly store: AuthStore,
    private readonly cache: AuthCacheService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.syncRegistry();
  }

  /**
   * Makes the database catalogue match the code registry (idempotent): upserts system roles and
   * permissions and replaces system role→permission links. Runs at startup and from the seed/CLI.
   */
  async syncRegistry(): Promise<void> {
    await this.platform.$transaction(async (db) => {
      // Serialise concurrent syncs (several instances booting at once): without this, two
      // delete-then-insert passes can interleave and collide on role_permissions' primary key.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('acadlyx.rbac_registry_sync'))`;
      for (const p of PERMISSION_REGISTRY) {
        await db.permission.upsert({
          where: { key: p.key },
          create: { key: p.key, scope: p.scope, description: p.description },
          update: { description: p.description },
        });
      }
      for (const r of ROLE_REGISTRY) {
        const role = await db.role.upsert({
          where: { key: r.key },
          create: { key: r.key, name: r.name, scope: r.scope, isSystem: true },
          update: { name: r.name },
        });
        if (role.scope !== r.scope) {
          throw new Error(`Role ${r.key} scope differs between registry and database`);
        }
        const permissions = await db.permission.findMany({
          where: { key: { in: [...r.permissions] } },
        });
        await db.rolePermission.deleteMany({ where: { roleId: role.id } });
        await db.rolePermission.createMany({
          data: permissions.map((p) => ({
            roleId: role.id,
            permissionId: p.id,
            scope: role.scope,
          })),
        });
      }
      const unknown = await db.role.findMany({
        where: { isSystem: true, key: { notIn: ROLE_REGISTRY.map((r) => r.key) } },
        select: { key: true },
      });
      if (unknown.length > 0) {
        this.logger.warn(`System roles not in registry: ${unknown.map((u) => u.key).join(', ')}`);
      }
    });
    await this.cache.deleteAllGrants();
  }

  async resolve(scope: 'TENANT' | 'PLATFORM', ownerId: string): Promise<Grants> {
    const cached = await this.cache.getGrants(scope, ownerId);
    if (cached) {
      return { roles: cached.roles, permissions: cached.permissions.filter(isPermissionKey) };
    }
    const grants = await this.store.run(scope, async (db) => {
      const rows =
        scope === 'TENANT'
          ? await db.userRole.findMany({
              where: { userId: ownerId },
              select: {
                role: {
                  select: {
                    key: true,
                    permissions: { select: { permission: { select: { key: true } } } },
                  },
                },
              },
            })
          : await db.platformUserRole.findMany({
              where: { platformUserId: ownerId },
              select: {
                role: {
                  select: {
                    key: true,
                    permissions: { select: { permission: { select: { key: true } } } },
                  },
                },
              },
            });
      const roles = rows.map((r) => r.role.key).sort();
      const permissions = new Set<PermissionKey>();
      for (const row of rows) {
        for (const link of row.role.permissions) {
          if (isPermissionKey(link.permission.key)) permissions.add(link.permission.key);
        }
      }
      return { roles, permissions: [...permissions].sort() };
    });
    await this.cache.setGrants(scope, ownerId, grants);
    return grants;
  }

  invalidate(scope: 'TENANT' | 'PLATFORM', ownerId: string): Promise<void> {
    return this.cache.deleteGrants(scope, ownerId);
  }
}
