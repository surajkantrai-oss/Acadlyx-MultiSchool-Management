import { Injectable } from '@nestjs/common';
import { errors, jwtVerify, SignJWT, decodeProtectedHeader } from 'jose';
import { AppConfigService } from '../../../config/app-config.service.js';
import { KeysService } from './keys.service.js';

/**
 * Distinct audiences keep token kinds and scopes from ever being confused:
 * a tenant access token is not a platform token, and an MFA/OTP grant is never an access token.
 */
export const AUDIENCES = {
  tenantAccess: 'acadlyx:tenant:access',
  platformAccess: 'acadlyx:platform:access',
  mfa: 'acadlyx:mfa',
  otpGrant: 'acadlyx:otp-grant',
} as const;
export type Audience = (typeof AUDIENCES)[keyof typeof AUDIENCES];

export const ACCESS_TOKEN_TTL_SECONDS = 10 * 60;
export const MFA_TOKEN_TTL_SECONDS = 5 * 60;
export const OTP_GRANT_TTL_SECONDS = 10 * 60;

/** Minimal claims only: no permissions, PII or credential state. */
export interface TokenClaims {
  sub: string;
  scope: 'TENANT' | 'PLATFORM';
  sid?: string;
  tid?: string;
  /** OTP grants: challenge id + purpose. */
  cid?: string;
  purpose?: string;
}

export type VerifyResult =
  | { ok: true; claims: TokenClaims; audience: Audience }
  | { ok: false; reason: 'invalid' | 'expired' | 'wrong-audience' };

@Injectable()
export class TokenService {
  private readonly issuer: string;

  constructor(
    private readonly keys: KeysService,
    config: AppConfigService,
  ) {
    this.issuer = config.get('AUTH_JWT_ISSUER');
  }

  async sign(
    audience: Audience,
    claims: TokenClaims,
    ttlSeconds: number,
  ): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const { sub, ...rest } = claims;
    const token = await new SignJWT({ ...rest })
      .setProtectedHeader({ alg: 'EdDSA', kid: this.keys.jwtActiveKid, typ: 'JWT' })
      .setSubject(sub)
      .setIssuer(this.issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.keys.jwtSigningKey());
    return { token, expiresAt };
  }

  /**
   * Verifies signature (by `kid`), issuer, expiry and that the audience is one of `accepted`.
   * `wrong-audience` = a genuine Acadlyx token of another kind/scope (→ 403, not 401).
   */
  async verify(token: string, accepted: readonly Audience[]): Promise<VerifyResult> {
    let kid: string | undefined;
    try {
      kid = decodeProtectedHeader(token).kid;
    } catch {
      return { ok: false, reason: 'invalid' };
    }
    const key = this.keys.jwtVerificationKey(kid);
    if (!key) return { ok: false, reason: 'invalid' };
    try {
      const { payload } = await jwtVerify(token, key, {
        issuer: this.issuer,
        algorithms: ['EdDSA'],
        requiredClaims: ['sub', 'exp', 'aud'],
      });
      const audience = typeof payload.aud === 'string' ? payload.aud : undefined;
      if (!audience || !(Object.values(AUDIENCES) as string[]).includes(audience)) {
        return { ok: false, reason: 'invalid' };
      }
      if (!(accepted as readonly string[]).includes(audience)) {
        return { ok: false, reason: 'wrong-audience' };
      }
      const scope = payload.scope;
      if ((scope !== 'TENANT' && scope !== 'PLATFORM') || typeof payload.sub !== 'string') {
        return { ok: false, reason: 'invalid' };
      }
      const claims: TokenClaims = { sub: payload.sub, scope };
      for (const field of ['sid', 'tid', 'cid', 'purpose'] as const) {
        const value = payload[field];
        if (typeof value === 'string') claims[field] = value;
      }
      return { ok: true, claims, audience: audience as Audience };
    } catch (error) {
      if (error instanceof errors.JWTExpired) return { ok: false, reason: 'expired' };
      return { ok: false, reason: 'invalid' };
    }
  }
}
