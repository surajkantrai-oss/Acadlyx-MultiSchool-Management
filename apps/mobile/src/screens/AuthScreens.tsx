import { APP_NAME } from '@acadlyx/constants';
import { BodyText, Heading } from '@acadlyx/mobile-ui';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../auth/session';

function PrimaryButton({
  label,
  onPress,
  busy,
  color,
  testID,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  color: string;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={[styles.button, { backgroundColor: color, opacity: busy ? 0.6 : 1 }]}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{label}</Text>}
    </Pressable>
  );
}

export function LoginScreen({ schoolName, color }: { schoolName: string; color: string }) {
  const { state, signIn } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notice = state.status === 'signedOut' ? state.notice : undefined;

  const submit = async () => {
    if (!identifier || !secret) return setError('Enter your sign-in ID and password or PIN.');
    setBusy(true);
    setError(await signIn(identifier, secret));
    setSecret('');
    setBusy(false);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.form}
    >
      <Heading>{schoolName}</Heading>
      <BodyText>Powered by {APP_NAME}</BodyText>
      <View style={styles.spacer} />
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <TextInput
        testID="identifier"
        style={styles.input}
        placeholder="Email, phone or ID"
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="username"
        value={identifier}
        onChangeText={setIdentifier}
      />
      <TextInput
        testID="secret"
        style={styles.input}
        placeholder="Password or PIN"
        secureTextEntry
        textContentType="password"
        value={secret}
        onChangeText={setSecret}
        onSubmitEditing={() => void submit()}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <PrimaryButton
        testID="sign-in"
        label="Sign in"
        busy={busy}
        color={color}
        onPress={() => void submit()}
      />
    </KeyboardAvoidingView>
  );
}

export function MfaScreen({ color }: { color: string }) {
  const { verifyMfa, cancelMfa } = useAuth();
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(await verifyMfa(useRecovery ? { recoveryCode: code.trim() } : { code: code.trim() }));
    setCode('');
    setBusy(false);
  };

  return (
    <View style={styles.form}>
      <Heading>Two-step verification</Heading>
      <BodyText>
        {useRecovery
          ? 'Enter one of your recovery codes.'
          : 'Enter the 6-digit code from your authenticator app.'}
      </BodyText>
      <View style={styles.spacer} />
      <TextInput
        testID="mfa-code"
        style={styles.input}
        autoCapitalize="characters"
        keyboardType={useRecovery ? 'default' : 'number-pad'}
        textContentType="oneTimeCode"
        maxLength={useRecovery ? 11 : 6}
        value={code}
        onChangeText={setCode}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <PrimaryButton label="Verify" busy={busy} color={color} onPress={() => void submit()} />
      <Pressable onPress={() => setUseRecovery((v) => !v)}>
        <Text style={styles.link}>
          {useRecovery ? 'Use authenticator code' : 'Use a recovery code'}
        </Text>
      </Pressable>
      <Pressable onPress={cancelMfa}>
        <Text style={styles.link}>Cancel</Text>
      </Pressable>
    </View>
  );
}

/** Phase 3 placeholder after sign-in: identity + roles + sign out. No feature screens yet. */
export function SignedInScreen({ color }: { color: string }) {
  const { state, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  if (state.status !== 'signedIn') return null;
  const { me } = state;
  return (
    <View style={styles.form}>
      <Heading>Welcome, {me.displayName}</Heading>
      <BodyText>{me.tenant?.displayName}</BodyText>
      <Text testID="roles" style={styles.roles}>
        {me.roles.join(' · ')}
      </Text>
      <View style={styles.spacer} />
      <PrimaryButton
        testID="sign-out"
        label="Sign out"
        busy={busy}
        color={color}
        onPress={() => {
          setBusy(true);
          void signOut();
        }}
      />
    </View>
  );
}

export function StatusScreen({
  title,
  detail,
  onRetry,
  color,
}: {
  title: string;
  detail?: string;
  onRetry?: () => void;
  color: string;
}) {
  return (
    <View style={styles.form}>
      {onRetry ? null : <ActivityIndicator />}
      <Heading>{title}</Heading>
      {detail ? <BodyText>{detail}</BodyText> : null}
      {onRetry ? (
        <>
          <View style={styles.spacer} />
          <PrimaryButton label="Try again" color={color} onPress={onRetry} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { width: '100%', maxWidth: 420, alignItems: 'stretch', gap: 12 },
  spacer: { height: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#0f172a',
  },
  button: { borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#b91c1c', fontSize: 14 },
  notice: {
    color: '#334155',
    fontSize: 14,
    backgroundColor: '#e2e8f0',
    padding: 10,
    borderRadius: 8,
  },
  link: {
    color: '#334155',
    textAlign: 'center',
    paddingVertical: 6,
    textDecorationLine: 'underline',
  },
  roles: { textAlign: 'center', color: '#475569', fontSize: 13, letterSpacing: 0.5 },
});
