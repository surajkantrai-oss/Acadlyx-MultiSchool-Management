import { APP_NAME, APP_TAGLINE } from '@acadlyx/constants';
import type { TenantBootstrap } from '@acadlyx/tenant-config';
import { BodyText, Heading, Screen } from '@acadlyx/mobile-ui';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { env } from './config/env';
import { api } from './lib/api';

const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * Phase 2 base screen. With EXPO_PUBLIC_TENANT_KEY set, it loads that school's public
 * branding from the tenant bootstrap API ("School name — Powered by Acadlyx"); otherwise, or
 * if the school is unknown/unavailable, it shows the neutral Acadlyx screen. No auth, roles,
 * navigation or business modules yet.
 */
export default function App() {
  const [tenant, setTenant] = useState<TenantBootstrap | null>(null);

  useEffect(() => {
    const tenantKey = env.tenantKey;
    if (!tenantKey) return;
    const controller = new AbortController();
    api.tenant
      .bootstrap({ tenantKey }, controller.signal)
      .then(setTenant)
      .catch(() => {
        setTenant(null);
      });
    return () => {
      controller.abort();
    };
  }, []);

  const color = tenant?.branding?.primaryColor;
  return (
    <Screen>
      {tenant ? (
        <>
          <View
            testID="tenant-color"
            style={[
              styles.swatch,
              { backgroundColor: color && HEX.test(color) ? color : '#0F172A' },
            ]}
          />
          <Heading>{tenant.branding?.schoolName ?? tenant.displayName}</Heading>
          <BodyText>Powered by {APP_NAME}</BodyText>
        </>
      ) : (
        <>
          <Heading>{APP_NAME}</Heading>
          <BodyText>{APP_TAGLINE}</BodyText>
        </>
      )}
      <StatusBar style="dark" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  swatch: { width: 56, height: 56, borderRadius: 12, marginBottom: 16 },
});
