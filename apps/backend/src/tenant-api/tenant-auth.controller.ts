import type {
  AuthResult,
  AuthTokens,
  DeviceInfo,
  MeResponse,
  MfaEnrollmentComplete,
  MfaEnrollmentStart,
  OtpGrant,
  SessionInfo,
} from '@acadlyx/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { currentAuth } from '../auth/core/access.guard.js';
import { Authenticated, Public, TenantScoped } from '../auth/core/access.decorators.js';
import {
  ChangeCredentialDto,
  IdentifierChangeStartDto,
  IdentifierChangeVerifyDto,
  LoginDto,
  MfaEnrollConfirmDto,
  MfaTokenDto,
  MfaVerifyDto,
  OtpStartDto,
  OtpVerifyDto,
  RefreshDto,
  RemoveMfaDto,
  SetCredentialDto,
  TotpCodeDto,
} from '../auth/core/auth.dto.js';
import { AuthFlowsService } from '../auth/core/auth-flows.service.js';
import type { Owner } from '../auth/core/owner.js';
import {
  LoginThrottle,
  MfaThrottle,
  OtpStartThrottle,
  OtpVerifyThrottle,
  RefreshThrottle,
  SensitiveThrottle,
} from '../auth/core/throttles.js';
import { TenantAuthService } from '../auth/tenant/tenant-auth.service.js';
import { TenantContext } from '../tenancy/tenant-context.js';

type TenantOwner = Extract<Owner, { scope: 'TENANT' }>;

function me(): { owner: TenantOwner; sessionId: string; roles: string[]; permissions: string[] } {
  const auth = currentAuth();
  if (auth.scope !== 'TENANT') throw new NotFoundException();
  return {
    owner: { scope: 'TENANT', tenantId: auth.tenantId, userId: auth.userId },
    sessionId: auth.sessionId,
    roles: auth.roles,
    permissions: auth.permissions,
  };
}

/**
 * Tenant (school) authentication — /api/v1/auth/*. The school is resolved from Host / tenant
 * key first (404/400/403 as in Phase 2); credentials are only ever checked inside that school.
 */
@TenantScoped()
@Controller('auth')
export class TenantAuthController {
  constructor(
    private readonly auth: TenantAuthService,
    private readonly flows: AuthFlowsService,
  ) {}

  @Public()
  @LoginThrottle()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AuthResult> {
    return this.auth.login(dto.identifier, dto.secret, dto.device);
  }

  @Public()
  @RefreshThrottle()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @MfaThrottle()
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  verifyMfa(@Body() dto: MfaVerifyDto): Promise<AuthTokens> {
    return this.flows.completeMfa('TENANT', dto.mfaToken, dto, TenantContext.getTenantId());
  }

  /** Enrollment during a pending login (privileged roles must enroll before first access). */
  @Public()
  @MfaThrottle()
  @Post('mfa/enroll/start')
  @HttpCode(HttpStatus.OK)
  async startPendingEnrollment(@Body() dto: MfaTokenDto): Promise<MfaEnrollmentStart> {
    const { owner } = await this.flows.pendingFromMfaToken(
      'TENANT',
      dto.mfaToken,
      TenantContext.getTenantId(),
    );
    return this.flows.startEnrollment(
      owner,
      await this.accountLabel(),
      TenantContext.requireActiveTenant().key,
    );
  }

  @Public()
  @MfaThrottle()
  @Post('mfa/enroll/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmEnrollment(@Body() dto: MfaEnrollConfirmDto): Promise<MfaEnrollmentComplete> {
    const { owner, session } = await this.flows.pendingFromMfaToken(
      'TENANT',
      dto.mfaToken,
      TenantContext.getTenantId(),
    );
    return this.flows.confirmEnrollment(owner, dto.code, session);
  }

  @Public()
  @OtpStartThrottle()
  @Post('activation/start')
  @HttpCode(HttpStatus.ACCEPTED)
  async startActivation(@Body() dto: OtpStartDto): Promise<{ message: string }> {
    await this.auth.startOtpFlow('ACCOUNT_ACTIVATION', dto.identifier);
    return { message: 'If the account can be activated, a verification code has been sent.' };
  }

  /** Verifies an OTP, or a one-time activation code issued by the school (students). */
  @Public()
  @OtpVerifyThrottle()
  @Post('activation/verify')
  @HttpCode(HttpStatus.OK)
  verifyActivation(@Body() dto: OtpVerifyDto): Promise<OtpGrant> {
    return this.auth.verifyOtpFlow('ACCOUNT_ACTIVATION', dto.identifier, dto.code);
  }

  @Public()
  @SensitiveThrottle()
  @Post('activation/complete')
  @HttpCode(HttpStatus.OK)
  completeActivation(@Body() dto: SetCredentialDto): Promise<AuthResult> {
    return this.auth.completeActivation(dto.grantToken, dto.credentialType, dto.secret, dto.device);
  }

  @Public()
  @OtpStartThrottle()
  @Post('recovery/start')
  @HttpCode(HttpStatus.ACCEPTED)
  async startRecovery(@Body() dto: OtpStartDto): Promise<{ message: string }> {
    await this.auth.startOtpFlow('ACCOUNT_RECOVERY', dto.identifier);
    return { message: 'If the account can be recovered, a verification code has been sent.' };
  }

  @Public()
  @OtpVerifyThrottle()
  @Post('recovery/verify')
  @HttpCode(HttpStatus.OK)
  verifyRecovery(@Body() dto: OtpVerifyDto): Promise<OtpGrant> {
    return this.auth.verifyOtpFlow('ACCOUNT_RECOVERY', dto.identifier, dto.code);
  }

  @Public()
  @SensitiveThrottle()
  @Post('recovery/complete')
  @HttpCode(HttpStatus.NO_CONTENT)
  completeRecovery(@Body() dto: SetCredentialDto): Promise<void> {
    return this.auth.completeRecovery(dto.grantToken, dto.credentialType, dto.secret);
  }

  // ------------------------------------------------------------------ authenticated self

  @Authenticated('TENANT')
  @Get('me')
  getMe(): Promise<MeResponse> {
    const { owner, sessionId, roles, permissions } = me();
    return this.auth.me(owner, sessionId, roles, permissions);
  }

  @Authenticated('TENANT')
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(): Promise<void> {
    const { owner, sessionId } = me();
    return this.flows.logout(owner, sessionId, false);
  }

  @Authenticated('TENANT')
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  logoutAll(): Promise<void> {
    const { owner, sessionId } = me();
    return this.flows.logout(owner, sessionId, true);
  }

  @Authenticated('TENANT')
  @Get('sessions')
  sessions(): Promise<SessionInfo[]> {
    const { owner, sessionId } = me();
    return this.flows.listSessions(owner, sessionId);
  }

  @Authenticated('TENANT')
  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @Param('sessionId', new ParseUUIDPipe({ version: '7' })) target: string,
  ): Promise<void> {
    if (!(await this.flows.revokeOwnSession(me().owner, target))) throw new NotFoundException();
  }

  @Authenticated('TENANT')
  @Get('devices')
  devices(): Promise<DeviceInfo[]> {
    return this.flows.listDevices(me().owner);
  }

  @Authenticated('TENANT')
  @Delete('devices/:deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeDevice(
    @Param('deviceId', new ParseUUIDPipe({ version: '7' })) deviceId: string,
  ): Promise<void> {
    if (!(await this.flows.revokeOwnDevice(me().owner, deviceId))) throw new NotFoundException();
  }

  @Authenticated('TENANT')
  @SensitiveThrottle()
  @Post('credentials/change')
  @HttpCode(HttpStatus.NO_CONTENT)
  changeCredential(@Body() dto: ChangeCredentialDto): Promise<void> {
    const { owner, sessionId } = me();
    return this.flows.changeCredential(
      owner,
      sessionId,
      dto.currentSecret,
      dto.credentialType,
      dto.newSecret,
    );
  }

  @Authenticated('TENANT')
  @OtpStartThrottle()
  @Post('identifiers/change/start')
  @HttpCode(HttpStatus.ACCEPTED)
  async startIdentifierChange(@Body() dto: IdentifierChangeStartDto): Promise<{ message: string }> {
    await this.auth.startIdentifierChange(me().owner, dto.kind, dto.value, dto.currentSecret);
    return { message: 'If the new value can be used, a verification code has been sent to it.' };
  }

  @Authenticated('TENANT')
  @OtpVerifyThrottle()
  @Post('identifiers/change/verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  verifyIdentifierChange(@Body() dto: IdentifierChangeVerifyDto): Promise<void> {
    const { owner, sessionId } = me();
    return this.auth.completeIdentifierChange(owner, sessionId, dto.kind, dto.code);
  }

  @Authenticated('TENANT')
  @MfaThrottle()
  @Post('mfa/totp/start')
  @HttpCode(HttpStatus.OK)
  async startTotp(): Promise<MfaEnrollmentStart> {
    return this.flows.startEnrollment(
      me().owner,
      await this.accountLabel(),
      TenantContext.requireActiveTenant().key,
    );
  }

  @Authenticated('TENANT')
  @MfaThrottle()
  @Post('mfa/totp/confirm')
  @HttpCode(HttpStatus.OK)
  confirmTotp(@Body() dto: TotpCodeDto): Promise<MfaEnrollmentComplete> {
    return this.flows.confirmEnrollment(me().owner, dto.code);
  }

  @Authenticated('TENANT')
  @SensitiveThrottle()
  @Post('mfa/totp/remove')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeTotp(@Body() dto: RemoveMfaDto): Promise<void> {
    const { owner, sessionId } = me();
    return this.flows.removeMfa(owner, sessionId, dto.currentSecret, dto.code);
  }

  @Authenticated('TENANT')
  @MfaThrottle()
  @Post('mfa/recovery-codes/regenerate')
  @HttpCode(HttpStatus.OK)
  async regenerateRecoveryCodes(@Body() dto: TotpCodeDto): Promise<{ recoveryCodes: string[] }> {
    return { recoveryCodes: await this.flows.regenerateRecoveryCodes(me().owner, dto.code) };
  }

  /** Authenticator label: school key only — no personal data in the otpauth URI. */
  private accountLabel(): Promise<string> {
    return Promise.resolve(`${TenantContext.requireActiveTenant().key} account`);
  }
}
