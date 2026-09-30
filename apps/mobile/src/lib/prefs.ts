import { secureStorage } from '../auth/secure-storage';

/**
 * Non-sensitive per-school UI preferences (last active role, last selected child) — decisions A/B.
 * Stored with the existing device storage abstraction, keyed by school, ALWAYS revalidated
 * against the server on launch, and wiped on sign-out. Never credentials.
 */
const safe = (part: string) => part.replace(/[^A-Za-z0-9._-]/g, '_');
const key = (tenantKey: string, name: 'role' | 'child') =>
  `acadlyx.${safe(tenantKey)}.pref.${name}`;

export const prefs = {
  get: (tenantKey: string, name: 'role' | 'child') =>
    secureStorage.get(key(tenantKey, name)).catch(() => null),
  set: (tenantKey: string, name: 'role' | 'child', value: string) =>
    secureStorage.set(key(tenantKey, name), value).catch(() => undefined),
  clear: async (tenantKey: string) => {
    await Promise.all(
      (['role', 'child'] as const).map((n) =>
        secureStorage.remove(key(tenantKey, n)).catch(() => undefined),
      ),
    );
  },
};
