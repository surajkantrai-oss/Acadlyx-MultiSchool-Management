import { APP_NAME, APP_TAGLINE } from '@acadlyx/constants';
import { BodyText, Heading, Screen } from '@acadlyx/mobile-ui';
import { StatusBar } from 'expo-status-bar';

/**
 * Phase 1 base screen. Role experiences (Parent/Student/Teacher), authentication and
 * tenant-branded builds are introduced in later phases.
 */
export default function App() {
  return (
    <Screen>
      <Heading>{APP_NAME}</Heading>
      <BodyText>{APP_TAGLINE}</BodyText>
      <StatusBar style="dark" />
    </Screen>
  );
}
