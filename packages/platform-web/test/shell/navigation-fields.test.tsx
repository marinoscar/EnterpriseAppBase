// The destination fields and the bottom bar's overflow (PP-14.25): `badge`,
// `group`, `external` and `onClick` on every surface, and `maxItems` with the
// "More" sheet. The markup of a navigation that uses none of them is pinned
// by ShellNavigation.builtin-dom.test.tsx.

import HomeIcon from '@mui/icons-material/Home';
import InboxIcon from '@mui/icons-material/Inbox';
import SettingsIcon from '@mui/icons-material/Settings';
import StarIcon from '@mui/icons-material/Star';
import HelpIcon from '@mui/icons-material/Help';
import PeopleIcon from '@mui/icons-material/People';
import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetSettingsFeaturesForTests } from '../../src/settings/headless/features.js';
import { isDestinationVisible, isExternalUrl } from '../../src/shell/headless/index.js';
import type { ShellDestination, ShellNavigation } from '../../src/shell/headless/index.js';
import { ShellBottomNav, ShellNavigationRail, ShellUserMenu } from '../../src/shell/ui/index.js';
import { setViewportWidth } from '../viewport.js';
import { USER } from '../identity/harness.js';
import { railPreference, renderShell } from './fixtures.js';

const PHONE = 375;
const TABLET = 800;
const DESKTOP = 1400;

const home: ShellDestination = { key: 'home', label: 'Home', compactLabel: 'Home', Icon: HomeIcon, path: '/' };
const settings: ShellDestination = { key: 'settings', label: 'User Settings', compactLabel: 'Settings', Icon: SettingsIcon, path: '/settings' };
const inbox = (extra: Partial<ShellDestination> = {}): ShellDestination => ({
  key: 'inbox',
  label: 'Inbox',
  compactLabel: 'Inbox',
  Icon: InboxIcon,
  path: '/inbox',
  ...extra,
});
const people: ShellDestination = { key: 'people', label: 'People', compactLabel: 'People', Icon: PeopleIcon, path: '/people' };
const starred: ShellDestination = { key: 'starred', label: 'Starred', compactLabel: 'Starred', Icon: StarIcon, path: '/starred' };

const nav = (...destinations: ShellDestination[]): ShellNavigation => ({
  destinations,
  useRailPreference: () => railPreference,
});

beforeEach(() => {
  railPreference.railCollapsed = false;
  resetSettingsFeaturesForTests();
});

describe('destination.badge', () => {
  it('draws a count on the rail icon and adds it to the accessible name', () => {
    setViewportWidth(DESKTOP);
    renderShell(<ShellNavigationRail navigation={nav(home, inbox({ badge: () => 3 }))} />, { user: USER });
    const link = screen.getByRole('link', { name: 'Inbox (3)' });
    expect(within(link).getByTestId('destination-badge')).toHaveTextContent('3');
    // A destination without a badge has none and keeps its plain name.
    expect(within(screen.getByRole('link', { name: 'Home' })).queryByTestId('destination-badge')).not.toBeInTheDocument();
  });

  it('draws nothing for 0, null, false and the empty string', () => {
    setViewportWidth(DESKTOP);
    renderShell(
      <ShellNavigationRail
        navigation={nav(
          inbox({ key: 'a', label: 'A', badge: () => 0 }),
          inbox({ key: 'b', label: 'B', badge: () => null }),
          inbox({ key: 'c', label: 'C', badge: () => false }),
          inbox({ key: 'd', label: 'D', badge: () => '' }),
        )}
      />,
    );
    expect(screen.queryByTestId('destination-badge')).not.toBeInTheDocument();
  });

  it('may call hooks: it is evaluated inside a component that exists once per destination', async () => {
    setViewportWidth(DESKTOP);
    function useCounter(): number {
      const [count] = useState(7);
      return count;
    }
    renderShell(<ShellNavigationRail navigation={nav(home, inbox({ badge: useCounter }))} />);
    expect(screen.getByRole('link', { name: 'Inbox (7)' })).toBeInTheDocument();
  });

  it('shows on the bottom bar and in the user menu too', async () => {
    setViewportWidth(PHONE);
    const navigation = nav(home, inbox({ badge: () => 12 }));
    const { unmount } = renderShell(<ShellBottomNav navigation={navigation} />);
    expect(screen.getByRole('button', { name: 'Inbox (12)' })).toBeInTheDocument();
    unmount();

    setViewportWidth(DESKTOP);
    renderShell(<ShellUserMenu navigation={nav(home, inbox({ badge: () => 12 }))} />);
    await userEvent.click(screen.getByRole('button'));
    const item = await screen.findByRole('menuitem', { name: 'Inbox (12)' });
    expect(within(item).getByTestId('destination-badge')).toHaveTextContent('12');
  });
});

describe('destination.group', () => {
  const grouped = nav(
    home,
    inbox({ key: 'a', label: 'Alpha', group: 'Work' }),
    inbox({ key: 'b', label: 'Beta', group: 'Work', path: '/b' }),
    inbox({ key: 'c', label: 'Gamma', group: 'Personal', path: '/c' }),
    inbox({ key: 'd', label: 'Delta', path: '/d' }),
  );

  it('prints the group name above each run in the expanded rail and keeps declaration order', () => {
    setViewportWidth(DESKTOP);
    renderShell(<ShellNavigationRail navigation={grouped} />);
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('Personal')).toBeInTheDocument();
    const names = screen.getAllByRole('link').map((link) => link.getAttribute('aria-label'));
    expect(names).toEqual(['Home', 'Alpha', 'Beta', 'Gamma', 'Delta']);
    expect(screen.getByRole('list', { name: 'Work' })).toBeInTheDocument();
  });

  it('separates the runs with a divider in the collapsed rail, with no heading', () => {
    setViewportWidth(TABLET);
    renderShell(<ShellNavigationRail navigation={grouped} />);
    expect(screen.queryByText('Work')).not.toBeInTheDocument();
    // home | Work | Personal | ungrouped = three separators between four runs
    expect(screen.getAllByRole('separator').length).toBeGreaterThanOrEqual(3);
  });

  it('is ignored by the bottom bar tabs', () => {
    setViewportWidth(PHONE);
    renderShell(<ShellBottomNav navigation={nav(home, inbox({ group: 'Work' }))} />);
    expect(screen.queryByText('Work')).not.toBeInTheDocument();
  });
});

describe('destination.external', () => {
  const help = (extra: Partial<ShellDestination> = {}): ShellDestination => ({
    key: 'help',
    label: 'Help centre',
    compactLabel: 'Help',
    Icon: HelpIcon,
    path: 'https://help.example.com/start',
    external: true,
    ...extra,
  });

  it('is a plain link to another site, opened in a new tab without an opener, on the rail', () => {
    setViewportWidth(DESKTOP);
    renderShell(<ShellNavigationRail navigation={nav(home, help())} />);
    const link = screen.getByRole('link', { name: 'Help centre (opens in a new tab)' });
    expect(link).toHaveAttribute('href', 'https://help.example.com/start');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).not.toHaveAttribute('aria-current');
  });

  it('is an anchor on the bottom bar and in the user menu, and never the active tab', async () => {
    setViewportWidth(PHONE);
    const navigation = nav(home, help());
    const { unmount } = renderShell(<ShellBottomNav navigation={navigation} />, { route: '/' });
    const tab = screen.getByRole('link', { name: 'Help centre (opens in a new tab)' });
    expect(tab).toHaveAttribute('target', '_blank');
    expect(tab).toHaveAttribute('rel', 'noopener noreferrer');
    expect(tab).not.toHaveClass('Mui-selected');
    unmount();

    setViewportWidth(DESKTOP);
    renderShell(<ShellUserMenu navigation={nav(home, help())} />);
    await userEvent.click(screen.getByRole('button'));
    const item = await screen.findByRole('menuitem', { name: 'Help centre (opens in a new tab)' });
    expect(item).toHaveAttribute('href', 'https://help.example.com/start');
  });

  it('is not drawn at all when its path is not an http(s) URL (fail closed)', () => {
    expect(isExternalUrl('https://example.com')).toBe(true);
    expect(isExternalUrl('http://example.com/x')).toBe(true);
    expect(isExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isExternalUrl('data:text/html,<b>x</b>')).toBe(false);
    expect(isExternalUrl('/relative')).toBe(false);
    expect(isExternalUrl(undefined)).toBe(false);
    const allow = () => true;
    expect(isDestinationVisible(help(), allow)).toBe(true);
    expect(isDestinationVisible(help({ path: 'javascript:alert(1)' }), allow)).toBe(false);
    expect(isDestinationVisible(help({ path: '/inside' }), allow)).toBe(false);

    setViewportWidth(DESKTOP);
    renderShell(<ShellNavigationRail navigation={nav(home, help({ path: 'javascript:alert(1)' }))} />);
    expect(screen.queryByRole('link', { name: /Help centre/ })).not.toBeInTheDocument();
  });
});

describe('destination.onClick', () => {
  it('runs before the shell navigates, and preventDefault cancels the navigation (rail, bar, menu)', async () => {
    const palette = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    const palettes = nav(home, { ...settings, key: 'palette', label: 'Command palette', compactLabel: 'Palette', path: '/palette', onClick: palette });

    setViewportWidth(DESKTOP);
    const first = renderShell(<ShellNavigationRail navigation={palettes} />);
    await userEvent.click(screen.getByRole('link', { name: 'Command palette' }));
    expect(palette).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
    first.unmount();

    setViewportWidth(PHONE);
    const second = renderShell(<ShellBottomNav navigation={palettes} />);
    await userEvent.click(screen.getByRole('button', { name: 'Command palette' }));
    expect(palette).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
    second.unmount();

    setViewportWidth(DESKTOP);
    renderShell(<ShellUserMenu navigation={palettes} />);
    await userEvent.click(screen.getByRole('button'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Command palette' }));
    expect(palette).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
  });

  it('lets the navigation happen when the handler does not cancel it', async () => {
    const seen = vi.fn();
    setViewportWidth(PHONE);
    renderShell(<ShellBottomNav navigation={nav(home, { ...settings, onClick: seen })} />);
    await userEvent.click(screen.getByRole('button', { name: 'User Settings' }));
    expect(seen).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('where')).toHaveTextContent('/settings');
  });
});

describe('ShellBottomNav maxItems and the More sheet', () => {
  const five = nav(home, settings, people, starred, inbox());

  it('draws every tab up to maxItems (default 4), with no More action', () => {
    setViewportWidth(PHONE);
    renderShell(<ShellBottomNav navigation={nav(home, settings, people, starred)} />);
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'More destinations' })).not.toBeInTheDocument();
  });

  it('draws maxItems - 1 tabs and a More action when there are more destinations', () => {
    setViewportWidth(PHONE);
    renderShell(<ShellBottomNav navigation={five} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Home', 'User Settings', 'People', 'More destinations']);
    expect(screen.queryByRole('button', { name: 'Starred' })).not.toBeInTheDocument();
  });

  it('opens a sheet with the rest, navigates from it and closes', async () => {
    setViewportWidth(PHONE);
    renderShell(<ShellBottomNav navigation={five} />);
    await userEvent.click(screen.getByRole('button', { name: 'More destinations' }));
    const sheet = await screen.findByRole('navigation', { name: 'More destinations' });
    expect(within(sheet).getAllByRole('link').map((link) => link.getAttribute('aria-label'))).toEqual(['Starred', 'Inbox']);
    await userEvent.click(within(sheet).getByRole('link', { name: 'Inbox' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/inbox');
  });

  it('marks More as the selected tab when the active destination is in the sheet', () => {
    setViewportWidth(PHONE);
    renderShell(<ShellBottomNav navigation={five} />, { route: '/starred' });
    expect(screen.getByRole('button', { name: 'More destinations' })).toHaveClass('Mui-selected');
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveClass('Mui-selected');
  });

  it('honours a larger maxItems and never goes below 2', () => {
    setViewportWidth(PHONE);
    const wide = renderShell(<ShellBottomNav navigation={five} maxItems={5} />);
    expect(screen.getAllByRole('button')).toHaveLength(5);
    expect(screen.queryByRole('button', { name: 'More destinations' })).not.toBeInTheDocument();
    wide.unmount();

    renderShell(<ShellBottomNav navigation={five} maxItems={1} />);
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Home', 'More destinations']);
  });

  it('shows a dot on More when a destination in the sheet has a badge, and a count inside the sheet', async () => {
    setViewportWidth(PHONE);
    const withBadge = nav(home, settings, people, starred, inbox({ badge: () => 2 }));
    renderShell(<ShellBottomNav navigation={withBadge} />);
    expect(await screen.findByRole('button', { name: 'More destinations (new activity)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More destinations (new activity)' }));
    expect(await screen.findByRole('link', { name: 'Inbox (2)' })).toBeInTheDocument();
  });

  it('groups the destinations of the sheet under their heading', async () => {
    setViewportWidth(PHONE);
    renderShell(
      <ShellBottomNav
        navigation={nav(home, settings, people, { ...starred, group: 'Saved' }, inbox({ group: 'Saved' }))}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'More destinations' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('adds no surface above sm: at tablet width the bar renders nothing and neither does the sheet', () => {
    setViewportWidth(TABLET);
    renderShell(<ShellBottomNav navigation={five} />);
    expect(screen.queryByRole('button', { name: 'More destinations' })).not.toBeInTheDocument();
  });
});
