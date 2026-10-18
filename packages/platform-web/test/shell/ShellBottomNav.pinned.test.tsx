// `ShellBottomNav` and `ShellDestination.pinned` (issue #997): pinned
// destinations are EXCLUDED from the bottom bar (and its More sheet); the rail
// and the user menu still show them.

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
  it('leaves a visible pinned destination out of the bar', () => {
    // The fixture's Console is pinned and the admin may see it.
    renderShell(<ShellBottomNav navigation={NAVIGATION} />, { user: ADMIN });
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'User Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Console' })).not.toBeInTheDocument();
  });

  it('does not count pinned destinations toward the overflow, so no More action appears', () => {
    // 2 unpinned + 1 pinned with maxItems 2: only overflow if pinned counted.
    renderShell(<ShellBottomNav navigation={NAVIGATION} maxItems={2} />, { user: ADMIN });
    expect(screen.queryByRole('button', { name: /more/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'User Settings' })).toBeInTheDocument();
  });

  it('keeps pinned destinations out of the More sheet too', async () => {
    const navigation: ShellNavigation<'a' | 'b' | 'c' | 'pin'> = {
      destinations: [
        { key: 'a', label: 'Alpha', compactLabel: 'Alpha', Icon: HomeIcon, path: '/' },
        { key: 'b', label: 'Bravo', compactLabel: 'Bravo', Icon: SettingsIcon, path: '/b' },
        { key: 'c', label: 'Charlie', compactLabel: 'Charlie', Icon: WorkIcon, path: '/c' },
        { key: 'pin', label: 'Pinned thing', compactLabel: 'Pinned', Icon: WorkIcon, path: '/pin', pinned: true },
      ],
      destinationRoutes: { a: ['/'], b: ['/b'], c: ['/c'], pin: ['/pin'] },
      settingsSurfaces: [],
    };
    renderShell(<ShellBottomNav navigation={navigation} maxItems={2} />);
    await userEvent.click(screen.getByRole('button', { name: /more/i }));
    const sheet = await screen.findByRole('presentation');
    expect(within(sheet).getByText('Bravo')).toBeInTheDocument();
    expect(within(sheet).getByText('Charlie')).toBeInTheDocument();
    expect(screen.queryByText('Pinned thing')).not.toBeInTheDocument();
  });

  it('still shows the pinned destination on the rail', () => {
    setViewportWidth(1400);
    renderShell(<ShellNavigationRail navigation={NAVIGATION} />, { user: ADMIN });
    expect(screen.getByRole('link', { name: /Console/ })).toBeInTheDocument();
  });
});
