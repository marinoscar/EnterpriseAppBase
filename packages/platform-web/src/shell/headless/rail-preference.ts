// =============================================================================
// `user_settings.navigation` - the rail's collapse preference (issue #868;
// moved from the reference app's `hooks/useNavigationPrefs.ts`, issue #55)
// =============================================================================
//
// No endpoint of its own: the same `GET`/`PATCH /api/user-settings` the
// settings slice's `useUserSettings` uses. The API merges the `navigation`
// namespace field-wise, so only the changed field goes on the wire.
//
// TWO CONTRACTS THIS FILE HOLDS
//
// 1. ABSENT MEANS DEFAULT, and a default is never written back. An absent
//    namespace or field means "rail expanded"; we never PATCH that on load, so
//    a later change to the default still reaches users who never touched it.
//    The read is `=== true`: absent and an explicit `false` both mean expanded.
// 2. THE TOGGLE IS OPTIMISTIC. The overlay is cleared once the write settles,
//    at which point the stored value either carries the new value (success) or
//    the old one (failure): the revert is the same path as the commit.
// =============================================================================

import { useCallback, useMemo, useRef, useState } from 'react';

import type { PlatformApiClient } from '../../core/index.js';
import { useUserSettings } from '../../settings/index.js';
import type { UserSettingsDocument, UserSettingsUpdateBase } from '../../settings/index.js';
import { useIsMounted } from '../internal/use-is-mounted.js';
import type { ShellRailPreference } from './navigation.js';

interface NavigationDocument extends UserSettingsDocument {
  navigation?: { railCollapsed?: boolean } | null;
}

interface NavigationUpdate extends UserSettingsUpdateBase {
  navigation?: { railCollapsed?: boolean | null };
}

/**
 * Options of {@link useShellRailPreference}.
 *
 * @stability experimental
 */
export interface ShellRailPreferenceOptions {
  /** The transport. Default: the platform host's (`PlatformHostProvider`). */
  api?: PlatformApiClient;
}

/**
 * What {@link useShellRailPreference} returns.
 *
 * @stability experimental
 */
export interface UseShellRailPreferenceResult extends ShellRailPreference {
  /** True until the first settings read resolves; the rail renders the default meanwhile. */
  isLoading: boolean;
}

/**
 * The desktop rail's collapse preference, stored in the viewer's `navigation`
 * user-settings namespace (`railCollapsed`). Optimistic toggle; a default is
 * never written back. Never syncs the stored theme (it is mounted by
 * always-present chrome, where a sync would stamp over the AppBar's toggle).
 *
 * @param options - an explicit transport, else the platform host's.
 * @returns the preference, its toggle and whether it has loaded.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useShellRailPreference(options: ShellRailPreferenceOptions = {}): UseShellRailPreferenceResult {
  const { settings, isLoading, updateSettings } = useUserSettings<NavigationDocument, NavigationUpdate>({
    syncTheme: false,
    ...(options.api === undefined ? {} : { api: options.api }),
  });
  const isMounted = useIsMounted();

  // What the server says; absent anywhere collapses to the default.
  const stored = useMemo(() => ({ railCollapsed: settings?.navigation?.railCollapsed === true }), [settings]);

  const [overlay, setOverlay] = useState<{ railCollapsed: boolean } | null>(null);
  // Guards against a late write from a PREVIOUS click clearing a NEWER overlay.
  const writeSeq = useRef(0);

  const effective = overlay ?? stored;

  const toggleRailCollapsed = useCallback(() => {
    // No settings yet means no `version` for If-Match, so the write would
    // no-op; skipping the overlay too keeps the UI honest.
    if (!settings) return;

    const railCollapsed = !effective.railCollapsed;
    const seq = ++writeSeq.current;
    setOverlay({ railCollapsed });

    void updateSettings({ navigation: { railCollapsed } })
      .catch(() => undefined)
      .finally(() => {
        if (!isMounted()) return;
        if (writeSeq.current !== seq) return;
        setOverlay(null);
      });
  }, [settings, effective, updateSettings, isMounted]);

  return { railCollapsed: effective.railCollapsed, toggleRailCollapsed, isLoading };
}
