import { APP_NAME, APP_TAGLINE } from '@acadlyx/constants';
import type { TenantBootstrap } from '@acadlyx/tenant-config';
import { BodyText, Heading, Screen } from '@acadlyx/mobile-ui';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AuthProvider, useAuth } from './auth/session';
import { env } from './config/env';
import { api } from './lib/api';
import { LoginScreen, MfaScreen, SignedInScreen, StatusScreen } from './screens/AuthScreens';

const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * Phase 3 shell. EXPO_PUBLIC_TENANT_KEY (dev stand-in for the per-school build) selects the
 * school: its public branding comes from the bootstrap API, then the school-scoped sign-in /
 * session restore runs. Without a (valid, active) school the neutral Acadlyx screen is shown.
 * No feature screens yet.
 */
export default function App() {
  const [tenant, setTenant] = useState<TenantBootstrap | null>(null);
  const [loaded, setLoaded] = useState(!env.tenantKey);

  useEffect(() => {
    const tenantKey = env.tenantKey;
    if (!tenantKey) return;
    const controller = new AbortController();
    api.tenant
      .bootstrap({ tenantKey }, controller.signal)
      .then(setTenant)
      .catch(() => setTenant(null))
      .finally(() => setLoaded(true));
    return () => controller.abort();
  }, []);

  const color = tenant?.branding?.primaryColor;
  const brand = color && HEX.test(color) ? color : '#0F172A';
  return (
    <Screen>
      {tenant && env.tenantKey ? (
        <AuthProvider tenantKey={env.tenantKey}>
          <View testID="tenant-color" style={[styles.swatch, { backgroundColor: brand }]} />
          <AuthGate schoolName={tenant.branding?.schoolName ?? tenant.displayName} color={brand} />
        </AuthProvider>
      ) : loaded ? (
        <>
          <Heading>{APP_NAME}</Heading>
          <BodyText>{APP_TAGLINE}</BodyText>
        </>
      ) : null}
      <StatusBar style="dark" />
    </Screen>
  );
}

function AuthGate({ schoolName, color }: { schoolName: string; color: string }) {
  const { state, retry } = useAuth();
  switch (state.status) {
    case 'restoring':
      return <StatusScreen title={schoolName} detail="Signing you in…" color={color} />;
    case 'offline':
      return (
        <StatusScreen
          title="You’re offline"
          detail="We couldn’t reach the server."
          onRetry={retry}
          color={color}
        />
      );
    case 'mfa':
      return <MfaScreen color={color} />;
    case 'signedIn':
      return <SignedInScreen color={color} />;
    default:
      return <LoginScreen schoolName={schoolName} color={color} />;
  }
}

const styles = StyleSheet.create({
  swatch: { width: 56, height: 56, borderRadius: 12, marginBottom: 16 },
});
