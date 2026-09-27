import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from '../../database/database.module.js';
import { TenancyModule } from '../../tenancy/tenancy.module.js';
import { AccessGuard } from './access.guard.js';
import { AuthCacheService } from './auth-cache.service.js';
import { AuthFlowsService } from './auth-flows.service.js';
import { AuthStore } from './auth-store.service.js';
import { KeysService } from './crypto/keys.service.js';
import { PasswordHasher } from './crypto/password-hasher.js';
import { TokenService } from './crypto/token.service.js';
import { IdentifierLimiterService } from './identifier-limiter.service.js';
import { MfaService } from './mfa.service.js';
import { OtpDeliveryService } from './otp/otp-delivery.js';
import { OtpService } from './otp/otp.service.js';
import { RbacService } from './rbac.service.js';
import { SessionsService } from './sessions.service.js';

const CORE = [
  KeysService,
  TokenService,
  PasswordHasher,
  AuthStore,
  AuthCacheService,
  SessionsService,
  RbacService,
  OtpService,
  OtpDeliveryService,
  MfaService,
  AuthFlowsService,
  IdentifierLimiterService,
];

/**
 * Scope-neutral authentication core + the global AccessGuard (every route must declare an
 * access policy). Scope-specific flows live in the tenant-api and platform modules.
 */
@Global()
@Module({
  imports: [DatabaseModule, TenancyModule],
  providers: [...CORE, { provide: APP_GUARD, useClass: AccessGuard }],
  exports: CORE,
})
export class AuthCoreModule {}
