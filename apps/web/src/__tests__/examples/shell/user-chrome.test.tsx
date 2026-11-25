/**
 * Issue #1109, as an app uses it:
 *
 *  - the user menu draws an avatar the app resolves itself (`avatarSrc`, an
 *    authenticated proxy URL) and drops the destination rows the rail already
 *    lists (`showDestinations={false}`);
 *  - a group switcher chip sits beside the brand (`leadingActions`) and leaves
 *    with it in the settings drill-down;
 *  - a hub page redirects to its first item only while the destination's
 *    context pane is drawn (`useShellContextPaneVisible`); otherwise the hub is
 *    the only way to its items, so it stays.
 *
 * None of them is a breakpoint gate: the five coupled gates did not move.
 */
import HomeIcon from '@mui/icons-material/Home';
import FolderIcon from '@mui/icons-material/Folder';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { act, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { PlatformHostProvider } from '@marinoscar/platform-web/core';
import type { ShellContextPaneProps, ShellNavigation } from '@marinoscar/platform-web/shell/headless';
import { ShellAppBar, ShellLayout, ShellUserMenu, useShellContextPaneVisible } from '@marinoscar/platform-web/shell/ui';
import { createTestPlatformHost } from '@marinoscar/platform-web/testing';

import { APP_NAVIGATION } from '../../../config/shell';
import { mockAdminUser, renderWithProviders } from '../../utils/test-utils';
import { resetViewportWidth, setViewportWidth } from '../../setup';

afterEach(() => resetViewportWidth());

describe('the user menu with an app-resolved avatar and no destination rows', () => {
  it('draws the proxy avatar URL and lists only the app rows and sign-out', async () => {
    renderWithProviders(
      <ShellUserMenu
        navigation={APP_NAVIGATION}
        avatarSrc={`/api/users/${mockAdminUser.id}/avatar?v=2`}
        showDestinations={false}
        extraItems={[{ key: 'profile', label: 'Profile', to: '/settings/profile' }]}
      />,
      { wrapperOptions: { user: { ...mockAdminUser, profileImageUrl: 'https://cdn.example.test/raw.jpg' } } },
    );
    expect(screen.getByRole('img')).toHaveAttribute('src', `/api/users/${mockAdminUser.id}/avatar?v=2`);

    await userEvent.click(screen.getByRole('button'));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Profile')).toBeInTheDocument();
    expect(within(menu).queryByText('User Settings')).not.toBeInTheDocument();
  });
});

describe('a group switcher beside the brand', () => {
  const chip = <button type="button">Group Alpha</button>;

  it('shows the chip next to the brand on the desktop bar', () => {
    act(() => setViewportWidth(1440));
    renderWithProviders(<ShellAppBar navigation={APP_NAVIGATION} brand="Product X" leadingActions={chip} userMenu={<span />} />);
    expect(screen.getByRole('button', { name: 'Group Alpha' })).toBeInTheDocument();
  });

  it('drops the chip with the brand in the phone settings drill-down', () => {
    act(() => setViewportWidth(375));
    renderWithProviders(
      <ShellAppBar navigation={APP_NAVIGATION} brand="Product X" leadingActions={chip} userMenu={<span />} />,
      { wrapperOptions: { route: '/admin/settings' } },
    );
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Group Alpha' })).not.toBeInTheDocument();
  });
});

function ProjectsPane({ pathname }: ShellContextPaneProps): ReactElement {
  return <p>Projects pane at {pathname}</p>;
}

/** The hub: straight to the first project while the pane lists them; else the list itself. */
function ProjectsHub(): ReactElement {
  const paneVisible = useShellContextPaneVisible('projects');
  if (paneVisible) return <Navigate to="/projects/alpha" replace />;
  return <p>Project list</p>;
}

const NAVIGATION: ShellNavigation<'home' | 'projects'> = {
  destinations: [
    { key: 'home', label: 'Home', compactLabel: 'Home', Icon: HomeIcon, path: '/' },
    { key: 'projects', label: 'Projects', compactLabel: 'Projects', Icon: FolderIcon, path: '/projects', contextPane: ProjectsPane },
  ],
  useRailPreference: () => ({ railCollapsed: false, toggleRailCollapsed: () => undefined }),
};

function renderHub() {
  return render(
    <ThemeProvider theme={createTheme()}>
      <PlatformHostProvider host={createTestPlatformHost({ permissions: [] })}>
        <MemoryRouter initialEntries={['/projects']}>
          <ShellLayout navigation={NAVIGATION} appBar={<div />}>
            <Routes>
              <Route path="/projects" element={<ProjectsHub />} />
              <Route path="/projects/:id" element={<p>Project page</p>} />
            </Routes>
          </ShellLayout>
        </MemoryRouter>
      </PlatformHostProvider>
    </ThemeProvider>,
  );
}

describe('a hub that redirects only while its context pane is drawn', () => {
  it('goes to the first project on desktop, where the pane lists them', () => {
    act(() => setViewportWidth(1440));
    renderHub();
    expect(screen.getByText('Project page')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Projects' })).toHaveTextContent('/projects/alpha');
  });

  it('stays on the hub at the medium tier, where no pane is drawn', () => {
    act(() => setViewportWidth(800));
    renderHub();
    expect(screen.getByText('Project list')).toBeInTheDocument();
  });
});
