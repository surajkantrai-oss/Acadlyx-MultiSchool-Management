import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppConfigService } from '../config/app-config.service.js';
import { type Prisma, PrismaClient } from '../generated/prisma/client.js';
import { TenantContext } from './tenant-context.js';
import { scopeQueryArgs } from './tenant-scope.js';

function createScopedClient(connectionString: string) {
  const base = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const scoped = base.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          const tenantId = TenantContext.getTenantId();
          return query(scopeQueryArgs(model, operation, args, tenantId));
        },
      },
    },
  });
  return { base, scoped };
}

type ScopedClient = ReturnType<typeof createScopedClient>['scoped'];
export type TenantTransaction = Parameters<Parameters<ScopedClient['$transaction']>[0]>[0];

/**
 * TENANT-scoped database access (role `acadlyx_app`, RLS enforced, no BYPASSRLS).
 *
 * `run(fn)` executes `fn` inside an interactive transaction pinned to one pooled connection,
 * after `set_config('app.tenant_id', <current tenant>, true)`. The setting is
 * transaction-local, so it is discarded at COMMIT/ROLLBACK and can never leak to the next
 * request that borrows the connection. The tenant id always comes from TenantContext
 * (server-resolved) — callers cannot pass one.
 *
 * Layers applied to every query: TenantContext (ACTIVE tenant required) → scopeQueryArgs
 * (tenant injected into where/data) → PostgreSQL RLS (tenant_isolation policies).
 */
@Injectable()
export class TenantPrismaService implements OnModuleDestroy {
  private readonly logger = new Logger(TenantPrismaService.name);
  private readonly client: ReturnType<typeof createScopedClient>;

  constructor(config: AppConfigService) {
    this.client = createScopedClient(config.get('DATABASE_APP_URL'));
  }

  async run<T>(fn: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    const tenantId = TenantContext.getTenantId();
    return this.client.scoped.$transaction(async (tx) => {
      // Parameterised: the tenant id is bound as $1, never interpolated into SQL text.
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }

  /**
   * Same as run(), typed as a plain Prisma transaction client so scope-agnostic security code
   * can share one implementation with the platform path. The tenant-scoping extension and RLS
   * still apply at runtime — the cast only widens the static type, not the behaviour.
   */
  runWith<T>(fn: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.run((tx) => fn(tx as unknown as Prisma.TransactionClient));
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.base.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.base.$disconnect();
    this.logger.log('PostgreSQL (tenant) connection closed');
  }
}
