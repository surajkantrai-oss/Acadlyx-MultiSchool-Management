import { TabBar, type TabItem, tokens, useTheme } from '@acadlyx/mobile-ui';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Minimal role-aware navigation (Phase 8): bottom tabs, each with its own stack of screens. Tabs
 * a user has visited stay mounted (so switching tabs keeps their state); the whole tree is
 * discarded on role switch or sign-out. Android back pops the current stack.
 */
export interface Route {
  key: string;
  title: string;
  render: () => ReactNode;
  /** Screens with their own list/scroll (FlatList) opt out of the default ScrollView. */
  scroll?: boolean;
}

interface NavApi {
  push: (route: Route) => void;
  pop: () => void;
  /** Replace the whole stack of the current tab with its root (e.g. after a save). */
  popToRoot: () => void;
  switchTab: (tab: string) => void;
}

const NavContext = createContext<NavApi | null>(null);

export function useNav(): NavApi {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav outside a navigator');
  return ctx;
}

export interface TabDef<K extends string> extends TabItem<K> {
  root: Route;
}

export function TabNavigator<K extends string>({
  tabs,
  header,
}: {
  tabs: TabDef<K>[];
  /** Branded header content shown on every tab root (school name, role, child). */
  header?: ReactNode;
}) {
  const first = tabs[0]?.key as K;
  const [nav, setNav] = useState<{ active: K; visited: K[]; stacks: Record<string, Route[]> }>({
    active: first,
    visited: [first],
    stacks: {},
  });
  const { active, visited, stacks } = nav;

  const rootOf = useCallback(
    (key: string): Route[] => {
      const root = tabs.find((t) => t.key === key)?.root;
      return root ? [root] : [];
    },
    [tabs],
  );
  const stackOf = useCallback((key: K) => stacks[key] ?? rootOf(key), [rootOf, stacks]);

  const api = useMemo<NavApi>(
    () => ({
      push: (route) =>
        setNav((n) => ({
          ...n,
          stacks: { ...n.stacks, [n.active]: [...(n.stacks[n.active] ?? rootOf(n.active)), route] },
        })),
      pop: () =>
        setNav((n) => {
          const current = n.stacks[n.active];
          if (!current || current.length <= 1) return n;
          return { ...n, stacks: { ...n.stacks, [n.active]: current.slice(0, -1) } };
        }),
      popToRoot: () =>
        setNav((n) => ({ ...n, stacks: { ...n.stacks, [n.active]: rootOf(n.active) } })),
      switchTab: (tab) =>
        setNav((n) => ({
          ...n,
          active: tab as K,
          visited: n.visited.includes(tab as K) ? n.visited : [...n.visited, tab as K],
        })),
    }),
    [rootOf],
  );

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const current = stacks[active];
      if (current && current.length > 1) {
        api.pop();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [active, api, stacks]);

  return (
    <NavContext.Provider value={api}>
      <SafeAreaView style={styles.fill} edges={['top', 'left', 'right']}>
        <View style={styles.fill}>
          {tabs
            .filter((t) => visited.includes(t.key))
            .map((t) => {
              const stack = stackOf(t.key);
              const top = stack[stack.length - 1];
              const on = t.key === active;
              return (
                <View
                  key={t.key}
                  style={[styles.fill, !on && styles.hidden]}
                  accessibilityElementsHidden={!on}
                  importantForAccessibility={on ? 'auto' : 'no-hide-descendants'}
                >
                  {top ? (
                    <StackScreen
                      key={top.key}
                      route={top}
                      canGoBack={stack.length > 1}
                      header={stack.length === 1 ? header : null}
                      onBack={api.pop}
                    />
                  ) : null}
                </View>
              );
            })}
        </View>
      </SafeAreaView>
      <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.tabArea}>
        <TabBar tabs={tabs} active={active} onChange={(k) => api.switchTab(k)} />
      </SafeAreaView>
    </NavContext.Provider>
  );
}

function StackScreen({
  route,
  canGoBack,
  header,
  onBack,
}: {
  route: Route;
  canGoBack: boolean;
  header: ReactNode;
  onBack: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        {canGoBack ? (
          <Pressable
            testID="nav-back"
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={onBack}
            hitSlop={8}
            style={styles.back}
          >
            <Text maxFontSizeMultiplier={1.6} style={[styles.backText, { color: theme.brand }]}>
              ‹ Back
            </Text>
          </Pressable>
        ) : null}
        <Text
          accessibilityRole="header"
          style={styles.headerTitle}
          numberOfLines={2}
          maxFontSizeMultiplier={1.6}
        >
          {route.title}
        </Text>
      </View>
      {route.scroll === false ? (
        <View style={styles.body}>
          {header}
          {route.render()}
        </View>
      ) : (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {header}
          {route.render()}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: tokens.bg },
  hidden: { display: 'none' },
  tabArea: { backgroundColor: tokens.surface },
  header: {
    paddingHorizontal: tokens.space,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: tokens.border,
    backgroundColor: tokens.surface,
  },
  back: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  backText: { fontSize: 17, fontWeight: '600' },
  headerTitle: { fontSize: 22, fontWeight: '700', color: tokens.text },
  body: { flex: 1, padding: tokens.space },
  scroll: { padding: tokens.space, paddingBottom: 32 },
});
