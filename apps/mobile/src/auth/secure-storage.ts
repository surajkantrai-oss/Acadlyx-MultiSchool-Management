import * as SecureStore from 'expo-secure-store';

/**
 * The ONLY persistence for credentials on mobile: iOS Keychain / Android Keystore via
 * expo-secure-store. Never AsyncStorage. Items are readable only while the device is unlocked and
 * never migrate to another device through backups (…THIS_DEVICE_ONLY).
 *
 * Stored: the rotating refresh token (per school) and the installation id. The access token is
 * kept in memory only.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** SecureStore keys allow [A-Za-z0-9._-] only. */
const safe = (part: string) => part.replace(/[^A-Za-z0-9._-]/g, '_');

export const storageKeys = {
  installationId: 'acadlyx.installation-id',
  refreshToken: (tenantKey: string) => `acadlyx.${safe(tenantKey)}.refresh-token`,
} as const;

export const secureStorage = {
  get: (key: string) => SecureStore.getItemAsync(key, OPTIONS),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value, OPTIONS),
  remove: (key: string) => SecureStore.deleteItemAsync(key, OPTIONS),
};
