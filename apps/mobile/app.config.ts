import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * White-label build configuration (Phase 8). ONE codebase, ONE school per build.
 *
 *   ACADLYX_TENANT=school-a  → white-label/school-a.json (tenant key, app name, bundle id/package,
 *                              scheme, native icon/splash). Runtime branding (logo, colours, school
 *                              name) still comes from the server's TenantBranding at launch.
 *
 * The tenant key is PUBLIC identification (never auth) and is exposed to the JS bundle as
 * EXPO_PUBLIC_TENANT_KEY. Release builds FAIL CLOSED: without a valid variant the build stops —
 * there is no default school and no in-app school picker. Signing credentials never live here.
 */
interface Variant {
  tenantKey: string;
  displayName: string;
  slug: string;
  scheme: string;
  iosBundleIdentifier: string;
  androidPackage: string;
  assets: {
    icon: string;
    splash: string;
    splashBackground: string;
    adaptiveIconForeground: string;
    adaptiveIconBackground: string;
    adaptiveIconMonochrome: string;
    adaptiveIconBackgroundColor: string;
  };
}

const KEY = /^[A-Z][A-Z0-9_]{1,62}$/;
const ID = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){2,}$/;

function loadVariant(name: string): Variant {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Invalid ACADLYX_TENANT "${name}"`);
  const file = join(__dirname, 'white-label', `${name}.json`);
  if (!existsSync(file)) throw new Error(`Unknown white-label variant "${name}" (${file})`);
  const v = JSON.parse(readFileSync(file, 'utf8')) as Variant;
  if (!KEY.test(v.tenantKey)) throw new Error(`${name}: invalid tenantKey`);
  if (!ID.test(v.iosBundleIdentifier) || !ID.test(v.androidPackage))
    throw new Error(`${name}: invalid iOS bundle identifier / Android package`);
  if (!v.displayName.trim()) throw new Error(`${name}: displayName is required`);
  return v;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variantName = process.env.ACADLYX_TENANT?.trim() || null;
  const release =
    process.env.ACADLYX_RELEASE === '1' ||
    ['production', 'preview'].includes(process.env.EAS_BUILD_PROFILE ?? '');
  if (release && !variantName)
    throw new Error('Release builds require ACADLYX_TENANT (one school per build; no default).');
  const variant = variantName ? loadVariant(variantName) : null;

  const envKey = process.env.EXPO_PUBLIC_TENANT_KEY?.trim() || null;
  if (variant && envKey && envKey !== variant.tenantKey)
    throw new Error(
      `EXPO_PUBLIC_TENANT_KEY (${envKey}) contradicts ACADLYX_TENANT=${variantName ?? ''}`,
    );
  // The bundle reads the key from EXPO_PUBLIC_TENANT_KEY (inlined at bundle time).
  if (variant) process.env.EXPO_PUBLIC_TENANT_KEY = variant.tenantKey;

  const assets = variant?.assets;
  return {
    ...config,
    name: variant?.displayName ?? 'Acadlyx Dev',
    slug: variant?.slug ?? 'acadlyx',
    scheme: variant?.scheme ?? 'acadlyx',
    version: '1.0.0',
    orientation: 'portrait',
    icon: assets?.icon ?? './assets/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: true,
      bundleIdentifier: variant?.iosBundleIdentifier ?? 'com.acadlyx.dev',
    },
    android: {
      package: variant?.androidPackage ?? 'com.acadlyx.dev',
      adaptiveIcon: {
        backgroundColor: assets?.adaptiveIconBackgroundColor ?? '#F8FAFC',
        foregroundImage: assets?.adaptiveIconForeground ?? './assets/android-icon-foreground.png',
        backgroundImage: assets?.adaptiveIconBackground ?? './assets/android-icon-background.png',
        monochromeImage: assets?.adaptiveIconMonochrome ?? './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      // No sensitive device permissions in Phase 8 (no camera, location, notifications).
      blockedPermissions: [
        'android.permission.CAMERA',
        'android.permission.RECORD_AUDIO',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.POST_NOTIFICATIONS',
      ],
    },
    web: { favicon: './assets/favicon.png' },
    plugins: [
      'expo-secure-store',
      [
        'expo-splash-screen',
        {
          image: assets?.splash ?? './assets/splash-icon.png',
          imageWidth: 200,
          resizeMode: 'contain',
          backgroundColor: assets?.splashBackground ?? '#F8FAFC',
        },
      ],
    ],
    extra: { acadlyx: { tenantKey: variant?.tenantKey ?? envKey, variant: variantName, release } },
  };
};
