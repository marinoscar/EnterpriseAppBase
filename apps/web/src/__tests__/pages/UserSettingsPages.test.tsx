/**
 * Issue #96. `UserTokensPage` is the one `/settings/*` page that does NOT
 * wrap its content in `UserSettingsSection`. The Profile and Appearance pages
 * (and that wrapper) are the settings slice's since #892; their suites live in
 * packages/platform-web/test/settings/ui.
 *
 * The Access Tokens page is packaged (#727, `@marinoscar/platform-web/identity/ui`);
 * its composition (title, the token list) is covered in the package's
 * `test/identity/user-tokens-page.test.tsx`. Here it renders for real, over
 * the app's identity adapters, to prove the one property this file owns: it
 * never waits on `useUserSettings`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../utils/test-utils';

vi.mock('../../hooks/useUserSettings', () => ({
  useUserSettings: vi.fn(),
}));

import { useUserSettings } from '../../hooks/useUserSettings';
import { UserTokensPage } from '@marinoscar/platform-web/identity/ui';

const mockUseUserSettings = vi.mocked(useUserSettings);

describe('UserTokensPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never calls useUserSettings — it is not wrapped in UserSettingsSection', () => {
    // Mocked to be perpetually loading, so that if this page were ever
    // (re)wrapped in `UserSettingsSection` it would render a spinner instead
    // of the page — the failure this test exists to catch.
    mockUseUserSettings.mockReturnValue({
      settings: null,
      isLoading: true,
      error: null,
      isSaving: false,
      updateSettings: vi.fn(),
      updateTheme: vi.fn(),
      updateProfile: vi.fn(),
      refresh: vi.fn(),
      replaceSettings: vi.fn(),
    });

    render(<UserTokensPage />);

    expect(mockUseUserSettings).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Access Tokens' })).toBeInTheDocument();
  });
});
