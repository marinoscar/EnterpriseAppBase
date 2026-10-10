// =============================================================================
// OnboardingProvider and useOnboarding (issue #745, PP-9.3)
// =============================================================================
//
// ONE FETCH PER SHELL. The welcome dialog, the checklists, the user menu's
// "Getting started" and the Setup guide all read the same answer, so the app
// mounts `OnboardingProvider` once around its authenticated shell. With no
// provider above it, `useOnboarding` answers an inert "nothing to show" and
// requests nothing (chrome rendered alone, tests, previews).
//
// DERIVED, NOT STORED. Every step's status comes from `GET /api/onboarding`.
// The browser writes only UI state (welcome seen, a checklist dismissed, a
// step skipped) through `PATCH /api/user-settings` with `If-Match`.
//
// WRITES ARE OPTIMISTIC: closing the dialog closes it now. The written fields
// overlay the last read until the re-read lands; a FAILED write keeps the
// overlay for the session (a dialog that comes back after being closed is
// worse than a preference that did not persist) and reports `error`.
// =============================================================================

import { ONBOARDING_READ_PERMISSION } from '@marinoscar/platform-contract/onboarding';
import type { OnboardingResponse, OnboardingState } from '@marinoscar/platform-contract/onboarding';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { isPlatformApiError, useOptionalPlatformHost } from '../../core/index.js';
import { useIsMounted } from '../internal/use-is-mounted.js';
import { createOnboardingClient } from './client.js';
import type { OnboardingClient, OnboardingSettingsWrite } from './client.js';

/**
 * What {@link useOnboarding} returns.
 *
 * @stability experimental
 */
export interface UseOnboardingReturn {
  /** True under an {@link OnboardingProvider}; false for the inert answer. */
  available: boolean;
  /** The app's display name (for copy), from the provider. */
  appName: string;
  /** The last read with the optimistic overlay applied; `null` until it resolves, when it failed or without `user_settings:read`. */
  state: OnboardingResponse | null;
  /** True only until the first read settles. */
  isLoading: boolean;
  /** A later re-read is in flight. */
  isRefreshing: boolean;
  /** The last request failure, as a sentence. */
  error: string | null;
  /** Re-read; `refresh: true` asks the API to re-run the Doctor probes. Never throws. */
  refresh(options?: { refresh?: boolean }): Promise<void>;
  /** Writes stored UI state (platform or app fields; `null` clears one). Never throws. */
  update(patch: OnboardingSettingsWrite): Promise<void>;
  /** Closes the welcome for good, with optional app fields (a goal). Never throws. */
  markWelcomeSeen(extra?: OnboardingSettingsWrite): Promise<void>;
  /** Hides the Get started checklist. Never throws. */
  dismissChecklist(): Promise<void>;
  /** Hides the administrator's setup prompt. Never throws. */
  dismissAdmin(): Promise<void>;
  /** Skips (or, with `false`, un-skips) a skippable step. Never throws. */
  setSkipped(stepId: string, skipped: boolean): Promise<void>;
  /** Shows the welcome and the checklists again ("Getting started"). Never throws. */
  reopen(): Promise<void>;
}

const noop = async (): Promise<void> => undefined;

/**
 * The answer without a provider: nothing to show, nothing to do.
 *
 * @stability experimental
 */
export const ONBOARDING_INERT: UseOnboardingReturn = Object.freeze({
  available: false,
  appName: '',
  state: null,
  isLoading: false,
  isRefreshing: false,
  error: null,
  refresh: noop,
  update: noop,
  markWelcomeSeen: noop,
  dismissChecklist: noop,
  dismissAdmin: noop,
  setSkipped: noop,
  reopen: noop,
});

const OnboardingContext = createContext<UseOnboardingReturn | null>(null);
OnboardingContext.displayName = 'OnboardingContext';

function messageFor(err: unknown, fallback: string): string {
  return isPlatformApiError(err) && err.message ? err.message : fallback;
}

function applyOverlay(state: OnboardingResponse, overlay: OnboardingSettingsWrite | null): OnboardingResponse {
  if (!overlay) return state;
  const settings: Record<string, unknown> = { ...state.settings };
  for (const [key, value] of Object.entries(overlay)) {
    settings[key] = value === null ? (key === 'skipped' ? [] : null) : value;
  }
  const skipped = new Set((settings['skipped'] as string[] | undefined) ?? []);
  const mark = (block: OnboardingResponse['user']) => {
    const steps = block.steps.map((step) => ({ ...step, skipped: step.skippable && skipped.has(step.id) }));
    return { ...block, steps, allResolved: steps.every((step) => step.status === 'done' || step.skipped) };
  };
  return {
    settings: settings as OnboardingState,
    user: mark(state.user),
    admin: state.admin ? mark(state.admin) : null,
  };
}

/**
 * What {@link OnboardingProvider} takes.
 *
 * @stability experimental
 */
export interface OnboardingProviderProps {
  /** The routed shell. */
  children: ReactNode;
  /** The app's display name, used in the welcome and the Setup guide. Default `'this app'`. */
  appName?: string;
  /** The client to use. Default: `createOnboardingClient(host.api)`; keep its identity stable. */
  client?: OnboardingClient;
}

/**
 * Runs `GET /api/onboarding` once for everything below it. Mount it once,
 * inside the platform host provider, around the authenticated shell.
 *
 * @param props - see {@link OnboardingProviderProps}.
 * @returns the provider element.
 * @throws Error when no `client` is given and no `PlatformHostProvider` is mounted.
 *
 * @example
 * ```tsx
 * <AppPlatformHostProvider>
 *   <OnboardingProvider appName={APP_NAME}>
 *     <Layout />
 *   </OnboardingProvider>
 * </AppPlatformHostProvider>
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function OnboardingProvider(props: OnboardingProviderProps): ReactElement {
  const host = useOptionalPlatformHost();
  const api = host?.api;
  const client = useMemo(() => {
    if (props.client) return props.client;
    if (!api) {
      throw new Error(
        'OnboardingProvider: no PlatformHostProvider above this component and no client was passed. ' +
          'Mount PlatformHostProvider (from @marinoscar/platform-web/core) or pass createOnboardingClient(api).',
      );
    }
    return createOnboardingClient(api);
  }, [props.client, api]);
  const canRead = host ? host.viewer.hasPermission(ONBOARDING_READ_PERMISSION) : true;
  const isMounted = useIsMounted();

  const [state, setState] = useState<OnboardingResponse | null>(null);
  const [isLoading, setIsLoading] = useState(canRead);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<OnboardingSettingsWrite | null>(null);
  const loaded = useRef(false);
  const writeSeq = useRef(0);

  const refresh = useCallback(
    async (options: { refresh?: boolean } = {}) => {
      if (!canRead) {
        if (isMounted()) setIsLoading(false);
        return;
      }
      try {
        if (loaded.current) setIsRefreshing(true);
        setError(null);
        const data = await client.get(options.refresh ? { refresh: true } : {});
        loaded.current = true;
        if (isMounted()) setState(data);
      } catch (err) {
        if (isMounted()) setError(messageFor(err, 'Failed to load the getting-started steps'));
      } finally {
        if (isMounted()) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [canRead, client, isMounted],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = useCallback(
    async (patch: OnboardingSettingsWrite) => {
      const seq = ++writeSeq.current;
      setOverlay((current) => ({ ...(current ?? {}), ...patch }));
      try {
        await client.write(patch);
      } catch (err) {
        if (isMounted()) setError(messageFor(err, 'Failed to save your onboarding progress'));
        return;
      }
      await refresh();
      if (isMounted() && writeSeq.current === seq) setOverlay(null);
    },
    [client, refresh, isMounted],
  );

  const skippedNow = useCallback((): string[] => {
    const fromOverlay = overlay?.['skipped'];
    if (Array.isArray(fromOverlay)) return fromOverlay as string[];
    return state?.settings.skipped ?? [];
  }, [overlay, state]);

  const value = useMemo<UseOnboardingReturn>(
    () => ({
      available: true,
      appName: props.appName ?? 'this app',
      state: state ? applyOverlay(state, overlay) : null,
      isLoading,
      isRefreshing,
      error,
      refresh,
      update,
      markWelcomeSeen: (extra) => update({ ...(extra ?? {}), welcomeSeenAt: new Date().toISOString() }),
      dismissChecklist: () => update({ checklistDismissedAt: new Date().toISOString() }),
      dismissAdmin: () => update({ adminDismissedAt: new Date().toISOString() }),
      setSkipped: (stepId, skipped) => {
        const current = new Set(skippedNow());
        if (skipped) current.add(stepId);
        else current.delete(stepId);
        return update({ skipped: current.size > 0 ? [...current] : null });
      },
      reopen: () => update({ welcomeSeenAt: null, checklistDismissedAt: null, adminDismissedAt: null }),
    }),
    [props.appName, state, overlay, isLoading, isRefreshing, error, refresh, update, skippedNow],
  );

  return <OnboardingContext.Provider value={value}>{props.children}</OnboardingContext.Provider>;
}

/**
 * The shell's shared onboarding state, or {@link ONBOARDING_INERT} with no
 * {@link OnboardingProvider} above.
 *
 * @returns the state and its actions.
 *
 * @example
 * ```tsx
 * const { state, markWelcomeSeen } = useOnboarding();
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useOnboarding(): UseOnboardingReturn {
  return useContext(OnboardingContext) ?? ONBOARDING_INERT;
}
