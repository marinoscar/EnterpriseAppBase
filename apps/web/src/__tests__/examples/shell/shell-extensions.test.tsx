/**
 * PP-14.25: an app adds an unread badge, a group and an external link to the
 * navigation, and a high-contrast theme to the shell, with no package edit.
 *
 * `unread-badge.example.tsx` and `high-contrast.theme.ts` are the examples. These
 * render the REAL packaged shell components
 * (`@marinoscar/platform-web/shell/ui`) with the reference app's own destinations
 * plus the example ones, and the real theme provider with the registered mode. They also pin
 * that the reference app's own navigation keeps four destinations on the phone
 * bar (so it has no "More" action) and draws no badge.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { ShellBottomNav, ShellNavigationRail, ShellThemeProvider } from '@marinoscar/platform-web/shell/ui';
import { useShellTheme } from '@marinoscar/platform-web/shell/headless';
import type { ShellNavigation } from '@marinoscar/platform-web/shell/headless';
import { APP_NAVIGATION } from '../../../config/shell';
import { DESTINATIONS } from '../../../config/destinations';
import { lightTheme, darkTheme } from '../../../theme';
import { mockAdminUser, renderWithProviders } from '../../utils/test-utils';
import { HELP_DESTINATION, INBOX_DESTINATION, unreadStore } from '../../../platform-extensions/shell/unread-badge.example';
import {
  HIGH_CONTRAST_MODE_ID,
  highContrastTheme,
  registerHighContrastTheme,
} from '../../../platform-extensions/shell/high-contrast.theme';
import { setViewportWidth } from '../../setup';

const withExamples: ShellNavigation = {
  ...APP_NAVIGATION,
  destinations: [...APP_NAVIGATION.destinations, INBOX_DESTINATION, HELP_DESTINATION],
};

describe('the unread badge, group and external link', () => {
  beforeEach(() => unreadStore.set(0));
  afterEach(() => unreadStore.set(0));

  it('shows the unread count on the rail and updates it live', async () => {
    setViewportWidth(1400);
    renderWithProviders(<ShellNavigationRail navigation={withExamples} />, { wrapperOptions: { user: mockAdminUser } });
    expect(screen.getByRole('link', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.queryByTestId('destination-badge')).toBeNull();

    act(() => unreadStore.set(3));
    const inbox = screen.getByRole('link', { name: 'Inbox (3)' });
    expect(within(inbox).getByTestId('destination-badge')).toHaveTextContent('3');
    // The Inbox sits under its group heading, and the help link opens elsewhere.
    expect(screen.getByText('Work')).toBeInTheDocument();
    const help = screen.getByRole('link', { name: 'Help centre (opens in a new tab)' });
    expect(help).toHaveAttribute('target', '_blank');
    expect(help).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('puts the pinned Console and the help link behind More on the phone bar, and badges the Inbox tab', async () => {
    setViewportWidth(375);
    renderWithProviders(<ShellBottomNav navigation={withExamples} />, { wrapperOptions: { user: mockAdminUser } });
    // An administrator sees Home, User Settings, Console (pinned), Inbox and Help: five. Pinned goes last,
    // so the bar is three tabs and More (the default `maxItems` is 4); Console and Help are in More.
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Home',
      'User Settings',
      'Inbox',
      'More destinations',
    ]);
    act(() => unreadStore.set(2));
    // The unread count shows on the Inbox tab itself; nothing in the sheet is badged, so More has no dot.
    expect(await screen.findByRole('button', { name: 'Inbox (2)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More destinations' }));
    expect(await screen.findByRole('link', { name: 'Console' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Help centre/ })).toBeInTheDocument();
  });

  it('leaves the reference app navigation as it was: at most four destinations, so no More and no badge', () => {
    setViewportWidth(375);
    // The reference app declares four destinations in all (the fourth, AI, needs a deployment feature),
    // which is exactly the default `maxItems`: its phone bar never overflows.
    expect(DESTINATIONS).toHaveLength(4);
    renderWithProviders(<ShellBottomNav navigation={APP_NAVIGATION} />, { wrapperOptions: { user: mockAdminUser } });
    expect(screen.queryByRole('button', { name: /More destinations/ })).toBeNull();
    expect(screen.queryByTestId('destination-badge')).toBeNull();
  });
});

describe('the high-contrast theme mode', () => {
  function Probe() {
    const { mode, theme, setMode, isDarkMode } = useShellTheme();
    return (
      <div>
        <span data-testid="mode">{mode}</span>
        <span data-testid="primary">{theme.palette.primary.main}</span>
        <span data-testid="dark">{String(isDarkMode)}</span>
        <button type="button" onClick={() => setMode(HIGH_CONTRAST_MODE_ID)}>
          high contrast
        </button>
      </div>
    );
  }

  it('is chosen through the shell theme context once registered, and restored on the next visit', async () => {
    registerHighContrastTheme();
    localStorage.removeItem('theme_mode');
    const view = render(
      <MemoryRouter>
        <ShellThemeProvider themes={{ light: lightTheme, dark: darkTheme }}>
          <Probe />
        </ShellThemeProvider>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'high contrast' }));
    expect(screen.getByTestId('mode')).toHaveTextContent(HIGH_CONTRAST_MODE_ID);
    expect(screen.getByTestId('primary')).toHaveTextContent(highContrastTheme.palette.primary.main);
    expect(screen.getByTestId('dark')).toHaveTextContent('true');
    expect(localStorage.getItem('theme_mode')).toBe(HIGH_CONTRAST_MODE_ID);
    // It carries the telemetry token contract like the app's other themes.
    expect(highContrastTheme.palette.status).toBeDefined();
    view.unmount();

    render(
      <MemoryRouter>
        <ShellThemeProvider themes={{ light: lightTheme, dark: darkTheme }}>
          <Probe />
        </ShellThemeProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('mode')).toHaveTextContent(HIGH_CONTRAST_MODE_ID);
    localStorage.removeItem('theme_mode');
  });
});
