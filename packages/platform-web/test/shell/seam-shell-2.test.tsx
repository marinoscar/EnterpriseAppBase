// Issue #1109: the user menu's avatar source and destination rows, the
// AppBar's leading-actions slot, and `useShellContextPaneVisible`. None of them
// is a breakpoint gate: the slot follows the drill-down the AppBar already
// resolves, and the hook reads what the rail reports it drew.

import LibraryIcon from '@mui/icons-material/LocalLibrary';
import { act, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetSettingsFeaturesForTests } from '../../src/settings/headless/features.js';
import type { ShellNavigation } from '../../src/shell/headless/index.js';
import { useShellContextPaneVisible as headlessHook } from '../../src/shell/headless/index.js';
import { ShellAppBar, ShellLayout, ShellUserMenu, useShellContextPaneVisible } from '../../src/shell/ui/index.js';
import { setViewportWidth } from '../viewport.js';
import { ADMIN, NAVIGATION, railPreference, renderShell } from './fixtures.js';

beforeEach(() => {
  railPreference.railCollapsed = false;
  resetSettingsFeaturesForTests();
});

const PICTURED = { ...ADMIN, profileImageUrl: 'https://cdn.example.test/raw.jpg' };

describe('ShellUserMenu: avatar source (issue #1109)', () => {
  it("draws the user's own profileImageUrl by default", () => {
    renderShell(<ShellUserMenu navigation={NAVIGATION} />, { user: PICTURED });
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://cdn.example.test/raw.jpg');
  });

  it('draws avatarSrc in place of profileImageUrl', () => {
    renderShell(<ShellUserMenu navigation={NAVIGATION} avatarSrc="/api/users/admin/avatar?v=3" />, { user: PICTURED });
    expect(screen.getByRole('img')).toHaveAttribute('src', '/api/users/admin/avatar?v=3');
  });

  it('draws the initials with no image when avatarSrc is null', () => {
    renderShell(<ShellUserMenu navigation={NAVIGATION} avatarSrc={null} />, { user: PICTURED });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveTextContent('AU');
  });

  it('lets renderAvatar draw the button content, given the user and the initials', () => {
    renderShell(
      <ShellUserMenu
        navigation={NAVIGATION}
        avatarSrc="/ignored"
        renderAvatar={(user, initials) => <span data-testid="custom-avatar">{`${user.id}:${initials}`}</span>}
      />,
      { user: PICTURED },
    );
    expect(screen.getByTestId('custom-avatar')).toHaveTextContent('admin:AU');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('ShellUserMenu: showDestinations (issue #1109)', () => {
  it('lists the destinations by default', async () => {
    renderShell(<ShellUserMenu navigation={NAVIGATION} />, { user: ADMIN });
    await userEvent.click(screen.getByRole('button'));
    expect(within(screen.getByRole('menu')).getByText('User Settings')).toBeInTheDocument();
  });

  it('drops the destination rows with showDestinations false, keeping items, extra rows and sign-out', async () => {
    renderShell(
      <ShellUserMenu
        navigation={NAVIGATION}
        showDestinations={false}
        extraItems={[{ key: 'profile', label: 'Profile', to: '/settings/profile' }]}
      />,
      { user: ADMIN },
    );
    await userEvent.click(screen.getByRole('button'));
    const menu = screen.getByRole('menu');
    expect(within(menu).queryByText('User Settings')).not.toBeInTheDocument();
    expect(within(menu).queryByText('Console')).not.toBeInTheDocument();
    expect(within(menu).getByText('Profile')).toBeInTheDocument();
    expect(within(menu).getByText('Logout')).toBeInTheDocument();
  });
});

describe('ShellAppBar: leadingActions (issue #1109)', () => {
  const chip = <button type="button">Group Alpha</button>;

  it('draws the slot beside the brand, outside its go-home click target', async () => {
    setViewportWidth(1400);
    renderShell(
      <ShellAppBar navigation={NAVIGATION} brand="Org Kappa" leadingActions={chip} userMenu={<span />} />,
      { route: '/settings' },
    );
    const button = screen.getByRole('button', { name: 'Group Alpha' });
    // After the brand in document order.
    expect(screen.getByText('Org Kappa').compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(button);
    expect(screen.getByTestId('where')).toHaveTextContent('/settings');
  });

  it('keeps the slot below sm off a settings route', () => {
    setViewportWidth(375);
    renderShell(<ShellAppBar navigation={NAVIGATION} brand="Org Kappa" leadingActions={chip} userMenu={<span />} />);
    expect(screen.getByRole('button', { name: 'Group Alpha' })).toBeInTheDocument();
  });

  it('drops the slot in the drill-down, as it drops the brand', () => {
    setViewportWidth(375);
    renderShell(
      <ShellAppBar navigation={NAVIGATION} brand="Org Kappa" leadingActions={chip} userMenu={<span />} />,
      { route: '/admin/settings/users' },
    );
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(screen.queryByText('Org Kappa')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Group Alpha' })).not.toBeInTheDocument();
  });
});

function Pane(): ReactElement {
  return <div data-testid="pane" />;
}

type Key = 'home' | 'library' | 'settings' | 'console';

const PANE_NAVIGATION: ShellNavigation<Key> = {
  ...NAVIGATION,
  destinations: [
    ...NAVIGATION.destinations,
    { key: 'library', label: 'Library', compactLabel: 'Library', Icon: LibraryIcon, path: '/library', contextPane: Pane },
  ],
  destinationRoutes: { home: ['/'], library: ['/library'], settings: ['/settings'], console: ['/admin'] },
};

function Probe(): ReactElement {
  const any = useShellContextPaneVisible();
  const library = useShellContextPaneVisible('library');
  const other = useShellContextPaneVisible('settings');
  return <div data-testid="probe">{`${any}/${library}/${other}`}</div>;
}

describe('useShellContextPaneVisible (issue #1109)', () => {
  it('is the same hook from shell/headless and shell/ui', () => {
    expect(headlessHook).toBe(useShellContextPaneVisible);
  });

  it('is false outside a ShellLayout', () => {
    renderShell(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('false/false/false');
  });

  it('is true for the destination whose pane the expanded rail draws', () => {
    setViewportWidth(1400);
    renderShell(
      <ShellLayout navigation={PANE_NAVIGATION} appBar={<div />}>
        <Probe />
      </ShellLayout>,
      { user: ADMIN, route: '/library/one' },
    );
    expect(screen.getByTestId('pane')).toBeInTheDocument();
    expect(screen.getByTestId('probe')).toHaveTextContent('true/true/false');
  });

  it('is false when the desktop rail is collapsed by preference', () => {
    railPreference.railCollapsed = true;
    setViewportWidth(1400);
    renderShell(
      <ShellLayout navigation={PANE_NAVIGATION} appBar={<div />}>
        <Probe />
      </ShellLayout>,
      { user: ADMIN, route: '/library' },
    );
    expect(screen.queryByTestId('pane')).not.toBeInTheDocument();
    expect(screen.getByTestId('probe')).toHaveTextContent('false/false/false');
  });

  it('follows the rail across the medium tier and a phone, and back', async () => {
    setViewportWidth(1400);
    renderShell(
      <ShellLayout navigation={PANE_NAVIGATION} appBar={<div />}>
        <Probe />
      </ShellLayout>,
      { user: ADMIN, route: '/library' },
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('true/true/false');
    await act(async () => setViewportWidth(800));
    expect(screen.queryByTestId('pane')).not.toBeInTheDocument();
    expect(screen.getByTestId('probe')).toHaveTextContent('false/false/false');
    await act(async () => setViewportWidth(375));
    expect(screen.getByTestId('probe')).toHaveTextContent('false/false/false');
    await act(async () => setViewportWidth(1400));
    expect(screen.getByTestId('probe')).toHaveTextContent('true/true/false');
  });

  it('is false on a destination without a pane', () => {
    setViewportWidth(1400);
    renderShell(
      <ShellLayout navigation={PANE_NAVIGATION} appBar={<div />}>
        <Probe />
      </ShellLayout>,
      { user: ADMIN, route: '/settings' },
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('false/false/false');
  });
});
