import { ApiError } from '@acadlyx/api-client';
import { APP_NAME, APP_TAGLINE } from '@acadlyx/constants';
import {
  BodyText,
  Button,
  Heading,
  Loading,
  Screen,
  type Theme,
  themeFor,
  ThemeProvider,
} from '@acadlyx/mobile-ui';
import type { TenantBootstrap } from '@acadlyx/tenant-config';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './auth/session';
import { env } from './config/env';
import { api } from './lib/api';
import { LoginScreen, MfaScreen, StatusScreen } from './screens/AuthScreens';
import { RoleApp } from './screens/RoleApp';

/**
 * Tenant-bound white-label app (Phase 8). Startup:
 *   build tenant key → tenant bootstrap (must be ACTIVE and the SAME key) → branding/theme →
 *   restore session (revalidated with the server) → mobile roles → role experience.
 * There is NO school picker. A release build without a valid tenant key refuses to run; an
 * unknown/suspended school shows a neutral "not available" screen (no internal status shown).
 */
type Boot =
  | { status: 'loading' }
  | { status: 'ready'; tenant: TenantBootstrap; theme: Theme }
  | { status: 'unavailable' }
  | { status: 'offline' };

export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}

function Root() {
  const tenantKey = env.tenantKey;
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });

  // Resolves the build's school; state is only set from the async result (retry sets loading).
  const fetchBoot = useCallback(
    (signal?: AbortSignal) => {
      if (!tenantKey) return;
      api.tenant
        .bootstrap({ tenantKey }, signal)
        .then((tenant) => {
          // Fail closed: the server must confirm exactly this build's school.
          if (tenant.key !== tenantKey) return setBoot({ status: 'unavailable' });
          setBoot({ status: 'ready', tenant, theme: themeFor(tenant.branding?.primaryColor) });
        })
        .catch((error: unknown) => {
          if (signal?.aborted) return;
          setBoot(error instanceof ApiError ? { status: 'unavailable' } : { status: 'offline' });
        });
    },
    [tenantKey],
  );
  const load = () => {
    setBoot({ status: 'loading' });
    fetchBoot();
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchBoot(controller.signal);
    return () => controller.abort();
  }, [fetchBoot]);

  if (!tenantKey)
    return (
      <Screen>
        <Heading>{APP_NAME}</Heading>
        <BodyText>{APP_TAGLINE}</BodyText>
        <View style={styles.gap}>
          <BodyText>
            {env.release
              ? 'This app is not configured for a school. Please install your school’s app.'
              : 'Development build without a school. Set ACADLYX_TENANT (for example school-a) and restart.'}
          </BodyText>
        </View>
      </Screen>
    );

  switch (boot.status) {
    case 'loading':
      return (
        <Screen>
          <Loading label="Opening your school…" />
        </Screen>
      );
    case 'unavailable':
      return (
        <Screen>
          <Heading>School unavailable</Heading>
          <View style={styles.gap}>
            <BodyText>
              This school’s app isn’t available right now. Please try again later.
            </BodyText>
          </View>
          <Button label="Try again" variant="secondary" onPress={() => load()} />
        </Screen>
      );
    case 'offline':
      return (
        <Screen>
          <Heading>You’re offline</Heading>
          <View style={styles.gap}>
            <BodyText>We couldn’t reach the school. Check your connection.</BodyText>
          </View>
          <Button label="Try again" variant="secondary" onPress={() => load()} />
        </Screen>
      );
    case 'ready': {
      const schoolName = boot.tenant.branding?.schoolName ?? boot.tenant.displayName;
      return (
        <ThemeProvider theme={boot.theme}>
          <AuthProvider tenantKey={tenantKey}>
            <AuthGate schoolName={schoolName} theme={boot.theme} tenantKey={tenantKey} />
          </AuthProvider>
        </ThemeProvider>
      );
    }
  }
}

function AuthGate({
  schoolName,
  theme,
  tenantKey,
}: {
  schoolName: string;
  theme: Theme;
  tenantKey: string;
}) {
  const { state, retry } = useAuth();
  switch (state.status) {
    case 'restoring':
      return (
        <Screen>
          <StatusScreen title={schoolName} detail="Signing you in…" color={theme.brand} />
        </Screen>
      );
    case 'offline':
      return (
        <Screen>
          <StatusScreen
            title="You’re offline"
            detail="We couldn’t reach the server."
            onRetry={retry}
            color={theme.brand}
          />
        </Screen>
      );
    case 'mfa':
      return (
        <Screen>
          <MfaScreen color={theme.brand} />
        </Screen>
      );
    case 'signedIn':
      // key = session: a new sign-in never sees the previous user's in-memory data.
      return <RoleApp key={state.me.sessionId} tenantKey={tenantKey} schoolName={schoolName} />;
    default:
      return (
        <Screen>
          <View testID="tenant-color" style={[styles.swatch, { backgroundColor: theme.brand }]} />
          <LoginScreen schoolName={schoolName} color={theme.brand} />
        </Screen>
      );
  }
}

const styles = StyleSheet.create({
  gap: { marginVertical: 16 },
  swatch: { width: 56, height: 56, borderRadius: 12, marginBottom: 16 },
});
