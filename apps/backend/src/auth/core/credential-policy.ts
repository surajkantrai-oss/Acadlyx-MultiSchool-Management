import { weakCredential } from './auth-errors.js';

/**
 * Approved Phase 3 credential and lockout policy.
 *   PIN (parents/students): exactly 6 digits, no trivial PINs; 5 failures → 15 min lock.
 *   Password (tenant): 8–128 chars; 10 failures → 15 min lock.
 *   Password (platform): 12–128 chars; 5 failures → 30 min lock.
 *   3rd lockout within 24 h → 24 h lock. Never permanent. Success resets the failure counter.
 */
export const LOCKOUT = {
  PIN: { maxFailures: 5, lockMinutes: 15 },
  PASSWORD: { maxFailures: 10, lockMinutes: 15 },
  PLATFORM: { maxFailures: 5, lockMinutes: 30 },
  escalation: { lockouts: 3, windowHours: 24, lockHours: 24 },
} as const;

export type LockoutPolicyKey = keyof Omit<typeof LOCKOUT, 'escalation'>;

export interface LockoutState {
  failedLoginCount: number;
  lockoutCount: number;
  lockoutWindowStartedAt: Date | null;
  lockedUntil: Date | null;
}

export function isLocked(state: Pick<LockoutState, 'lockedUntil'>, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

/** New counters after a failed attempt; `locked` tells the caller to audit ACCOUNT_LOCKED. */
export function afterFailure(
  state: LockoutState,
  policyKey: LockoutPolicyKey,
  now: Date,
): LockoutState & { locked: boolean } {
  const policy = LOCKOUT[policyKey];
  const failures = state.failedLoginCount + 1;
  if (failures < policy.maxFailures) {
    return { ...state, failedLoginCount: failures, locked: false };
  }
  const windowMs = LOCKOUT.escalation.windowHours * 3_600_000;
  const inWindow =
    state.lockoutWindowStartedAt !== null &&
    now.getTime() - state.lockoutWindowStartedAt.getTime() < windowMs;
  const lockoutCount = inWindow ? state.lockoutCount + 1 : 1;
  const minutes =
    lockoutCount >= LOCKOUT.escalation.lockouts
      ? LOCKOUT.escalation.lockHours * 60
      : policy.lockMinutes;
  return {
    failedLoginCount: 0,
    lockoutCount,
    lockoutWindowStartedAt: inWindow ? state.lockoutWindowStartedAt : now,
    lockedUntil: new Date(now.getTime() + minutes * 60_000),
    locked: true,
  };
}

const SEQUENTIAL = '0123456789012345';
const SEQUENTIAL_DESC = '5432109876543210';

export function validatePin(pin: string): void {
  if (!/^\d{6}$/.test(pin)) throw weakCredential('PIN must be exactly 6 digits');
  if (/^(\d)\1{5}$/.test(pin)) throw weakCredential('PIN must not repeat one digit');
  if (SEQUENTIAL.includes(pin) || SEQUENTIAL_DESC.includes(pin)) {
    throw weakCredential('PIN must not be a sequence like 123456');
  }
}

export function validatePassword(password: string, minLength: number): void {
  if (password.length < minLength || password.length > 128) {
    throw weakCredential(`Password must be ${String(minLength)}–128 characters`);
  }
  if (password.trim().length !== password.length) {
    throw weakCredential('Password must not start or end with spaces');
  }
}

export const TENANT_PASSWORD_MIN = 8;
export const PLATFORM_PASSWORD_MIN = 12;
