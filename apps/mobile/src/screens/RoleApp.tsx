import {
  BodyText,
  Button,
  Caption,
  Card,
  EmptyState,
  ErrorState,
  Heading,
  Loading,
  Notice,
  Section,
  Segmented,
  Title,
  tokens,
} from '@acadlyx/mobile-ui';
import type { MobileChild, MobileMe, MobileRole } from '@acadlyx/types';
import { resolveActiveRole, resolveSelectedChild } from '@acadlyx/validation';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/session';
import { api } from '../lib/api';
import { prefs } from '../lib/prefs';
import { useLoad } from '../lib/use-load';
import { TabNavigator, useNav } from '../nav/navigator';
import { ResultsScreen } from './shared/ResultScreens';
import { HomeSummary, TimetableScreen, WorkHub } from './shared/StudentScreens';
import {
  ClassesScreen,
  myTimetableRoute,
  TeacherHome,
  TeacherWorkScreen,
} from './teacher/TeacherScreens';

/*
 * Role experiences (Phase 8). The server says which mobile roles this user has (role granted +
 * active profile); the app picks the active one (remembered, revalidated — decision A). Switching
 * role remounts the whole role tree, so no data from one role is ever shown in another. The active
 * role is presentation only: every API call is authorised on the server.
 */
const ROLE_LABEL: Record<MobileRole, string> = {
  PARENT: 'Parent',
  STUDENT: 'Student',
  TEACHER: 'Teacher',
};

export function RoleApp({ tenantKey, schoolName }: { tenantKey: string; schoolName: string }) {
  const me = useLoad(() => api.mobile.me(), []);
  const [role, setRole] = useState<MobileRole | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!me.data) return;
    const data = me.data;
    void prefs.get(tenantKey, 'role').then((remembered) => {
      setRole(resolveActiveRole(data.roles, remembered));
      setReady(true);
    });
  }, [me.data, tenantKey]);

  const switchRole = useCallback(
    (next: MobileRole) => {
      setRole(next);
      void prefs.set(tenantKey, 'role', next);
    },
    [tenantKey],
  );

  if (me.error)
    return (
      <Centered>
        <ErrorState message={me.error} onRetry={me.reload} />
      </Centered>
    );
  if (!me.data || !ready)
    return (
      <Centered>
        <Loading label="Loading your school…" />
      </Centered>
    );
  if (!role) return <UnsupportedRole me={me.data} />;

  const common = { me: me.data, schoolName, onSwitchRole: switchRole };
  // `key` = role: switching remounts everything below (fresh state, no cross-role cache).
  switch (role) {
    case 'PARENT':
      return <ParentApp key="PARENT" tenantKey={tenantKey} {...common} />;
    case 'STUDENT':
      return <StudentApp key="STUDENT" {...common} />;
    case 'TEACHER':
      return <TeacherApp key="TEACHER" {...common} />;
  }
}

function Centered({ children }: { children: React.ReactNode }) {
  return <SafeAreaView style={styles.centered}>{children}</SafeAreaView>;
}

function UnsupportedRole({ me }: { me: MobileMe }) {
  const { signOut } = useAuth();
  return (
    <Centered>
      <Heading>Hi {me.displayName}</Heading>
      <View style={styles.gap}>
        <BodyText>
          This app is for parents, students and teachers. Your account (
          {me.otherRoles.join(', ').toLowerCase() || 'staff'}) uses the School Admin website
          instead.
        </BodyText>
      </View>
      <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
    </Centered>
  );
}

interface RoleProps {
  me: MobileMe;
  schoolName: string;
  onSwitchRole: (role: MobileRole) => void;
}

function Banner({ schoolName, subtitle }: { schoolName: string; subtitle: string }) {
  return (
    // Context banner (repeated on every tab): capped at 1.4× so, at the largest text sizes, it
    // doesn't push list content off-screen. Screen readers still get the full text.
    <View style={styles.banner}>
      <Text maxFontSizeMultiplier={1.4} style={styles.bannerSchool}>
        {schoolName}
      </Text>
      <Text maxFontSizeMultiplier={1.4} style={styles.bannerTitle}>
        {subtitle}
      </Text>
    </View>
  );
}

// ---- Student ---------------------------------------------------------------------------------

function StudentApp({ me, schoolName, onSwitchRole }: RoleProps) {
  return (
    <TabNavigator
      header={<Banner schoolName={schoolName} subtitle={me.student?.name ?? me.displayName} />}
      tabs={[
        {
          key: 'home',
          label: 'Home',
          symbol: '⌂',
          root: { key: 'home', title: 'Home', render: () => <StudentHome /> },
        },
        {
          key: 'work',
          label: 'Work',
          symbol: '✎',
          root: {
            key: 'work',
            title: 'My work',
            scroll: false,
            render: () => <WorkHub studentId={null} viewer="STUDENT" />,
          },
        },
        {
          key: 'results',
          label: 'Results',
          symbol: '★',
          root: {
            key: 'results',
            title: 'My results',
            scroll: false,
            render: () => <ResultsScreen studentId={null} />,
          },
        },
        {
          key: 'timetable',
          label: 'Timetable',
          symbol: '▦',
          root: {
            key: 'tt',
            title: 'Timetable',
            render: () => <TimetableScreen studentId={null} />,
          },
        },
        {
          key: 'profile',
          label: 'Profile',
          symbol: '◉',
          root: {
            key: 'profile',
            title: 'Profile',
            render: () => <Profile me={me} role="STUDENT" onSwitchRole={onSwitchRole} />,
          },
        },
      ]}
    />
  );
}

function StudentHome() {
  const home = useLoad(() => api.mobile.home(null), []);
  if (home.loading && !home.data) return <Loading />;
  if (home.error) return <ErrorState message={home.error} onRetry={home.reload} />;
  return home.data ? <HomeSummary home={home.data} viewer="STUDENT" studentId={null} /> : null;
}

// ---- Parent ------------------------------------------------------------------------------------

function ParentApp({ me, schoolName, onSwitchRole, tenantKey }: RoleProps & { tenantKey: string }) {
  const children = useLoad(() => api.mobile.children(), []);
  const [child, setChild] = useState<MobileChild | null>(null);
  const [ready, setReady] = useState(false);

  // Decision B: the remembered child is kept only if the server still lists it for this parent.
  useEffect(() => {
    if (!children.data) return;
    const list = children.data;
    void prefs.get(tenantKey, 'child').then((remembered) => {
      const selected = resolveSelectedChild(list, remembered);
      setChild(selected);
      if (selected) void prefs.set(tenantKey, 'child', selected.studentId);
      setReady(true);
    });
  }, [children.data, tenantKey]);

  const choose = (studentId: string) => {
    const next = children.data?.find((c) => c.studentId === studentId) ?? null;
    setChild(next);
    if (next) void prefs.set(tenantKey, 'child', next.studentId);
  };

  if (children.error)
    return (
      <Centered>
        <ErrorState message={children.error} onRetry={children.reload} />
      </Centered>
    );
  if (!children.data || !ready)
    return (
      <Centered>
        <Loading />
      </Centered>
    );
  const list = children.data;
  const switcher =
    list.length > 1 ? (
      <Segmented
        accessibilityLabel="Choose child"
        value={child?.studentId ?? null}
        onChange={choose}
        options={list.map((c) => ({ value: c.studentId, label: c.name.split(' ')[0] ?? c.name }))}
      />
    ) : null;
  const header = (
    <>
      <Banner
        schoolName={schoolName}
        subtitle={
          child ? `${child.name}${child.class ? ` · ${child.class.className}` : ''}` : 'Parent'
        }
      />
      {switcher}
    </>
  );
  if (!child)
    return (
      <TabNavigator
        header={header}
        tabs={[
          {
            key: 'home',
            label: 'Home',
            symbol: '⌂',
            root: {
              key: 'none',
              title: 'Home',
              render: () => (
                <EmptyState
                  title="No children linked yet"
                  detail="Please contact the school office."
                />
              ),
            },
          },
          {
            key: 'profile',
            label: 'Profile',
            symbol: '◉',
            root: {
              key: 'profile',
              title: 'Profile',
              render: () => (
                <Profile me={me} role="PARENT" onSwitchRole={onSwitchRole} kids={list} />
              ),
            },
          },
        ]}
      />
    );
  const id = child.studentId;
  // key = child: switching child resets every tab's stack and data.
  return (
    <TabNavigator
      key={id}
      header={header}
      tabs={[
        {
          key: 'home',
          label: 'Home',
          symbol: '⌂',
          root: { key: `home-${id}`, title: 'Home', render: () => <ParentHome studentId={id} /> },
        },
        {
          key: 'work',
          label: 'Academics',
          symbol: '✎',
          root: {
            key: `work-${id}`,
            title: 'Homework & assignments',
            scroll: false,
            render: () => <WorkHub studentId={id} viewer="PARENT" />,
          },
        },
        {
          key: 'results',
          label: 'Results',
          symbol: '★',
          root: {
            key: `results-${id}`,
            title: 'Results',
            scroll: false,
            render: () => <ResultsScreen studentId={id} />,
          },
        },
        {
          key: 'timetable',
          label: 'Timetable',
          symbol: '▦',
          root: {
            key: `tt-${id}`,
            title: 'Timetable',
            render: () => <TimetableScreen studentId={id} />,
          },
        },
        {
          key: 'profile',
          label: 'Profile',
          symbol: '◉',
          root: {
            key: 'profile',
            title: 'Profile',
            render: () => <Profile me={me} role="PARENT" onSwitchRole={onSwitchRole} kids={list} />,
          },
        },
      ]}
    />
  );
}

function ParentHome({ studentId }: { studentId: string }) {
  const home = useLoad(() => api.mobile.home(studentId), [studentId]);
  if (home.loading && !home.data) return <Loading />;
  if (home.error) return <ErrorState message={home.error} onRetry={home.reload} />;
  return home.data ? <HomeSummary home={home.data} viewer="PARENT" studentId={studentId} /> : null;
}

// ---- Teacher -----------------------------------------------------------------------------------

function TeacherApp({ me, schoolName, onSwitchRole }: RoleProps) {
  return (
    <TabNavigator
      header={<Banner schoolName={schoolName} subtitle={me.teacher?.name ?? me.displayName} />}
      tabs={[
        {
          key: 'home',
          label: 'Home',
          symbol: '⌂',
          root: { key: 'home', title: 'Today', render: () => <TeacherHome /> },
        },
        {
          key: 'classes',
          label: 'Classes',
          symbol: '☷',
          root: {
            key: 'classes',
            title: 'My classes',
            scroll: false,
            render: () => <ClassesScreen />,
          },
        },
        {
          key: 'work',
          label: 'Work',
          symbol: '✎',
          root: {
            key: 'work',
            title: 'Homework & assignments',
            scroll: false,
            render: () => <TeacherWorkScreen />,
          },
        },
        {
          key: 'profile',
          label: 'Profile',
          symbol: '◉',
          root: {
            key: 'profile',
            title: 'Profile',
            render: () => <Profile me={me} role="TEACHER" onSwitchRole={onSwitchRole} />,
          },
        },
      ]}
    />
  );
}

// ---- Profile (all roles) -------------------------------------------------------------------------

function Profile({
  me,
  role,
  onSwitchRole,
  kids,
}: {
  me: MobileMe;
  role: MobileRole;
  onSwitchRole: (role: MobileRole) => void;
  kids?: MobileChild[];
}) {
  const { signOut, state } = useAuth();
  const nav = useNav();
  const account = state.status === 'signedIn' ? state.me : null;
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Card>
        <Title>{me.displayName}</Title>
        {role === 'STUDENT' && me.student ? (
          <Caption>Admission no. {me.student.admissionNumber}</Caption>
        ) : null}
        {role === 'TEACHER' && me.teacher ? (
          <Caption>Employee ID {me.teacher.employeeId}</Caption>
        ) : null}
        <Caption>{me.schoolName}</Caption>
      </Card>
      {me.roles.length > 1 ? (
        <Section title="Use the app as">
          <Segmented
            accessibilityLabel="Use the app as"
            value={role}
            onChange={onSwitchRole}
            options={me.roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
          />
          <Caption>
            Switching changes what you see. Your access is always checked by the school.
          </Caption>
        </Section>
      ) : null}
      {role === 'PARENT' && kids ? (
        <Section title="Children">
          {kids.length === 0 ? <Caption>No children linked.</Caption> : null}
          {kids.map((c) => (
            <Card key={c.studentId}>
              <Text style={styles.strong}>{c.name}</Text>
              <Caption>
                {c.class ? `${c.class.className} · ${c.class.branchName}` : 'No current class'}
              </Caption>
            </Card>
          ))}
        </Section>
      ) : null}
      {role === 'TEACHER' ? (
        <Button
          label="My timetable"
          variant="secondary"
          onPress={() => nav.push(myTimetableRoute)}
        />
      ) : null}
      <Section title="Account">
        <Card>
          <Caption>
            Signs in with {account?.credentialType === 'PIN' ? 'a PIN' : 'a password'}
            {account?.mfa.enrolled ? ' and an authenticator app' : ''}.
          </Caption>
          <Caption>
            To change your password or PIN, use “Forgot PIN or password?” on the sign-in screen.
          </Caption>
        </Card>
      </Section>
      <Notice tone="info">
        Signing out removes your saved sign-in and choices from this device.
      </Notice>
      <Button
        testID="sign-out"
        label="Sign out"
        variant="danger"
        busy={busy}
        onPress={() => {
          setBusy(true);
          void signOut();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: tokens.bg,
    gap: 12,
  },
  gap: { marginVertical: 12 },
  banner: { marginBottom: 12 },
  bannerSchool: { fontSize: 14, color: tokens.subtle },
  bannerTitle: { fontSize: 18, fontWeight: '700', color: tokens.text },
  strong: { fontSize: 16, fontWeight: '700', color: tokens.text },
});
