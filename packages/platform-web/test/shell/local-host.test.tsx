// Local host mode (issue #997): one user, no sign-in, no API. The whole shell
// renders from a PlatformHostProvider whose api rejects every call, a
// LocalIdentityProvider and a localStorage ShellPreferencesPort, and never
// touches the network.

import HomeIcon from '@mui/icons-material/Home';
import NotesIcon from '@mui/icons-material/Notes';
import SettingsIcon from '@mui/icons-material/Settings';
import AdminIcon from '@mui/icons-material/AdminPanelSettings';
import HelpIcon from '@mui/icons-material/Help';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlatformApiClient, PlatformWebHost } from '../../src/core/index.js';
import { PlatformHostProvider } from '../../src/core/index.js';
import { LocalIdentityProvider, createLocalAuthContextValue } from '../../src/identity/headless/index.js';
import type { LocalIdentityInput } from '../../src/identity/headless/index.js';
import { resetSettingsFeaturesForTests } from '../../src/settings/headless/features.js';
import { ShellPreferencesProvider, createLocalStorageShellPreferencesPort, createShellTheme } from '../../src/shell/headless/index.js';
import type { ShellNavigation } from '../../src/shell/headless/index.js';
import {
  ShellAppBar,
  ShellBottomNav,
  ShellLayout,
  ShellNavigationRail,
  ShellRoot,
  ShellUserMenu,
} from '../../src/shell/ui/index.js';
import { setViewportWidth } from '../viewport.js';

const STORAGE_KEY = 'test-shell-prefs';

// No `useRailPreference`: the shell's default hook must resolve through the port.
const NAVIGATION: ShellNavigation<'home' | 'notes' | 'admin' | 'settings' | 'help'> = {
  destinations: [
    { key: 'home', label: 'Home', compactLabel: 'Home', Icon: HomeIcon, path: '/' },
    { key: 'notes', label: 'Notes', compactLabel: 'Notes', Icon: NotesIcon, path: '/notes', permission: 'notes:read' },
    { key: 'admin', label: 'Administration', compactLabel: 'Admin', Icon: AdminIcon, path: '/admin', permission: 'admin:read' },
    { key: 'settings', label: 'Preferences', compactLabel: 'Prefs', Icon: SettingsIcon, path: '/settings' },
    { key: 'help', label: 'Help', compactLabel: 'Help', Icon: HelpIcon, path: '/help', pinned: true },
  ],
  destinationRoutes: { home: ['/'], notes: ['/notes'], admin: ['/admin'], settings: ['/settings'], help: ['/help'] },
  settingsSurfaces: [],
};

const PORT = createLocalStorageShellPreferencesPort(STORAGE_KEY);

const THEMES = { light: createShellTheme('light'), dark: createShellTheme('dark') };

/** An api whose every method rejects; each is a spy so the test can prove none ran. */
function rejectingApi() {
  const fail = (name: string) => vi.fn(async () => Promise.reject(new Error(`unexpected api call: ${name}`)));
  const api = {
    get: fail('get'),
    post: fail('post'),
    put: fail('put'),
    patch: fail('patch'),
    delete: fail('delete'),
    postForm: fail('postForm'),
    postFormData: fail('postFormData'),
    postSse: fail('postSse'),
    getBlob: fail('getBlob'),
  };
  return api as unknown as PlatformApiClient & Record<string, ReturnType<typeof vi.fn>>;
}

function Tree({ api, identity, host }: { api: PlatformApiClient; identity: LocalIdentityInput; host?: Partial<PlatformWebHost> }): ReactElement {
  const platformHost: PlatformWebHost = {
    api,
    viewer: {
      userId: identity.userId,
      hasPermission: (permission) => identity.permissions.includes(permission),
      isFeatureEnabled: () => false,
    },
    ...host,
  };
  return (
    <ShellRoot themes={THEMES}>
      <MemoryRouter>
        <PlatformHostProvider host={platformHost}>
          <LocalIdentityProvider {...identity}>
            <ShellPreferencesProvider port={PORT}>
              <ShellLayout
                appBar={
                  <ShellAppBar
                    navigation={NAVIGATION}
                    brand="Local App"
                    userMenu={
                      <ShellUserMenu
                        navigation={NAVIGATION}
                        extraItems={[{ key: 'about', label: 'About this app', onClick: () => undefined }]}
                      />
                    }
                  />
                }
                rail={<ShellNavigationRail navigation={NAVIGATION} />}
                bottomNav={<ShellBottomNav navigation={NAVIGATION} />}
              >
                <p>page body</p>
              </ShellLayout>
            </ShellPreferencesProvider>
          </LocalIdentityProvider>
        </PlatformHostProvider>
      </MemoryRouter>
    </ShellRoot>
  );
}

const IDENTITY: LocalIdentityInput = {
  userId: 'local-user',
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  permissions: ['notes:read'],
};

function expectNoApiCalls(api: Record<string, unknown>) {
  for (const [name, fn] of Object.entries(api)) {
    expect(fn, name).not.toHaveBeenCalled();
  }
}

beforeEach(() => {
  resetSettingsFeaturesForTests();
  window.localStorage.clear();
  setViewportWidth(1400);
});

describe('createLocalAuthContextValue', () => {
  it('describes a signed-in local user with no providers and no-op actions', async () => {
    const value = createLocalAuthContextValue({ userId: 'u', permissions: ['a:read'], roles: ['admin'] });
    expect(value.isAuthenticated).toBe(true);
    expect(value.isLoading).toBe(false);
    expect(value.providers).toEqual([]);
    expect(value.mode).toBe('local');
    expect(value.user?.id).toBe('u');
    expect(value.user?.displayName).toBe('You');
    expect(value.user?.permissions).toEqual(['a:read']);
    expect(value.user?.roles.map((role) => role.name)).toEqual(['admin']);
    await expect(Promise.resolve(value.logout())).resolves.toBeUndefined();
    await expect(Promise.resolve(value.switchOrg('org'))).resolves.toBeUndefined();
  });
});

describe('local host mode: the full shell with no API', () => {
  it('renders the rail, app bar, user menu and bottom nav and never calls the api', async () => {
    const api = rejectingApi();
    const view = render(<Tree api={api} identity={IDENTITY} />);

    expect(await screen.findByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(screen.getByText('Local App')).toBeInTheDocument();
    expect(screen.getByText('page body')).toBeInTheDocument();
    // The avatar shows the initials of displayName.
    expect(screen.getByText('AL')).toBeInTheDocument();

    // The bottom bar mounts at phone width; same providers, still no calls.
    view.unmount();
    setViewportWidth(375);
    const api2 = rejectingApi();
    render(<Tree api={api2} identity={IDENTITY} />);
    expect(await screen.findByRole('button', { name: 'Home' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }));

    expectNoApiCalls(api);
    expectNoApiCalls(api2);
  });

  it('shows permission-gated destinations according to LocalIdentityInput.permissions', async () => {
    const api = rejectingApi();
    const first = render(<Tree api={api} identity={IDENTITY} />);
    let rail = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(within(rail).getByRole('link', { name: /Notes/ })).toBeInTheDocument();
    expect(within(rail).queryByRole('link', { name: /Administration/ })).not.toBeInTheDocument();
    first.unmount();

    render(<Tree api={api} identity={{ ...IDENTITY, permissions: ['notes:read', 'admin:read'] }} />);
    rail = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(within(rail).getByRole('link', { name: /Administration/ })).toBeInTheDocument();

    expectNoApiCalls(api);
  });

  it('hides a destination when the user holds none of its permissions', async () => {
    const api = rejectingApi();
    render(<Tree api={api} identity={{ ...IDENTITY, permissions: [] }} />);
    const rail = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(within(rail).queryByRole('link', { name: /Notes/ })).not.toBeInTheDocument();
    expect(within(rail).getByRole('link', { name: /Home/ })).toBeInTheDocument();
    expectNoApiCalls(api);
  });

  it('persists the rail collapse through the port and restores it after a remount', async () => {
    const api = rejectingApi();
    const first = render(<Tree api={api} identity={IDENTITY} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Collapse navigation' }));
    expect(await screen.findByRole('button', { name: 'Expand navigation' })).toBeInTheDocument();

    await waitFor(() => {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toMatchObject({ railCollapsed: true });
    });
    first.unmount();

    render(<Tree api={api} identity={IDENTITY} />);
    expect(await screen.findByRole('button', { name: 'Expand navigation' })).toBeInTheDocument();

    // Expanding writes the change back.
    await userEvent.click(screen.getByRole('button', { name: 'Expand navigation' }));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toMatchObject({ railCollapsed: false }));

    expectNoApiCalls(api);
  });

  it('opens a user menu with extraItems and without sign-out or an organization switcher', async () => {
    const api = rejectingApi();
    render(<Tree api={api} identity={IDENTITY} />);
    await userEvent.click(await screen.findByRole('button', { name: /Ada Lovelace|AL/ }));

    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Ada Lovelace')).toBeInTheDocument();
    expect(within(menu).getByText('About this app')).toBeInTheDocument();
    expect(within(menu).queryByText(/log ?out|sign ?out/i)).not.toBeInTheDocument();
    expect(within(menu).queryByText(/organi[sz]ation/i)).not.toBeInTheDocument();
    expectNoApiCalls(api);
  });

  it('runs an extraItem click handler', async () => {
    const onClick = vi.fn();
    const api = rejectingApi();
    render(
      <ShellRoot themes={THEMES}>
        <MemoryRouter>
          <PlatformHostProvider
            host={{ api, viewer: { userId: 'u', hasPermission: () => true, isFeatureEnabled: () => false } }}
          >
            <LocalIdentityProvider userId="u" permissions={[]}>
              <ShellUserMenu navigation={NAVIGATION} extraItems={[{ key: 'x', label: 'Export data', onClick }]} />
            </LocalIdentityProvider>
          </PlatformHostProvider>
        </MemoryRouter>
      </ShellRoot>,
    );
    await userEvent.click(await screen.findByRole('button'));
    await userEvent.click(await screen.findByText('Export data'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expectNoApiCalls(api);
  });

  it('excludes the pinned destination from the bottom bar', async () => {
    setViewportWidth(375);
    const api = rejectingApi();
    render(<Tree api={api} identity={IDENTITY} />);
    expect(await screen.findByRole('button', { name: 'Home' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Help' })).not.toBeInTheDocument();
    expectNoApiCalls(api);
  });
});

describe('createLocalStorageShellPreferencesPort', () => {
  it('reads an empty object when nothing is stored, and merges patches', async () => {
    const port = createLocalStorageShellPreferencesPort('port-key');
    expect(await port.read()).toEqual({});
    await port.write({ railCollapsed: true });
    expect(await port.read()).toEqual({ railCollapsed: true });
    await port.write({ railCollapsed: false });
    expect(await port.read()).toEqual({ railCollapsed: false });
  });

  it('tolerates corrupt stored JSON', async () => {
    window.localStorage.setItem('port-key', '{not json');
    const port = createLocalStorageShellPreferencesPort('port-key');
    expect(await port.read()).toEqual({});
  });

  it('works with the default key', async () => {
    const port = createLocalStorageShellPreferencesPort();
    await port.write({ railCollapsed: true });
    expect(await createLocalStorageShellPreferencesPort().read()).toEqual({ railCollapsed: true });
  });
});
