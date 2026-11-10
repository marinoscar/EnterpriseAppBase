// =============================================================================
// Suite: the full-bleed `<main>` variant and the context pane (issue #1080)
// =============================================================================
//
// Two layout affordances that must never become breakpoint gates:
//
//   - a full-bleed page (`useShellMainVariant('full-bleed')`) drops `<main>`'s
//     side and top padding and the banners, but still clears the fixed bottom
//     bar below `sm` (gate 3 intact);
//   - a destination's `contextPane` is drawn beside the EXPANDED rail only (the
//     rail's own `lg` + not-collapsed state): not at the medium rail, not when
//     collapsed, not in Console mode; and it stays mounted across a route
//     change inside the destination.
//
// It builds its own tree, so it takes no options and reads nothing from the
// app's data.
// =============================================================================

import { ThemeProvider, createTheme } from '@mui/material';
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, useEffect } from 'react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

import { PlatformHostProvider } from '../../core/index.js';
import type { PlatformApiClient, PlatformWebHost } from '../../core/index.js';
import { webConformanceSuites } from '../../testing/index.js';
import type { WebConformanceSuite, WebConformanceTestApi } from '../../testing/index.js';
import { useShellMainVariant } from '../headless/index.js';
import type { ShellContextPaneProps, ShellIconProps, ShellNavigation, ShellRailPreference } from '../headless/index.js';
import { ShellLayout } from '../ui/index.js';
import { installMatchMedia } from './match-media.js';

const Icon = (props: ShellIconProps): ReactElement => createElement('span', { 'data-icon': props.fontSize ?? 'medium' });

const rail: ShellRailPreference = { railCollapsed: false, toggleRailCollapsed: () => undefined };

let paneMounts = 0;

function Pane({ activeDestination, pathname }: ShellContextPaneProps): ReactElement {
  useEffect(() => {
    paneMounts += 1;
  }, []);
  return createElement('div', { 'data-testid': 'suite-context-pane' }, `${activeDestination} ${pathname}`);
}

const NAVIGATION: ShellNavigation = {
  destinations: [
    { key: 'home', label: 'Home', compactLabel: 'Home', Icon, path: '/' },
    { key: 'library', label: 'Library', compactLabel: 'Library', Icon, path: '/library', contextPane: Pane },
    { key: 'console', label: 'Console', compactLabel: 'Console', Icon, path: '/admin', pinned: true },
  ],
  destinationRoutes: { home: ['/'], library: ['/library', '/admin/library'], console: ['/admin'] },
  console: { prefix: '/admin', sections: [] },
  useRailPreference: () => rail,
};

function FullBleed(): ReactElement {
  useShellMainVariant('full-bleed');
  return createElement('p', null, 'full-bleed page');
}

function Go(): ReactElement {
  const navigate = useNavigate();
  return createElement('button', { onClick: () => navigate('/library/inner') }, 'suite-go');
}

const unusedApi = (): Promise<never> => Promise.reject(new Error('shell-layout-variants: unexpected API call'));
const API: PlatformApiClient = { get: unusedApi, post: unusedApi, put: unusedApi, patch: unusedApi, delete: unusedApi };

function mount(width: number, route: string): { unmount: () => void } {
  const restore = installMatchMedia(width);
  const host: PlatformWebHost = { api: API, viewer: { userId: 'u', hasPermission: () => true, isFeatureEnabled: () => false } };
  const view = render(
    <ThemeProvider theme={createTheme()}>
      <PlatformHostProvider host={host}>
        <MemoryRouter initialEntries={[route]}>
          <ShellLayout navigation={NAVIGATION} appBar={<div />} banners={<div data-testid="suite-banner" />}>
            <Go />
            <Routes>
              <Route path="/full" element={<FullBleed />} />
              <Route path="*" element={<p>page</p>} />
            </Routes>
          </ShellLayout>
        </MemoryRouter>
      </PlatformHostProvider>
    </ThemeProvider>,
  );
  return {
    unmount: () => {
      view.unmount();
      restore();
    },
  };
}

/** The emotion rules emitted for `element` (jsdom ignores `@media` in getComputedStyle). */
function emittedRules(element: Element): string {
  const emotionClass = [...element.classList].find((name) => name.startsWith('css-'));
  if (!emotionClass) return '';
  return [...document.querySelectorAll('style')]
    .map((style) => style.textContent ?? '')
    .join('')
    .split('}}')
    .filter((block) => block.includes(`.${emotionClass}{`))
    .join('}}');
}

function register(api: WebConformanceTestApi): void {
  const { describe, it, expect } = api;

  describe('shell layout variants', () => {
    it('a full-bleed page at 599px drops the padding and banners but still clears the bottom bar (gate 3)', () => {
      const { unmount } = mount(599, '/full');
      try {
        const main = screen.getByRole('main');
        expect(main.getAttribute('data-main-variant')).toBe('full-bleed');
        expect(screen.queryAllByTestId('suite-banner')).toHaveLength(0);
        const rules = emittedRules(main);
        expect(/padding:0/.test(rules)).toBe(true);
        expect(/@media \(min-width:0px\)\{[^}]*padding-bottom:80px/.test(rules)).toBe(true);
      } finally {
        unmount();
      }
    });

    it('draws the context pane beside the expanded rail at 1200px, not at 900px', () => {
      let view = mount(1200, '/library');
      try {
        expect(screen.queryAllByTestId('suite-context-pane')).toHaveLength(1);
      } finally {
        view.unmount();
      }
      view = mount(900, '/library');
      try {
        expect(screen.queryAllByTestId('suite-context-pane')).toHaveLength(0);
      } finally {
        view.unmount();
      }
    });

    it('hides the context pane when the rail is collapsed and in Console mode', () => {
      rail.railCollapsed = true;
      let view = mount(1200, '/library');
      try {
        expect(screen.queryAllByTestId('suite-context-pane')).toHaveLength(0);
      } finally {
        view.unmount();
        rail.railCollapsed = false;
      }
      view = mount(1200, '/admin/library');
      try {
        expect(screen.queryAllByRole('navigation', { name: 'Console navigation' })).toHaveLength(1);
        expect(screen.queryAllByTestId('suite-context-pane')).toHaveLength(0);
      } finally {
        view.unmount();
      }
    });

    it('keeps the context pane mounted across a route change inside the destination', () => {
      paneMounts = 0;
      const { unmount } = mount(1200, '/library');
      try {
        fireEvent.click(screen.getByText('suite-go'));
        expect(screen.getByTestId('suite-context-pane').textContent).toBe('library /library/inner');
        expect(paneMounts).toBe(1);
      } finally {
        unmount();
      }
    });
  });
}

/**
 * The suite behind `runPlatformWebConformance`: a full-bleed page keeps the
 * bottom-bar clearance (gate 3), and a destination's `contextPane` is drawn
 * beside the expanded rail only and stays mounted across a route change.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const shellLayoutVariantsSuite: WebConformanceSuite = {
  id: 'shell-layout-variants',
  title: 'Shell layout variants: full-bleed main and the context pane are not breakpoint gates',
  description:
    'A full-bleed page drops the padding and banners but still clears the bottom bar below sm; a contextPane renders beside the expanded rail only (not at the medium rail, collapsed or in Console mode) and survives a route change inside its destination.',
  register,
};

webConformanceSuites.register(shellLayoutVariantsSuite);
