import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AndroidAppResponse, PublicRelease, TrustedAndroidApp } from '@marinoscar/platform-contract/android-app';

import { isPlatformApiError, usePlatformApi } from '../../core/index.js';
import { createAndroidAppClient, type AndroidAppClient, type AndroidAppTransport } from './client.js';

function messageOf(error: unknown): string {
  if (isPlatformApiError(error)) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/**
 * The android-app client over the host's transport (`PlatformHostProvider`).
 *
 * @returns a memoised client.
 *
 * @stability experimental
 */
export function useAndroidAppClient(): AndroidAppClient {
  const api = usePlatformApi() as AndroidAppTransport;
  return useMemo(() => createAndroidAppClient(api), [api]);
}

/**
 * What {@link useAndroidRelease} returns.
 *
 * @stability experimental
 */
export interface UseAndroidReleaseReturn {
  /** The current release, or null (none published, not loaded, disabled or failed). */
  release: PublicRelease | null;
  /** Whether the request is in flight. */
  isLoading: boolean;
  /** The error message, or null (a 404 NO_RELEASE is not an error). */
  error: string | null;
}

/**
 * The release this server offers, for any signed-in user. Requests nothing
 * while `enabled` is false (the update banner passes `false` outside the
 * TWA, so an ordinary tab makes no request).
 *
 * @param enabled - whether to fetch (default true).
 * @returns the release state.
 *
 * @example
 * ```tsx
 * const { release } = useAndroidRelease(getInstalledAppVersion() !== null);
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useAndroidRelease(enabled = true): UseAndroidReleaseReturn {
  const client = useAndroidAppClient();
  const [state, setState] = useState<UseAndroidReleaseReturn>({ release: null, isLoading: enabled, error: null });
  useEffect(() => {
    if (!enabled) {
      setState({ release: null, isLoading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((previous) => ({ ...previous, isLoading: true }));
    client.latest().then(
      (release) => !cancelled && setState({ release, isLoading: false, error: null }),
      (error: unknown) => {
        if (cancelled) return;
        const notFound = isPlatformApiError(error) && error.status === 404;
        setState({ release: null, isLoading: false, error: notFound ? null : messageOf(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, enabled]);
  return state;
}

/**
 * What {@link useAndroidAppConfig} returns.
 *
 * @stability experimental
 */
export interface UseAndroidAppConfigReturn {
  /** The admin view, or null until loaded. */
  config: AndroidAppResponse | null;
  /** Loading the first time. */
  isLoading: boolean;
  /** A load error. */
  error: string | null;
  /** A save in flight. */
  isSaving: boolean;
  /** The last save's error (the server's message, typed reason included). */
  saveError: string | null;
  /** Replaces the trusted list; resolves whether it saved. */
  save(trustedApps: TrustedAndroidApp[]): Promise<boolean>;
  /** Reloads the view. */
  refresh(): Promise<void>;
}

/**
 * The admin view of `/api/admin/android-app` with save and refresh.
 *
 * @returns the state and actions.
 *
 * @stability experimental
 */
export function useAndroidAppConfig(): UseAndroidAppConfigReturn {
  const client = useAndroidAppClient();
  const [config, setConfig] = useState<AndroidAppResponse | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setConfig(await client.get());
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (trustedApps: TrustedAndroidApp[]) => {
      setSaving(true);
      setSaveError(null);
      try {
        setConfig(await client.replace(trustedApps));
        return true;
      } catch (e) {
        setSaveError(messageOf(e));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [client],
  );

  return { config, isLoading, error, isSaving, saveError, save, refresh };
}
