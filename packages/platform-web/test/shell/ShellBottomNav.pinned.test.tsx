// `ShellBottomNav` and `ShellDestination.pinned` (issue #997): pinned
// destinations are RENDERED AT THE END of the bottom bar (and of its More
// sheet), after the non-pinned ones; the rail and the user menu still show them.

import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import HomeIcon from '@mui/icons-material/Home';
import SettingsIcon from '@mui/icons-material/Settings';
import WorkIcon from '@mui/icons-material/Work';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetSettingsFeaturesForTests } from '../../src/settings/headless/features.js';
import type { ShellNavigation } from '../../src/shell/headless/index.js';
import { ShellBottomNav, ShellNavigationRail } from '../../src/shell/ui/index.js';
import { setViewportWidth } from '../viewport.js';
import { ADMIN, NAVIGATION, renderShell } from './fixtures.js';

const PHONE = 375;

beforeEach(() => {
  resetSettingsFeaturesForTests();
  setViewportWidth(PHONE);
});

describe('ShellBottomNav: pinned destinations', () => {
  it('renders a visible pinned destination after the non-pinned ones', () => {
    // The fixture's Console is pinned and the admin may see it.
    renderShell(<ShellBottomNav navigation={NAVIGATION} />, { user: ADMIN });
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toContain('Home');
    expect(names).toContain('User Settings');
    expect(names[names.length - 1]).toBe('Console');
  });

  it('moves a pinned destination to the end even when it is declared first', () => {
    const navigation: ShellNavigation<'pin' | 'a' | 'b'> = {
      destinations: [
        { key: 'pin', label: 'Pinned thing', compactLabel: 'Pinned', Icon: WorkIcon, path: '/pin', pinned: true },
        { key: 'a', label: 'Alpha', compactLabel: 'Alpha', Icon: HomeIcon, path: '/' },
        { key: 'b', label: 'Bravo', compactLabel: 'Bravo', Icon: SettingsIcon, path: '/b' },
      ],
      destinationRoutes: { pin: ['/pin'], a: ['/'], b: ['/b'] },
      settingsSurfaces: [],
    };
    renderShell(<ShellBottomNav navigation={navigation} />);
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Alpha', 'Bravo', 'Pinned thing']);
  });

  it('counts pinned destinations toward the overflow and lists them last in the More sheet', async () => {
    const navigation: ShellNavigation<'a' | 'b' | 'c' | 'pin'> = {
      destinations: [
        { key: 'a', label: 'Alpha', compactLabel: 'Alpha', Icon: HomeIcon, path: '/' },
        { key: 'pin', label: 'Pinned thing', compactLabel: 'Pinned', Icon: WorkIcon, path: '/pin', pinned: true },
        { key: 'b', label: 'Bravo', compactLabel: 'Bravo', Icon: SettingsIcon, path: '/b' },
        { key: 'c', label: 'Charlie', compactLabel: 'Charlie', Icon: WorkIcon, path: '/c' },
      ],
      destinationRoutes: { a: ['/'], b: ['/b'], c: ['/c'], pin: ['/pin'] },
      settingsSurfaces: [],
    };
    renderShell(<ShellBottomNav navigation={navigation} maxItems={3} />);
    // Bar: Alpha, Bravo, More. Sheet: Charlie, then the pinned one.
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bravo' })).toBeInTheDocument();
    expect(screen.queryByText('Pinned thing')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /more/i }));
    const sheet = await screen.findByRole('presentation');
    const links = within(sheet).getAllByRole('link').map((l) => l.getAttribute('aria-label'));
    expect(links).toEqual(['Charlie', 'Pinned thing']);
  });

  it('still shows the pinned destination on the rail', () => {
    setViewportWidth(1400);
    renderShell(<ShellNavigationRail navigation={NAVIGATION} />, { user: ADMIN });
    expect(screen.getByRole('link', { name: /Console/ })).toBeInTheDocument();
  });
});
