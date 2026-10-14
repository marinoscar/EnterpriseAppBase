// The shell's components (issue #868). The reference app's suites
// (apps/web/src/__tests__/components/{common,navigation}/) still run every
// surface through the app's bindings in depth; these pin the package-level
// contract: the five breakpoint gates, the slots, the drill-down, Console
// mode, the user menu and the theme provider.

import { act, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetSettingsFeaturesForTests } from '../../src/settings/headless/features.js';
import { registerSettingsFeature } from '../../src/settings/headless/index.js';
import { createShellTheme, useShellTheme } from '../../src/shell/headless/index.js';
import {
  RAIL_WIDTH_COLLAPSED,
  ShellAppBar,
  ShellBottomNav,
  ShellLayout,
  ShellNavigationRail,
  ShellRoot,
  ShellThemeProvider,
  ShellUserMenu,
} from '../../src/shell/ui/index.js';
import { setViewportWidth } from '../viewport.js';
import { ADMIN, NAVIGATION, emittedRulesFor, railPreference, renderShell } from './fixtures.js';

const PHONE = 375;
const TABLET = 800;
const DESKTOP = 1400;

beforeEach(() => {
  railPreference.railCollapsed = false;
  railPreference.toggleRailCollapsed.mockClear();
  resetSettingsFeaturesForTests();
});

describe('ShellLayout: the five coupled breakpoint gates', () => {
  const slots = {
    appBar: <div data-testid="bar" />,
    rail: <div data-testid="rail" />,
    bottomNav: <div data-testid="bottom" />,
  };

  it.each([
    ['phone', PHONE, 'bottom', 'rail'],
    ['tablet', TABLET, 'rail', 'bottom'],
    ['desktop', DESKTOP, 'rail', 'bottom'],
  ])('mounts exactly one navigation surface at %s width', (_label, width, present, absent) => {
    setViewportWidth(width);
    renderShell(<ShellLayout {...slots}><p>page</p></ShellLayout>);
    expect(screen.getByTestId(present)).toBeInTheDocument();
    expect(screen.queryByTestId(absent)).not.toBeInTheDocument();
  });

  it('swaps the bottom bar for the rail at exactly 600px (sm), never 900px', async () => {
    setViewportWidth(599);
    renderShell(<ShellLayout {...slots}><p>page</p></ShellLayout>);
    expect(screen.getByTestId('bottom')).toBeInTheDocument();

    await act(async () => setViewportWidth(600));
    expect(screen.getByTestId('rail')).toBeInTheDocument();
    expect(screen.queryByTestId('bottom')).not.toBeInTheDocument();

    for (const width of [599, 600, 899, 900, 1200]) {
      await act(async () => setViewportWidth(width));
      expect([screen.queryByTestId('rail'), screen.queryByTestId('bottom')].filter(Boolean)).toHaveLength(1);
    }
  });

  it('clears the fixed bottom bar below sm and drops that padding at sm (gate 3)', () => {
    setViewportWidth(PHONE);
    renderShell(<ShellLayout {...slots}><p>page</p></ShellLayout>);
    const main = screen.getByRole('main');
    const rules = emittedRulesFor(main);
    expect(rules).toMatch(/@media \(min-width:0px\)\{[^}]*padding-bottom:80px/);
    expect(rules).toMatch(/@media \(min-width:600px\)\{[^}]*padding-bottom:24px/);
    expect(getComputedStyle(main).minWidth).toBe('0px');
  });

  it('renders the banners above the page and the overlays after the bottom bar', () => {
    setViewportWidth(PHONE);
    renderShell(
      <ShellLayout {...slots} banners={<div data-testid="banner" />} overlays={<div data-testid="overlay" />}>
        <p data-testid="page">page</p>
      </ShellLayout>,
    );
    const main = screen.getByRole('main');
    expect(main.firstElementChild).toBe(screen.getByTestId('banner'));
    expect(within(main).getByTestId('page')).toBeInTheDocument();
    expect(screen.getByTestId('bottom').nextElementSibling).toBe(screen.getByTestId('overlay'));
  });

  it('builds the default AppBar, rail and bottom bar from the navigation', async () => {
    setViewportWidth(DESKTOP);
    renderShell(<ShellLayout navigation={NAVIGATION} brand="Acme"><p>page</p></ShellLayout>);
    expect(screen.getByRole('banner')).toHaveTextContent('Acme');
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();

    await act(async () => setViewportWidth(PHONE));
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
  });

  it('says which slot needs the navigation when it is missing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderShell(<ShellLayout rail={<div />} bottomNav={<div />} />)).toThrow(/`appBar` slot/);
    vi.mocked(console.error).mockRestore();
  });
});

describe('ShellAppBar (gate 5)', () => {
  it('shows the brand, which goes home, and the actions and wide actions outside the drill-down', async () => {
    setViewportWidth(DESKTOP);
    renderShell(
      <ShellAppBar
        navigation={NAVIGATION}
        brand="Acme"
        actions={<button type="button">Bell</button>}
        wideActions={<button type="button">Org</button>}
        userMenu={<span data-testid="menu" />}
      />,
      { route: '/admin/settings/users' },
    );
    expect(screen.getByRole('button', { name: 'Bell' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Org' })).toBeInTheDocument();
    expect(screen.getByTestId('menu')).toBeInTheDocument();
    // No theme toggle without a ShellThemeProvider.
    expect(screen.queryByRole('button', { name: 'toggle theme' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Acme'));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
  });

  it('drills down below sm on a settings route: back arrow, card title, no wide actions', async () => {
    setViewportWidth(PHONE);
    renderShell(
      <ShellAppBar
        navigation={NAVIGATION}
        brand="Acme"
        actions={<button type="button">Bell</button>}
        wideActions={<button type="button">Org</button>}
        userMenu={<span />}
      />,
      { route: '/admin/settings/jobs/insights' },
    );
    expect(screen.queryByText('Acme')).not.toBeInTheDocument();
    // The longest matching card wins.
    expect(screen.getByText('Job Insights')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bell' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Org' })).not.toBeInTheDocument();

    // UP one level, to the surface's hub, never history.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/settings');
  });

  it("goes home from a hub's own drill-down, and keeps the brand off settings routes", async () => {
    setViewportWidth(PHONE);
    renderShell(<ShellAppBar navigation={NAVIGATION} brand="Acme" userMenu={<span />} />, { route: '/settings' });
    expect(screen.getByText('Settings')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });

  it('keeps the brand at sm and up on a settings route', () => {
    setViewportWidth(600);
    renderShell(<ShellAppBar navigation={NAVIGATION} brand="Acme" userMenu={<span />} />, { route: '/settings/profile' });
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });

  it('draws the theme toggle under a ShellThemeProvider and flips the mode', async () => {
    setViewportWidth(DESKTOP);
    localStorage.removeItem('theme_mode');
    function Mode() {
      return <span data-testid="mode">{useShellTheme().mode}</span>;
    }
    renderShell(<ShellAppBar navigation={NAVIGATION} brand="Acme" userMenu={<span />} />, {
      wrap: (children) => (
        <ShellThemeProvider themes={{ light: createShellTheme('light'), dark: createShellTheme('dark') }}>
          {children}
          <Mode />
        </ShellThemeProvider>
      ),
    });
    await userEvent.click(screen.getByRole('button', { name: 'toggle theme' }));
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
    expect(localStorage.getItem('theme_mode')).toBe('dark');
  });
});

describe('ShellBottomNav (gate 2)', () => {
  it('renders nothing at sm and up, even when mounted', () => {
    setViewportWidth(600);
    renderShell(<ShellBottomNav navigation={NAVIGATION} />);
    expect(screen.queryByRole('button', { name: 'Home' })).not.toBeInTheDocument();
  });

  it('shows the visible destinations with compact labels and full accessible names', async () => {
    setViewportWidth(PHONE);
    renderShell(<ShellBottomNav navigation={NAVIGATION} />, { route: '/settings/profile' });
    expect(screen.getByRole('button', { name: 'User Settings' })).toHaveTextContent('Settings');
    expect(screen.getByRole('button', { name: 'User Settings' })).toHaveClass('Mui-selected');
    // The viewer holds neither Console permission.
    expect(screen.queryByRole('button', { name: 'Console' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
  });

  it('hides a destination whose feature is off, and shows it when on', () => {
    setViewportWidth(PHONE);
    const gated = {
      ...NAVIGATION,
      destinations: [...NAVIGATION.destinations, { ...NAVIGATION.destinations[0]!, key: 'ai', label: 'AI', path: '/ai', feature: 'ai' as const }],
    };
    renderShell(<ShellBottomNav navigation={gated} />);
    expect(screen.queryByRole('button', { name: 'AI' })).not.toBeInTheDocument();
  });
});

describe('ShellNavigationRail', () => {
  it('is collapsed at the medium tier whatever the preference, and has no toggle there', () => {
    setViewportWidth(TABLET);
    renderShell(<ShellNavigationRail navigation={NAVIGATION} />, { user: ADMIN });
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(getComputedStyle(nav).width).toBe(`${RAIL_WIDTH_COLLAPSED}px`);
    expect(screen.queryByRole('button', { name: /collapse navigation/i })).not.toBeInTheDocument();
  });

  it('pins the Console at the foot and marks the active destination', () => {
    setViewportWidth(DESKTOP);
    renderShell(<ShellNavigationRail navigation={NAVIGATION} />, { user: ADMIN, route: '/settings/profile' });
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual(['Home', 'User Settings', 'Console']);
    expect(screen.getByRole('link', { name: 'User Settings' })).toHaveAttribute('aria-current', 'page');
  });

  it('swaps to Console mode on an admin route when expanded: back row and the visible cards', () => {
    setViewportWidth(DESKTOP);
    renderShell(<ShellNavigationRail navigation={NAVIGATION} />, { user: ADMIN, route: '/admin/settings/jobs/insights' });
    expect(screen.getByRole('navigation', { name: 'Console navigation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to library' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Job Insights' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Jobs' })).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('link', { name: 'Console' })).not.toBeInTheDocument();
  });

  it('stays the library rail on an admin route when the desktop rail is collapsed', async () => {
    setViewportWidth(DESKTOP);
    railPreference.railCollapsed = true;
    renderShell(<ShellNavigationRail navigation={NAVIGATION} />, { user: ADMIN, route: '/admin/settings/users' });
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Expand navigation' }));
    expect(railPreference.toggleRailCollapsed).toHaveBeenCalledTimes(1);
  });
});

describe('ShellUserMenu', () => {
  it('lists the visible destinations except home, the items slot, sign-out and the footer', async () => {
    const onItem = vi.fn();
    const { logout } = renderShell(
      <ShellUserMenu
        navigation={NAVIGATION}
        items={(close) => (
          <li>
            <button type="button" onClick={() => { onItem(); close(); }}>Extra</button>
          </li>
        )}
        footer={<li data-testid="footer">Version 1</li>}
      />,
      { user: ADMIN },
    );
    await userEvent.click(screen.getByRole('button'));
    const menu = screen.getByRole('menu');
    expect(within(menu).queryByText('Home')).not.toBeInTheDocument();
    expect(within(menu).getByText('User Settings')).toBeInTheDocument();
    expect(within(menu).getByText('Console')).toBeInTheDocument();
    expect(within(menu).getByTestId('footer')).toHaveTextContent('Version 1');

    await userEvent.click(within(menu).getByText('Logout'));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('renders nothing without a signed-in user', () => {
    renderShell(<ShellUserMenu navigation={NAVIGATION} />, { user: null });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('ShellRoot and ShellThemeProvider', () => {
  it('applies the resolved theme and honours a stored choice', () => {
    localStorage.setItem('acme_theme', 'dark');
    function Palette() {
      return <span data-testid="palette">{useTheme().palette.mode}</span>;
    }
    renderShell(<Palette />, {
      wrap: (children) => (
        <ShellRoot storageKey="acme_theme" themes={{ light: createShellTheme('light'), dark: createShellTheme('dark') }}>
          {children}
        </ShellRoot>
      ),
    });
    expect(screen.getByTestId('palette')).toHaveTextContent('dark');
    localStorage.removeItem('acme_theme');
  });

  it('useShellTheme throws outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Reader() {
      useShellTheme();
      return null;
    }
    expect(() => renderShell(<Reader />)).toThrow(/ShellThemeProvider/);
    vi.mocked(console.error).mockRestore();
  });
});

describe('the feature map', () => {
  it('shows a feature-gated destination when its resolver says on', () => {
    registerSettingsFeature('ai', () => true);
    setViewportWidth(PHONE);
    const gated = {
      ...NAVIGATION,
      destinations: [...NAVIGATION.destinations, { ...NAVIGATION.destinations[0]!, key: 'ai', label: 'AI', path: '/ai', feature: 'ai' as const }],
    };
    renderShell(<ShellBottomNav navigation={gated} />);
    expect(screen.getByRole('button', { name: 'AI' })).toBeInTheDocument();
  });
});
