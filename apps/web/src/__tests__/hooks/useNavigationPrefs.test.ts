import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * The hook's contracts (absent means default and is never written back; the
 * toggle is optimistic and sequence-guarded; no settings, no write; no theme
 * sync) are the packaged shell's since #868 and are pinned in
 * `packages/platform-web/test/shell/rail-preference.test.ts`. What is THIS
 * app's is the binding: the app's transport, the `navigation` namespace, and
 * no theme sync from the always-present rail.
 */

vi.mock('@marinoscar/platform-web/settings/headless', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@marinoscar/platform-web/settings/headless')>()),
  useUserSettings: vi.fn(),
}));

import { useUserSettings } from '@marinoscar/platform-web/settings/headless';
import { useNavigationPrefs } from '../../hooks/useNavigationPrefs';
import { appPlatformApi } from '../../platform/platformHost';

const mockUseUserSettings = vi.mocked(useUserSettings);
const updateSettings = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  mockUseUserSettings.mockReturnValue({
    settings: { theme: 'system', profile: { imageSource: 'provider' }, navigation: { railCollapsed: true }, version: 3 } as never,
    isLoading: false,
    error: null,
    isSaving: false,
    updateSettings,
    updateTheme: vi.fn(),
    updateProfile: vi.fn(),
    refresh: vi.fn(),
    replaceSettings: vi.fn(),
  });
});

describe('useNavigationPrefs (the app binding of useShellRailPreference)', () => {
  it("reads through the app's transport and never syncs the theme", () => {
    renderHook(() => useNavigationPrefs());

    expect(mockUseUserSettings).toHaveBeenCalledWith({ syncTheme: false, api: appPlatformApi });
  });

  it('reads and writes the navigation namespace', () => {
    const { result } = renderHook(() => useNavigationPrefs());
    expect(result.current.railCollapsed).toBe(true);

    act(() => result.current.toggleRailCollapsed());

    expect(updateSettings).toHaveBeenCalledWith({ navigation: { railCollapsed: false } });
  });
});
