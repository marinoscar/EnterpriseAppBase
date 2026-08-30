/**
 * The routed `/settings/*` pages introduced by issue #96, epic #90.
 *
 * PORTED, NOT NEW. `UserSettingsPage.test.tsx` was deleted with the stacked
 * page it covered; the cases below are the ones from that file that still
 * describe live behaviour, re-pointed at the pages that now own it — the
 * loading spinner, the fetch-error alert, and each page's title and
 * description. Everything else in the old file asserted `expect(fn)
 * .toBeDefined()` on a mock, or re-asserted `getByText(/settings/i)` under a
 * `describe` block whose name promised something it never checked; those are
 * dropped rather than carried forward, and `testing-dev` owns the real
 * behavioural coverage this split calls for.
 *
 * `ThemeSettings` and `ProfileSettings` are stubbed: both already have their
 * own test files, and the pages under test here are thin wiring. The stubs
 * expose `disabled` as text and a button that fires the save callback, because
 * a prop is only meaningfully "wired" if something can observe it arriving.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../utils/test-utils';

vi.mock('../../hooks/useUserSettings', () => ({
  useUserSettings: vi.fn(),
}));

vi.mock('../../components/settings/ThemeSettings', () => ({
  ThemeSettings: vi.fn(({ currentTheme, onThemeChange, disabled }) => (
    <div data-testid="theme-settings">
      <span>theme:{currentTheme}</span>
      <span>disabled:{String(disabled)}</span>
      <button onClick={() => onThemeChange('dark')}>save-theme</button>
    </div>
  )),
}));

vi.mock('../../components/settings/ProfileSettings', () => ({
  ProfileSettings: vi.fn(({ profile, onSave, disabled }) => (
    <div data-testid="profile-settings">
      <span>name:{profile.displayName ?? ''}</span>
      <span>disabled:{String(disabled)}</span>
      <button onClick={() => onSave({ displayName: 'New', useProviderImage: true })}>
        save-profile
      </button>
    </div>
  )),
}));

import { useUserSettings } from '../../hooks/useUserSettings';
import UserProfilePage from '../../pages/UserProfilePage';
import UserAppearancePage from '../../pages/UserAppearancePage';

const mockUseUserSettings = vi.mocked(useUserSettings);

function mockSettings(overrides: Partial<ReturnType<typeof useUserSettings>> = {}) {
  mockUseUserSettings.mockReturnValue({
    settings: {
      theme: 'system',
      profile: {
        displayName: undefined,
        useProviderImage: true,
        customImageUrl: undefined,
      },
      updatedAt: new Date().toISOString(),
      version: 1,
    },
    isLoading: false,
    error: null,
    isSaving: false,
    updateSettings: vi.fn().mockResolvedValue(undefined),
    updateTheme: vi.fn().mockResolvedValue(undefined),
    updateProfile: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn(),
    ...overrides,
  });
}

describe('UserSettingsSection chrome (ported from UserSettingsPage.test.tsx)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings();
  });

  it('shows a loading spinner while fetching settings', () => {
    mockSettings({ settings: null, isLoading: true });

    render(<UserAppearancePage />);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('displays the fetch error when the settings request failed', () => {
    mockSettings({ settings: null, error: 'Failed to load settings' });

    render(<UserAppearancePage />);

    expect(screen.getByText(/failed to load settings/i)).toBeInTheDocument();
  });

  it('passes isSaving through to the section component as disabled', () => {
    mockSettings({ isSaving: true });

    render(<UserProfilePage />);

    expect(screen.getByText('disabled:true')).toBeInTheDocument();
  });
});

describe('UserAppearancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings();
  });

  it('displays its title and description', () => {
    render(<UserAppearancePage />);

    expect(screen.getByRole('heading', { name: /appearance/i })).toBeInTheDocument();
    expect(
      screen.getByText(/choose a light, dark, or system-matched theme/i),
    ).toBeInTheDocument();
  });

  it('renders ThemeSettings with the current theme', () => {
    render(<UserAppearancePage />);

    expect(screen.getByTestId('theme-settings')).toBeInTheDocument();
    expect(screen.getByText('theme:system')).toBeInTheDocument();
  });
});

describe('UserProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings();
  });

  it('displays its title and description', () => {
    render(<UserProfilePage />);

    expect(screen.getByRole('heading', { name: /profile/i })).toBeInTheDocument();
    expect(screen.getByText(/your display name and profile image/i)).toBeInTheDocument();
  });

  it('renders ProfileSettings, and not the appearance section', () => {
    render(<UserProfilePage />);

    expect(screen.getByTestId('profile-settings')).toBeInTheDocument();
    expect(screen.queryByTestId('theme-settings')).not.toBeInTheDocument();
  });
});
