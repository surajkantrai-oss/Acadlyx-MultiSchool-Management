import type {
  AuthResult,
  AuthTokens,
  DeviceInfo,
  MeResponse,
  MfaEnrollmentComplete,
  MfaEnrollmentStart,
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
import { currentAuth } from '../../auth/core/access.guard.js';
import { Authenticated, Public } from '../../auth/core/access.decorators.js';
import {
  ChangeCredentialDto,
  MfaEnrollConfirmDto,
  MfaTokenDto,
  MfaVerifyDto,
  PlatformLoginDto,
  RefreshDto,
  TotpCodeDto,
} from '../../auth/core/auth.dto.js';
import { AuthFlowsService } from '../../auth/core/auth-flows.service.js';
import {
  LoginThrottle,
  MfaThrottle,
  RefreshThrottle,
  SensitiveThrottle,
} from '../../auth/core/throttles.js';
import { PlatformAuthService, type PlatformOwner } from './platform-auth.service.js';

const ISSUER = 'Acadlyx Platform';

function me(): { owner: PlatformOwner; sessionId: string; roles: string[]; permissions: string[] } {
  const auth = currentAuth();
  if (auth.scope !== 'PLATFORM') throw new NotFoundException();
  return {
    owner: { scope: 'PLATFORM', platformUserId: auth.platformUserId },
    sessionId: auth.sessionId,
    roles: auth.roles,
    permissions: auth.permissions,
  };
}

/**
 * Platform Admin authentication — /api/v1/platform/auth/*. Never tenant-resolved; tokens carry
 * the platform audience and are rejected on every tenant route (and vice versa).
 */
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(
    private readonly auth: PlatformAuthService,
    private readonly flows: AuthFlowsService,
  ) {}

  @Public()
  @LoginThrottle()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: PlatformLoginDto): Promise<AuthResult> {
    return this.auth.login(dto.email, dto.password, dto.device);
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
    return this.flows.completeMfa('PLATFORM', dto.mfaToken, dto);
  }

  @Public()
  @MfaThrottle()
  @Post('mfa/enroll/start')
  @HttpCode(HttpStatus.OK)
  async startEnrollment(@Body() dto: MfaTokenDto): Promise<MfaEnrollmentStart> {
    const { owner } = await this.flows.pendingFromMfaToken('PLATFORM', dto.mfaToken);
    return this.flows.startEnrollment(owner, 'Platform Admin', ISSUER);
  }

  @Public()
  @MfaThrottle()
  @Post('mfa/enroll/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmEnrollment(@Body() dto: MfaEnrollConfirmDto): Promise<MfaEnrollmentComplete> {
    const { owner, session } = await this.flows.pendingFromMfaToken('PLATFORM', dto.mfaToken);
    return this.flows.confirmEnrollment(owner, dto.code, session);
  }

  @Authenticated('PLATFORM')
  @Get('me')
  getMe(): Promise<MeResponse> {
    const { owner, sessionId, roles, permissions } = me();
    return this.auth.me(owner, sessionId, roles, permissions);
  }

  @Authenticated('PLATFORM')
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(): Promise<void> {
    const { owner, sessionId } = me();
    return this.flows.logout(owner, sessionId, false);
  }

  @Authenticated('PLATFORM')
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  logoutAll(): Promise<void> {
    const { owner, sessionId } = me();
    return this.flows.logout(owner, sessionId, true);
  }

  @Authenticated('PLATFORM')
  @Get('sessions')
  sessions(): Promise<SessionInfo[]> {
    const { owner, sessionId } = me();
    return this.flows.listSessions(owner, sessionId);
  }

  @Authenticated('PLATFORM')
  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @Param('sessionId', new ParseUUIDPipe({ version: '7' })) target: string,
  ): Promise<void> {
    if (!(await this.flows.revokeOwnSession(me().owner, target))) throw new NotFoundException();
  }

  @Authenticated('PLATFORM')
  @Get('devices')
  devices(): Promise<DeviceInfo[]> {
    return this.flows.listDevices(me().owner);
  }

  @Authenticated('PLATFORM')
  @Delete('devices/:deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeDevice(
    @Param('deviceId', new ParseUUIDPipe({ version: '7' })) deviceId: string,
  ): Promise<void> {
    if (!(await this.flows.revokeOwnDevice(me().owner, deviceId))) throw new NotFoundException();
  }

  @Authenticated('PLATFORM')
  @SensitiveThrottle()
  @Post('credentials/change')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(@Body() dto: ChangeCredentialDto): Promise<void> {
    const { owner, sessionId } = me();
    return this.flows.changeCredential(
      owner,
      sessionId,
      dto.currentSecret,
      dto.credentialType,
      dto.newSecret,
    );
  }

  @Authenticated('PLATFORM')
  @MfaThrottle()
  @Post('mfa/recovery-codes/regenerate')
  @HttpCode(HttpStatus.OK)
  async regenerateRecoveryCodes(@Body() dto: TotpCodeDto): Promise<{ recoveryCodes: string[] }> {
    return { recoveryCodes: await this.flows.regenerateRecoveryCodes(me().owner, dto.code) };
  }
}
