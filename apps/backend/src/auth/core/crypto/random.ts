import { createHash, randomBytes, randomInt } from 'node:crypto';

/** 256-bit opaque bearer secret (refresh tokens). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex; used for high-entropy tokens and installation ids (not for passwords). */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** 6-digit numeric OTP from a CSPRNG. */
export function numericCode(digits = 6): string {
  return String(randomInt(0, 10 ** digits)).padStart(digits, '0');
}

/** Unambiguous alphabet (no 0/O/1/I/L) for human-typed codes. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function humanCode(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET.charAt(randomInt(0, ALPHABET.length));
  return out;
}

/** MFA recovery code: 10 characters displayed as XXXXX-XXXXX. */
export function recoveryCode(): string {
  const raw = humanCode(10);
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export function normalizeHumanCode(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}
