import { Throttle } from '@nestjs/throttler';

/**
 * Stricter per-IP limits for sensitive endpoints (Redis-backed, shared across instances).
 * Global default (Phase 1) remains RATE_LIMIT_MAX per RATE_LIMIT_TTL_MS for everything else.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const LoginThrottle = () => Throttle({ default: { limit: 10, ttl: MINUTE } });
export const MfaThrottle = () => Throttle({ default: { limit: 10, ttl: MINUTE } });
export const RefreshThrottle = () => Throttle({ default: { limit: 30, ttl: MINUTE } });
export const OtpStartThrottle = () => Throttle({ default: { limit: 10, ttl: HOUR } });
export const OtpVerifyThrottle = () => Throttle({ default: { limit: 10, ttl: MINUTE } });
export const SensitiveThrottle = () => Throttle({ default: { limit: 10, ttl: MINUTE } });
