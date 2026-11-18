/**
 * `user_settings.navigation` — the navigation rail's collapse preference.
 *
 * Issue #55, epic #51; the hook itself is the packaged shell's
 * `useShellRailPreference` since #868 (`@marinoscar/platform-web/shell/headless`),
 * which holds its two contracts: ABSENT MEANS DEFAULT and a default is never
 * written back, and the toggle is OPTIMISTIC (a late write from an earlier
 * click cannot clear a newer overlay). It never syncs the stored theme: it is
 * mounted by the always-present rail, where a sync would stamp over the
 * AppBar's light/dark toggle.
 *
 * This binding supplies the app's transport (`appPlatformApi`), the same one
 * `hooks/useUserSettings` passes, and is what `config/shell.ts` hands the rail
 * as `useRailPreference`.
 */
import { useShellRailPreference } from '@marinoscar/platform-web/shell/headless';
import type { UseShellRailPreferenceResult } from '@marinoscar/platform-web/shell/headless';

import { appPlatformApi } from '../platform/platformHost';

export type UseNavigationPrefsResult = UseShellRailPreferenceResult;

export function useNavigationPrefs(): UseNavigationPrefsResult {
  return useShellRailPreference({ api: appPlatformApi });
}
