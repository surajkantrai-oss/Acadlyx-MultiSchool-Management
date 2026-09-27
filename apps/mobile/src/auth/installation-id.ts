import type { ClientPlatform, DeviceDescriptor } from '@acadlyx/types';
import { randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';
import { secureStorage, storageKeys } from './secure-storage';

let cached: string | null = null;

/**
 * Random per-installation identifier (CSPRNG UUID), created once and kept in secure storage.
 * It is not a hardware id and carries no personal data; the API uses it to recognise known
 * devices (a login from an unseen installation is recorded and audited as NEW_DEVICE_LOGIN —
 * no OTP is enforced in Phase 3).
 */
export async function installationId(): Promise<string> {
  if (cached) return cached;
  const existing = await secureStorage.get(storageKeys.installationId);
  if (existing && /^[A-Za-z0-9-]{16,64}$/.test(existing)) return (cached = existing);
  const created = randomUUID();
  await secureStorage.set(storageKeys.installationId, created);
  return (cached = created);
}

export async function deviceDescriptor(): Promise<DeviceDescriptor> {
  const platform: ClientPlatform = Platform.OS === 'ios' ? 'IOS' : 'ANDROID';
  return {
    installationId: await installationId(),
    platform,
    label: `${Platform.OS === 'ios' ? 'iOS' : 'Android'} app`,
  };
}
