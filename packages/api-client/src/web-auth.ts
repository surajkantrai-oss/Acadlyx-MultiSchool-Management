/**
 * Framework-agnostic helpers for the web BFF pattern (Platform Admin / School Admin).
 *
 * Browsers never see access or refresh tokens: the Next.js server keeps them in HttpOnly cookies
 * and calls the API with a bearer token. These helpers define the shared cookie policy and CSRF
 * check so both apps behave identically.
 */

export const AUTH_COOKIES = {
  access: 'acx_at',
  refresh: 'acx_rt',
  mfa: 'acx_mfa',
  device: 'acx_did',
} as const;

/** `__Host-` prefix (Secure, Path=/, no Domain) whenever cookies are Secure (production). */
export function cookieName(name: string, secure: boolean): string {
  return secure ? `__Host-${name}` : name;
}

export interface CookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax' | 'strict';
  path: '/';
  maxAge: number;
}

export function authCookieOptions(
  secure: boolean,
  maxAgeSeconds: number,
  sameSite: 'lax' | 'strict' = 'lax',
): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    maxAge: Math.max(0, Math.floor(maxAgeSeconds)),
  };
}

/** Custom header every BFF mutation must carry (cannot be set cross-site without CORS). */
export const CSRF_HEADER = 'x-acadlyx-csrf';

/**
 * CSRF defence for cookie-authenticated BFF mutations: the Origin (or Referer) must be exactly
 * this app's origin AND the custom header must be present. SameSite=Lax cookies are the third
 * layer — not relied upon alone.
 */
export function isTrustedMutation(input: {
  method: string;
  origin: string | null;
  referer: string | null;
  host: string | null;
  protocol: 'http' | 'https';
  csrfHeader: string | null;
}): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(input.method.toUpperCase())) return true;
  if (!input.host || input.csrfHeader !== '1') return false;
  const expected = `${input.protocol}://${input.host}`;
  if (input.origin) return input.origin === expected;
  if (input.referer) {
    try {
      return new URL(input.referer).origin === expected;
    } catch {
      return false;
    }
  }
  return false;
}

/** Reads `exp` (seconds) from a JWT WITHOUT verifying it — only to decide when to refresh. */
export function jwtExpiresAt(token: string | undefined): number | null {
  if (!token) return null;
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: unknown;
    };
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Short, generic device label from a User-Agent (no fingerprinting). */
export function webDeviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Mac OS X/.test(ua)
    ? 'macOS'
    : /Windows/.test(ua)
      ? 'Windows'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'unknown OS';
  return `${browser} on ${os}`;
}
