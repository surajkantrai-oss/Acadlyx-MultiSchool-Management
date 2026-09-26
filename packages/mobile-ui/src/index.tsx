/**
 * Generic, unbranded React Native UI primitives.
 * Tenant theming is introduced in Phase 2.
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.heading}>
      {children}
    </Text>
  );
}

export function BodyText({ children }: { children: ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f8fafc',
  },
  heading: {
    fontSize: 32,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: -0.5,
  },
  body: {
    marginTop: 8,
    fontSize: 16,
    color: '#475569',
    textAlign: 'center',
  },
});
