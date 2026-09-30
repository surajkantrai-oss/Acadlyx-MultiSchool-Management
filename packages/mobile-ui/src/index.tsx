/**
 * Shared React Native UI for the Acadlyx mobile app (Phase 8). Neutral design tokens + ONE
 * runtime brand colour from the school's TenantBranding (via <ThemeProvider>). No component
 * hardcodes a school colour, and no status is conveyed by colour alone (every chip has text and
 * a symbol). Components are dependency-free (React Native primitives only).
 */
import { createContext, type ReactNode, useContext } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';

export const tokens = {
  bg: '#f8fafc',
  surface: '#ffffff',
  border: '#e2e8f0',
  text: '#0f172a',
  muted: '#475569',
  subtle: '#64748b',
  danger: '#b91c1c',
  dangerBg: '#fef2f2',
  space: 16,
  radius: 12,
  /** Minimum touch target (iOS HIG 44pt / Android 48dp). */
  touch: 48,
} as const;

const HEX = /^#[0-9A-Fa-f]{6}$/;

export interface Theme {
  brand: string;
  onBrand: string;
}

/** White or near-black text, whichever reads better on the brand colour (WCAG luminance). */
export function onColor(hex: string): string {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
  return lum > 0.35 ? tokens.text : '#ffffff';
}

export function themeFor(primaryColor: string | null | undefined): Theme {
  const brand = primaryColor && HEX.test(primaryColor) ? primaryColor : tokens.text;
  return { brand, onBrand: onColor(brand) };
}

const ThemeContext = createContext<Theme>(themeFor(null));
export const ThemeProvider = ({ theme, children }: { theme: Theme; children: ReactNode }) => (
  <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
);
export const useTheme = () => useContext(ThemeContext);

/**
 * Full-screen, centred content that SCROLLS when it doesn't fit (large accessibility text,
 * small phones, open keyboard), so actions such as "Sign in" are never cut off.
 */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" maxFontSizeMultiplier={1.6} style={styles.heading}>
      {children}
    </Text>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.title}>
      {children}
    </Text>
  );
}

export function BodyText({ children }: { children: ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

export function Caption({ children }: { children: ReactNode }) {
  return <Text style={styles.caption}>{children}</Text>;
}

export function Card({
  children,
  onPress,
  accessibilityLabel,
  testID,
}: {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
}) {
  if (!onPress) return <View style={styles.card}>{children}</View>;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function Button({
  label,
  onPress,
  busy,
  disabled,
  variant = 'primary',
  testID,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  testID?: string;
  accessibilityHint?: string;
}) {
  const theme = useTheme();
  const off = Boolean(busy || disabled);
  const bg =
    variant === 'primary' ? theme.brand : variant === 'danger' ? tokens.danger : tokens.surface;
  const fg = variant === 'secondary' ? tokens.text : variant === 'danger' ? '#fff' : theme.onBrand;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: off, busy: Boolean(busy) }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: off ? 0.55 : pressed ? 0.85 : 1 },
        variant === 'secondary' && styles.buttonSecondary,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.centered} accessibilityLabel={label} accessibilityRole="progressbar">
      <ActivityIndicator color={theme.brand} size="large" />
      <Text style={styles.caption}>{label}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.centered} accessibilityRole="alert">
      <Text style={styles.errorText}>{message}</Text>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {detail ? <Text style={styles.caption}>{detail}</Text> : null}
    </View>
  );
}

export function Notice({ tone, children }: { tone: 'info' | 'error'; children: ReactNode }) {
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : 'text'}
      style={[styles.notice, tone === 'error' ? styles.noticeError : styles.noticeInfo]}
    >
      <Text style={tone === 'error' ? styles.errorText : styles.body}>{children}</Text>
    </View>
  );
}

/** Status chip: always text + symbol, never colour alone. */
export function Chip({
  label,
  symbol,
  tone = 'neutral',
}: {
  label: string;
  symbol?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const t = CHIP[tone];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg, borderColor: t.border }]}>
      {/* The symbol is visual reinforcement only; assistive tech reads just the label. */}
      <Text accessibilityLabel={label} style={[styles.chipText, { color: t.fg }]}>
        {symbol ? `${symbol} ` : ''}
        {label}
      </Text>
    </View>
  );
}
const CHIP = {
  neutral: { bg: '#f1f5f9', border: '#cbd5e1', fg: '#334155' },
  good: { bg: '#f0fdf4', border: '#86efac', fg: '#166534' },
  warn: { bg: '#fffbeb', border: '#fcd34d', fg: '#92400e' },
  bad: { bg: '#fef2f2', border: '#fca5a5', fg: '#991b1b' },
} as const;

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

/** Segmented choice (role switch, child switch, status picker). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={styles.segmented}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: on, checked: on }}
            onPress={() => {
              onChange(o.value);
            }}
            style={[
              styles.segment,
              on && { backgroundColor: theme.brand, borderColor: theme.brand },
            ]}
          >
            <Text
              maxFontSizeMultiplier={1.8}
              style={[styles.segmentText, on && { color: theme.onBrand, fontWeight: '700' }]}
            >
              {on ? '✓ ' : ''}
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface TabItem<K extends string> {
  key: K;
  label: string;
  symbol: string;
}

export function TabBar<K extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: TabItem<K>[];
  active: K;
  onChange: (key: K) => void;
}) {
  const theme = useTheme();
  return (
    <View accessibilityRole="tablist" style={styles.tabBar}>
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Pressable
            key={t.key}
            testID={`tab-${t.key}`}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: on }}
            onPress={() => {
              onChange(t.key);
            }}
            style={styles.tab}
          >
            <Text
              accessible={false}
              importantForAccessibility="no"
              accessibilityElementsHidden
              maxFontSizeMultiplier={1.3}
              style={[styles.tabSymbol, { color: on ? theme.brand : tokens.subtle }]}
            >
              {t.symbol}
            </Text>
            {/* Tab labels scale up to 1.3× (like native tab bars) and never break mid-word;
                every tab also has an accessibilityLabel for screen readers. */}
            <Text
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              style={[
                styles.tabLabel,
                { color: on ? theme.brand : tokens.subtle, fontWeight: on ? '700' : '500' },
              ]}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screenScroll: { flex: 1, backgroundColor: tokens.bg },
  screen: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: tokens.bg,
  },
  heading: { fontSize: 28, fontWeight: '700', color: tokens.text, letterSpacing: -0.5 },
  title: { fontSize: 20, fontWeight: '700', color: tokens.text },
  body: { fontSize: 16, color: tokens.muted, lineHeight: 22 },
  caption: { fontSize: 14, color: tokens.subtle, marginTop: 2 },
  card: {
    backgroundColor: tokens.surface,
    borderRadius: tokens.radius,
    borderWidth: 1,
    borderColor: tokens.border,
    padding: tokens.space,
    marginBottom: 12,
    minHeight: tokens.touch,
  },
  pressed: { opacity: 0.8 },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: tokens.text, marginBottom: 8 },
  button: {
    minHeight: tokens.touch,
    borderRadius: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 6,
  },
  buttonSecondary: { borderWidth: 1, borderColor: tokens.border },
  buttonText: { fontSize: 16, fontWeight: '600' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  errorText: { fontSize: 16, color: tokens.danger, textAlign: 'center' },
  empty: { alignItems: 'center', padding: 24 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: tokens.muted, textAlign: 'center' },
  notice: { borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1 },
  noticeInfo: { backgroundColor: '#f1f5f9', borderColor: tokens.border },
  noticeError: { backgroundColor: tokens.dangerBg, borderColor: '#fecaca' },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  // Wraps at large text sizes so a status chip moves below the title instead of crushing it.
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  segmented: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 },
  segment: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: tokens.border,
    backgroundColor: tokens.surface,
    justifyContent: 'center',
  },
  segmentText: { fontSize: 15, color: tokens.text },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: tokens.border,
    backgroundColor: tokens.surface,
  },
  tab: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  tabSymbol: { fontSize: 18 },
  tabLabel: { fontSize: 12, marginTop: 2 },
});
