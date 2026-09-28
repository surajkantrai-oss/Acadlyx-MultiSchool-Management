import { BullModule } from '@nestjs/bullmq';
import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { TenantAuthService } from '../auth/tenant/tenant-auth.service.js';
import { RequestContextMiddleware } from '../common/request-context.middleware.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { TenantResolutionMiddleware } from '../tenancy/tenant-resolution.middleware.js';
import { ACADEMIC_CONTROLLERS } from './academic/academic.controllers.js';
import { ACADEMIC_PROVIDERS } from './academic/academic.providers.js';
import { IMPORT_QUEUE } from './imports/imports.service.js';
import { PEOPLE_CONTROLLERS } from './people/people.controllers.js';
import { PEOPLE_PROVIDERS } from './people/people.providers.js';
import {
  OPERATIONS_CONTROLLERS,
  OPERATIONS_PROVIDERS,
} from './operations/operations.controllers.js';
import { WORKSPACE_CONTROLLERS } from './workspace/workspace.controllers.js';
import { WorkspaceService } from './workspace/workspace.service.js';
import { TenantAuthController } from './tenant-auth.controller.js';
import { TenantBootstrapController } from './tenant-bootstrap.controller.js';
import { TenantWorkspaceController } from './tenant-workspace.controller.js';

/** Every controller of this module is tenant-scoped. Register new tenant controllers here. */
const TENANT_CONTROLLERS = [
  TenantBootstrapController,
  TenantAuthController,
  TenantWorkspaceController,
  ...ACADEMIC_CONTROLLERS,
  ...PEOPLE_CONTROLLERS,
  ...WORKSPACE_CONTROLLERS,
  ...OPERATIONS_CONTROLLERS,
];

/**
 * Tenant-scoped API surface (/api/v1/tenant/..., /api/v1/auth/...). Tenant resolution runs for
 * all of its controllers; each is @TenantScoped() so AccessGuard enforces resolution + lifecycle
 * before any authentication. Code here must not import PlatformPrismaService (ESLint-enforced).
 */
@Module({
  imports: [TenancyModule, BullModule.registerQueue({ name: IMPORT_QUEUE })],
  controllers: TENANT_CONTROLLERS,
  providers: [
    TenantAuthService,
    ...ACADEMIC_PROVIDERS,
    ...PEOPLE_PROVIDERS,
    WorkspaceService,
    ...OPERATIONS_PROVIDERS,
  ],
})
export class TenantApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware, TenantResolutionMiddleware)
      .forRoutes(...TENANT_CONTROLLERS);
  }
}
