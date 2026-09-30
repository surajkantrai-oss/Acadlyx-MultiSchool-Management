import { ApiError } from '@acadlyx/api-client';
import type { AuthTokens, MeResponse } from '@acadlyx/types';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, setAccessToken, setRefreshHandler } from '../lib/api';
import { prefs } from '../lib/prefs';
import { deviceDescriptor } from './installation-id';
import { secureStorage, storageKeys } from './secure-storage';

export type AuthState =
  | { status: 'restoring' }
  | { status: 'signedOut'; notice?: string }
  | { status: 'mfa'; mfaToken: string }
  | { status: 'signedIn'; me: MeResponse }
  | { status: 'offline' };

interface AuthApi {
  state: AuthState;
  signIn: (identifier: string, secret: string) => Promise<string | null>;
  verifyMfa: (factor: { code: string } | { recoveryCode: string }) => Promise<string | null>;
  signOut: () => Promise<void>;
  retry: () => void;
  cancelMfa: () => void;
}

const AuthContext = createContext<AuthApi | null>(null);

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/** Messages shown to the user: generic on purpose (no account enumeration). */
function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'Too many attempts. Please wait and try again.';
    if (error.body?.code === 'ACCOUNT_LOCKED') return 'Too many failed attempts. Try again later.';
    if (error.status === 401) return 'Those details don’t match our records.';
    if (error.status === 403 || error.status === 404) return 'This school is not available.';
  }
  return 'Could not reach the server. Check your connection.';
}

/**
 * Mobile session lifecycle for one school (tenant key):
 *  - restore: refresh token from secure storage → rotate → /me (network errors keep the token);
 *  - the access token lives in memory; it is refreshed shortly before expiry, single-flight so a
 *    rotated refresh token is never replayed (reuse would revoke the whole session family);
 *  - sign-out revokes server-side and wipes the stored refresh token.
 */
export function AuthProvider({ tenantKey, children }: { tenantKey: string; children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'restoring' });
  const auth = useMemo(() => api.auth('auth', { tenantKey }), [tenantKey]);
  const refreshKey = storageKeys.refreshToken(tenantKey);
  const refreshing = useRef<Promise<void> | null>(null);
  const [accessExpiresAt, setAccessExpiresAt] = useState<number | null>(null);

  const clearLocal = useCallback(async () => {
    setAccessExpiresAt(null);
    setAccessToken(null);
    await secureStorage.remove(refreshKey);
  }, [refreshKey]);

  const adopt = useCallback(
    async (tokens: AuthTokens) => {
      await secureStorage.set(refreshKey, tokens.refreshToken);
      setAccessToken(tokens.accessToken);
      setAccessExpiresAt(Date.parse(tokens.accessTokenExpiresAt));
    },
    [refreshKey],
  );

  const rotate = useCallback(async (): Promise<void> => {
    refreshing.current ??= (async () => {
      try {
        const stored = await secureStorage.get(refreshKey);
        if (!stored) throw new ApiError(401, null);
        await adopt(await auth.refresh(stored));
      } finally {
        refreshing.current = null;
      }
    })();
    return refreshing.current;
  }, [adopt, auth, refreshKey]);

  // Proactive refresh ~1 min before the access token expires.
  useEffect(() => {
    if (accessExpiresAt === null) return;
    const t = setTimeout(
      () => {
        rotate().catch(async (error: unknown) => {
          // Revoked/expired server-side (4xx) → sign out locally; network errors retry on next use.
          if (error instanceof ApiError && error.status < 500) {
            await clearLocal();
            setState({ status: 'signedOut', notice: 'Your session ended. Please sign in again.' });
          }
        });
      },
      Math.max(5_000, accessExpiresAt - Date.now() - 60_000),
    );
    return () => clearTimeout(t);
  }, [accessExpiresAt, clearLocal, rotate]);

  // Expired access token mid-request → rotate once (single-flight) and let the caller retry.
  useEffect(() => {
    setRefreshHandler(() =>
      rotate()
        .then(() => true)
        .catch(async (error: unknown) => {
          if (error instanceof ApiError && error.status < 500) {
            await clearLocal();
            setState({ status: 'signedOut', notice: 'Your session ended. Please sign in again.' });
          }
          return false;
        }),
    );
    return () => setRefreshHandler(null);
  }, [clearLocal, rotate]);

  const loadMe = useCallback(async () => {
    const me = await auth.me();
    // A session for another school (e.g. a development build re-pointed) is never reused.
    if (me.tenant?.key !== tenantKey) throw new ApiError(401, null);
    setState({ status: 'signedIn', me });
  }, [auth, tenantKey]);

  /** Resumes from the stored refresh token (read by the caller from secure storage). */
  const resume = useCallback(
    async (stored: string | null) => {
      if (!stored) return setState({ status: 'signedOut' });
      try {
        await rotate();
        await loadMe();
      } catch (error) {
        if (error instanceof ApiError && error.status < 500) {
          await clearLocal();
          setState({ status: 'signedOut', notice: 'Your session ended. Please sign in again.' });
        } else {
          setState({ status: 'offline' });
        }
      }
    },
    [clearLocal, loadMe, rotate],
  );

  const restore = useCallback(() => {
    void secureStorage.get(refreshKey).then(resume);
  }, [refreshKey, resume]);

  useEffect(() => {
    let active = true;
    // External sync: read secure storage, then update state in the callback.
    void secureStorage.get(refreshKey).then((stored) => (active ? resume(stored) : undefined));
    return () => {
      active = false;
    };
  }, [refreshKey, resume]);

  const value = useMemo<AuthApi>(
    () => ({
      state,
      retry: () => {
        setState({ status: 'restoring' });
        restore();
      },
      cancelMfa: () => setState({ status: 'signedOut' }),
      signIn: async (identifier, secret) => {
        try {
          const result = await auth.login(identifier.trim(), secret, await deviceDescriptor());
          if (result.status === 'AUTHENTICATED') {
            await adopt(result);
            await loadMe();
          } else if (result.status === 'MFA_REQUIRED') {
            setState({ status: 'mfa', mfaToken: result.mfaToken });
          } else {
            return 'Two-step verification must be set up first. Sign in to the School Admin website to set it up.';
          }
          return null;
        } catch (error) {
          return messageFor(error);
        }
      },
      verifyMfa: async (factor) => {
        if (state.status !== 'mfa') return 'Please sign in again.';
        try {
          await adopt(await auth.verifyMfa(state.mfaToken, factor));
          await loadMe();
          return null;
        } catch (error) {
          if (error instanceof ApiError && error.body?.code === 'MFA_STEP_EXPIRED') {
            setState({ status: 'signedOut', notice: 'That took too long. Please sign in again.' });
            return null;
          }
          return error instanceof ApiError && error.status === 401
            ? 'That code is not valid.'
            : messageFor(error);
        }
      },
      signOut: async () => {
        await auth.logout().catch(() => undefined); // best effort; local credentials go regardless
        await clearLocal();
        await prefs.clear(tenantKey); // selected child / active role
        setState({ status: 'signedOut' });
      },
    }),
    [adopt, auth, clearLocal, loadMe, restore, state, tenantKey],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
