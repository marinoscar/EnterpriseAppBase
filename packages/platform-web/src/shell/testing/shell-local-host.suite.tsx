// =============================================================================
// Suite: the shell runs in a local host (no API)
// =============================================================================
//
// A host with no API session (a desktop shell) mounts the shell under
// `LocalIdentityProvider` and a `ShellPreferencesProvider`. This suite renders
// the packaged chrome that way, at a wide and a narrow window, and asserts that
// it draws and that the host's API stub is never called: the chrome must not
// need the network. It builds its own tree, so it takes no options and reads
// nothing from the app's data.
// =============================================================================

import { ThemeProvider, createTheme } from '@mui/material';
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { PlatformHostProvider } from '../../core/index.js';
import type { PlatformApiClient, PlatformWebHost } from '../../core/index.js';
import { LocalIdentityProvider } from '../../identity/index.js';
import { webConformanceSuites } from '../../testing/index.js';
import type { WebConformanceSuite, WebConformanceTestApi } from '../../testing/index.js';
import { ShellPreferencesProvider, createLocalStorageShellPreferencesPort } from '../headless/index.js';
import type { ShellIconProps, ShellNavigation } from '../headless/index.js';
import { ShellLayout, ShellRoot } from '../ui/index.js';

const WIDE = 1400;
const NARROW = 400;

const Icon = (props: ShellIconProps): ReactElement => createElement('span', { 'data-icon': props.fontSize ?? 'medium' });

const NAVIGATION: ShellNavigation = {
  destinations: [
    { key: 'home', label: 'Home', compactLabel: 'Home', Icon, path: '/' },
    { key: 'notes', label: 'Notes', compactLabel: 'Notes', Icon, path: '/notes', permission: 'notes:read' },
    { key: 'secret', label: 'Secret', compactLabel: 'Secret', Icon, path: '/secret', permission: 'secret:read' },
    { key: 'tools', label: 'Tools', compactLabel: 'Tools', Icon, path: '/tools', pinned: true },
  ],
};

/** A `window.matchMedia` that answers min/max-width queries against `width`. */
function installMatchMedia(width: number): () => void {
  const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  const evaluate = (query: string): boolean => {
    const mins = [...query.matchAll(/\(min-width:\s*([\d.]+)px\)/g)].map((m) => parseFloat(m[1] ?? '0'));
    const maxs = [...query.matchAll(/\(max-width:\s*([\d.]+)px\)/g)].map((m) => parseFloat(m[1] ?? '0'));
    if (mins.length === 0 && maxs.length === 0) return false;
    return mins.every((min) => width >= min) && maxs.every((max) => width <= max);
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: evaluate(query),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
  return () => {
    if (original) Object.defineProperty(window, 'matchMedia', original);
    else delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  };
}

/** A transport that records every call and rejects it. */
function createSpyApi(): { api: PlatformApiClient; calls: string[] } {
  const calls: string[] = [];
  const reject = (verb: string) => (path: string): Promise<never> => {
    calls.push(`${verb} ${path}`);
    return Promise.reject(new Error(`shell-local-host: the shell called the API (${verb} ${path})`));
  };
  const api: PlatformApiClient = {
    get: reject('GET') as PlatformApiClient['get'],
    post: reject('POST') as PlatformApiClient['post'],
    put: reject('PUT') as PlatformApiClient['put'],
    patch: reject('PATCH') as PlatformApiClient['patch'],
    delete: reject('DELETE') as PlatformApiClient['delete'],
  };
  return { api, calls };
}

function mountShell(width: number): { calls: string[]; restore: () => void } {
  const restore = installMatchMedia(width);
  const { api, calls } = createSpyApi();
  const host: PlatformWebHost = {
    api,
    viewer: { userId: 'local', hasPermission: () => false, isFeatureEnabled: () => false },
  };
  const theme = createTheme();
  const port = createLocalStorageShellPreferencesPort('shell-local-host-suite');
  render(
    <ShellRoot themes={{ light: theme, dark: createTheme({ palette: { mode: 'dark' } }) }} storageKey="shell-local-host-suite-theme">
      <ThemeProvider theme={theme}>
        <PlatformHostProvider host={host}>
          <LocalIdentityProvider userId="local" displayName="Ada Lovelace" permissions={['notes:read']}>
            <ShellPreferencesProvider port={port}>
              <MemoryRouter initialEntries={['/']}>
                <ShellLayout navigation={NAVIGATION} brand="Local">
                  <div>page body</div>
                </ShellLayout>
              </MemoryRouter>
            </ShellPreferencesProvider>
          </LocalIdentityProvider>
        </PlatformHostProvider>
      </ThemeProvider>
    </ShellRoot>,
  );
  return { calls, restore };
}

function register(api: WebConformanceTestApi): void {
  const { describe, it, expect } = api;

  describe('shell in a local host', () => {
    it('draws the rail, filters destinations by the local permissions and never calls the API (wide window)', async () => {
      const { calls, restore } = mountShell(WIDE);
      try {
        expect(screen.queryAllByRole('navigation', { name: 'Main navigation' }).length >= 1).toBe(true);
        expect(screen.queryAllByText('Notes').length >= 1).toBe(true);
        expect(screen.queryAllByText('Secret')).toHaveLength(0);

        // The collapse toggle writes through the preferences port, not /user-settings.
        const toggle = screen.queryByLabelText('Collapse navigation');
        if (toggle) fireEvent.click(toggle);

        // The user menu: initials from the display name, no sign-out in local mode.
        fireEvent.click(screen.getByText('AL'));
        expect(screen.queryAllByText('Ada Lovelace').length >= 1).toBe(true);
        expect(screen.queryAllByText('Logout')).toHaveLength(0);

        await Promise.resolve();
        expect(calls).toEqual([]);
      } finally {
        restore();
      }
    });

    it('draws the bottom bar with the pinned destination last and never calls the API (narrow window)', async () => {
      const { calls, restore } = mountShell(NARROW);
      try {
        expect(screen.queryAllByText('Notes').length >= 1).toBe(true);
        expect(screen.queryAllByText('Tools').length >= 1).toBe(true);
        expect(screen.queryAllByText('Secret')).toHaveLength(0);
        const tools = screen.getAllByText('Tools')[0];
        const notes = screen.getAllByText('Notes')[0];
        // Pinned goes at the END of the bar: Notes precedes Tools in document order.
        expect(
          tools !== undefined &&
            notes !== undefined &&
            (notes.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        ).toBe(true);

        await Promise.resolve();
        expect(calls).toEqual([]);
      } finally {
        restore();
      }
    });
  });
}

/**
 * The suite behind `runPlatformWebConformance`: the packaged shell (AppBar,
 * rail, bottom bar, user menu) renders under `LocalIdentityProvider` and a
 * `ShellPreferencesProvider` and never calls the host's API.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const shellLocalHostSuite: WebConformanceSuite = {
  id: 'shell-local-host',
  title: 'Shell in a local host: the chrome renders and never calls the API',
  description:
    'The AppBar, rail, bottom bar and user menu render under LocalIdentityProvider and a ShellPreferencesProvider, filter destinations by the local permissions, and make no API call.',
  register,
};

webConformanceSuites.register(shellLocalHostSuite);
