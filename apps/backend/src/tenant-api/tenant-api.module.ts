import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { TenantAuthService } from '../auth/tenant/tenant-auth.service.js';
import { RequestContextMiddleware } from '../common/request-context.middleware.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { TenantResolutionMiddleware } from '../tenancy/tenant-resolution.middleware.js';
import { TenantAuthController } from './tenant-auth.controller.js';
import { TenantBootstrapController } from './tenant-bootstrap.controller.js';
import { TenantWorkspaceController } from './tenant-workspace.controller.js';

/** Every controller of this module is tenant-scoped. Register new tenant controllers here. */
const TENANT_CONTROLLERS = [
  TenantBootstrapController,
  TenantAuthController,
  TenantWorkspaceController,
];

/**
 * Tenant-scoped API surface (/api/v1/tenant/..., /api/v1/auth/...). Tenant resolution runs for
 * all of its controllers; each is @TenantScoped() so AccessGuard enforces resolution + lifecycle
 * before any authentication. Code here must not import PlatformPrismaService (ESLint-enforced).
 */
@Module({
  imports: [TenancyModule],
  controllers: TENANT_CONTROLLERS,
  providers: [TenantAuthService],
})
export class TenantApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware, TenantResolutionMiddleware)
      .forRoutes(...TENANT_CONTROLLERS);
  }
}
