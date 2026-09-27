import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';

/** Stable auth error codes (ApiErrorResponse.code). Public messages never enable enumeration. */
export const AUTH_ERROR_CODES = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS',
  INVALID_CODE: 'INVALID_CODE',
  INVALID_MFA: 'INVALID_MFA',
  MFA_REQUIRED_FOR_ROLE: 'MFA_REQUIRED_FOR_ROLE',
  MFA_ALREADY_ENROLLED: 'MFA_ALREADY_ENROLLED',
  MFA_NOT_ENROLLED: 'MFA_NOT_ENROLLED',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  TENANT_MISMATCH: 'TENANT_MISMATCH',
  SCOPE_MISMATCH: 'SCOPE_MISMATCH',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  WEAK_CREDENTIAL: 'WEAK_CREDENTIAL',
  CREDENTIAL_TYPE_NOT_ALLOWED: 'CREDENTIAL_TYPE_NOT_ALLOWED',
  OTP_DELIVERY_UNAVAILABLE: 'OTP_DELIVERY_UNAVAILABLE',
} as const;

const C = AUTH_ERROR_CODES;

export const authRequired = () =>
  new UnauthorizedException({ code: C.AUTH_REQUIRED, message: 'Authentication required' });
export const invalidToken = () =>
  new UnauthorizedException({ code: C.INVALID_TOKEN, message: 'Invalid access token' });
export const tokenExpired = () =>
  new UnauthorizedException({ code: C.TOKEN_EXPIRED, message: 'Access token expired' });
export const sessionRevoked = () =>
  new UnauthorizedException({ code: C.SESSION_REVOKED, message: 'Session is no longer valid' });
/** One message for wrong identifier, wrong secret, locked or inactive account (no enumeration). */
export const invalidCredentials = () =>
  new UnauthorizedException({
    code: C.INVALID_CREDENTIALS,
    message:
      'The login details are incorrect, or the account is temporarily locked. Please try again later.',
  });
export const tooManyAttempts = () =>
  new HttpException(
    { code: C.TOO_MANY_ATTEMPTS, message: 'Too many attempts. Please try again later.' },
    HttpStatus.TOO_MANY_REQUESTS,
  );
export const invalidCode = () =>
  new BadRequestException({ code: C.INVALID_CODE, message: 'The code is invalid or has expired' });
export const invalidMfa = () =>
  new UnauthorizedException({ code: C.INVALID_MFA, message: 'The verification code is invalid' });
export const invalidRefresh = () =>
  new UnauthorizedException({
    code: C.INVALID_REFRESH_TOKEN,
    message: 'Session is no longer valid',
  });
export const tenantMismatch = () =>
  new ForbiddenException({
    code: C.TENANT_MISMATCH,
    message: 'Credentials do not belong to this school',
  });
export const scopeMismatch = () =>
  new ForbiddenException({
    code: C.SCOPE_MISMATCH,
    message: 'Credentials are not valid for this area',
  });
export const permissionDenied = () =>
  new ForbiddenException({
    code: C.PERMISSION_DENIED,
    message: 'You do not have permission to do this',
  });
export const weakCredential = (message: string) =>
  new BadRequestException({ code: C.WEAK_CREDENTIAL, message });
export const credentialTypeNotAllowed = () =>
  new BadRequestException({
    code: C.CREDENTIAL_TYPE_NOT_ALLOWED,
    message: 'A PIN is not allowed for this account; use a password',
  });
export const mfaRequiredForRole = () =>
  new ConflictException({
    code: C.MFA_REQUIRED_FOR_ROLE,
    message: 'Multi-factor authentication is mandatory for this account',
  });
export const mfaAlreadyEnrolled = () =>
  new ConflictException({
    code: C.MFA_ALREADY_ENROLLED,
    message: 'An authenticator is already enrolled',
  });
export const mfaNotEnrolled = () =>
  new ConflictException({ code: C.MFA_NOT_ENROLLED, message: 'No authenticator is enrolled' });
