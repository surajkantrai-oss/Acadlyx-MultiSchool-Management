/**
 * Authentication API contracts (Phase 3). Tokens appear only in auth responses; web clients keep
 * them server-side in HttpOnly cookies (BFF), mobile keeps the refresh token in secure storage.
 */

export type AuthScopeName = 'TENANT' | 'PLATFORM';
export type CredentialKind = 'PASSWORD' | 'PIN';
export type ClientPlatform = 'IOS' | 'ANDROID' | 'WEB';

/** App-generated installation identifier (random, stored in secure storage). */
export interface DeviceDescriptor {
  installationId: string;
  platform: ClientPlatform;
  label?: string;
}

export interface AuthTokens {
  status: 'AUTHENTICATED';
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  sessionId: string;
  /** When the session ends at the latest (absolute lifetime). */
  sessionExpiresAt: string;
}

export interface MfaStep {
  status: 'MFA_REQUIRED' | 'MFA_ENROLLMENT_REQUIRED';
  mfaToken: string;
  mfaTokenExpiresAt: string;
}

export type AuthResult = AuthTokens | MfaStep;

export interface MfaEnrollmentStart {
  /** Base32 secret for manual entry; shown once. */
  secret: string;
  otpauthUri: string;
}

export interface MfaEnrollmentComplete {
  /** Shown exactly once. */
  recoveryCodes: string[];
  /** Present when enrollment completed a pending login. */
  auth: AuthTokens | null;
}

export interface OtpGrant {
  grantToken: string;
  grantExpiresAt: string;
}

export interface MeResponse {
  id: string;
  scope: AuthScopeName;
  displayName: string;
  tenant: { key: string; displayName: string } | null;
  roles: string[];
  permissions: string[];
  identifiers: {
    email: string | null;
    phone: string | null;
    loginId: string | null;
    emailVerified: boolean;
    phoneVerified: boolean;
  };
  credentialType: CredentialKind | null;
  pinAllowed: boolean;
  mfa: { required: boolean; enrolled: boolean; recoveryCodesRemaining: number };
  sessionId: string;
}

export interface SessionInfo {
  id: string;
  current: boolean;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  device: { id: string; platform: ClientPlatform; label: string | null } | null;
}

export interface DeviceInfo {
  id: string;
  platform: ClientPlatform;
  label: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  activeSessions: number;
}

export type AccountStatusName = 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';

/** Platform Admin view of a school identity (no secrets, no MFA material). */
export interface TenantUserSummary {
  id: string;
  displayName: string;
  status: AccountStatusName;
  email: string | null;
  phone: string | null;
  loginId: string | null;
  loginIdKind: 'STUDENT_ID' | 'EMPLOYEE_ID' | null;
  roles: string[];
  mfaEnrolled: boolean;
  locked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface IssuedActivationCode {
  /** One-time activation code for accounts without an OTP channel (students). Shown once. */
  activationCode: string;
  expiresAt: string;
}
