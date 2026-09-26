import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { TenantResolutionMiddleware } from '../tenancy/tenant-resolution.middleware.js';
import { TenantBootstrapController } from './tenant-bootstrap.controller.js';

/** Every controller of this module is tenant-scoped. Register new tenant controllers here. */
const TENANT_CONTROLLERS = [TenantBootstrapController];

/**
 * Tenant-scoped API surface (/api/v1/tenant/...). Tenant resolution middleware runs for all of
 * its controllers; each controller is also decorated with @TenantScoped() (TenantGuard).
 * Code in src/tenant-api must not import PlatformPrismaService (enforced by ESLint).
 */
@Module({
  imports: [TenancyModule],
  controllers: TENANT_CONTROLLERS,
})
export class TenantApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantResolutionMiddleware).forRoutes(...TENANT_CONTROLLERS);
  }
}
