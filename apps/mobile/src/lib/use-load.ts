import { useCallback, useEffect, useMemo, useState } from 'react';
import { friendlyError } from './errors';

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Loads data for a mounted screen (memory only — nothing academic is persisted, so sign-out and
 * role switches, which unmount the role tree, drop it). `loading` is derived from whether the
 * latest result belongs to the current request; late responses of old requests are ignored.
 * `deps` must be serialisable (ids, strings, numbers).
 */
export function useLoad<T>(fetcher: () => Promise<T>, deps: readonly unknown[]): Loaded<T> {
  const [tick, setTick] = useState(0);
  const key = JSON.stringify([tick, ...deps]);
  const [result, setResult] = useState<{
    key: string | null;
    data: T | null;
    error: string | null;
  }>({
    key: null,
    data: null,
    error: null,
  });

  useEffect(() => {
    let live = true;
    fetcher()
      .then((data) => {
        if (live) setResult({ key, data, error: null });
      })
      .catch((e: unknown) => {
        if (live) setResult((r) => ({ key, data: r.data, error: friendlyError(e) }));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` encodes the caller's deps
  }, [key]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const loading = result.key !== key;
  return useMemo(
    () => ({ data: result.data, error: loading ? null : result.error, loading, reload }),
    [loading, reload, result.data, result.error],
  );
}
