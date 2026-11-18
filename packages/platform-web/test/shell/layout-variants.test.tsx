// The full-bleed `<main>` variant and the context pane beside the expanded
// rail (issue #1080). Neither is a breakpoint gate: the pane reuses the rail's
// own `expanded` boolean, and full bleed keeps gate 3 (the bottom-bar
// clearance) at every width.

import LibraryIcon from '@mui/icons-material/LocalLibrary';
import { act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetSettingsFeaturesForTests } from '../../src/settings/headless/features.js';
import { useShellMainVariant } from '../../src/shell/headless/index.js';
import type { ShellContextPaneProps, ShellNavigation } from '../../src/shell/headless/index.js';
import { CONTEXT_PANE_WIDTH, ShellLayout, ShellNavigationRail } from '../../src/shell/ui/index.js';
import { setViewportWidth } from '../viewport.js';
import { ADMIN, NAVIGATION, emittedRulesFor, railPreference, renderShell } from './fixtures.js';

let paneMounts = 0;

function LibraryPane({ activeDestination, pathname }: ShellContextPaneProps): ReactElement {
  useEffect(() => {
    paneMounts += 1;
  }, []);
  return (
    <div data-testid="pane">
      {activeDestination} {pathname}
    </div>
  );
}

type Key = 'home' | 'library' | 'secret' | 'settings' | 'console';

const PANE_NAVIGATION: ShellNavigation<Key> = {
  ...NAVIGATION,
  destinations: [
    ...NAVIGATION.destinations,
    { key: 'library', label: 'Library', compactLabel: 'Library', Icon: LibraryIcon, path: '/library', contextPane: LibraryPane },
    {
      key: 'secret',
      label: 'Secret',
      compactLabel: 'Secret',
      Icon: LibraryIcon,
      path: '/secret',
      permission: 'secret:read',
      contextPane: LibraryPane,
    },
  ],
  destinationRoutes: {
    home: ['/'],
    library: ['/library'],
    secret: ['/secret'],
    settings: ['/settings'],
    console: ['/admin'],
  },
};

function Go({ to }: { to: string }): ReactElement {
  const navigate = useNavigate();
  return <button onClick={() => navigate(to)}>go {to}</button>;
}

function FullBleedPage(): ReactElement {
  useShellMainVariant('full-bleed');
  return <p>map</p>;
}

function Pages(): ReactElement {
  return (
    <>
      <Go to="/library/two" />
      <Go to="/map" />
      <Go to="/" />
      <Routes>
        <Route path="/map" element={<FullBleedPage />} />
        <Route path="*" element={<p>page</p>} />
      </Routes>
    </>
  );
}

beforeEach(() => {
  paneMounts = 0;
  railPreference.railCollapsed = false;
  resetSettingsFeaturesForTests();
});

describe('ShellLayout mainVariant', () => {
  const slots = { appBar: <div />, rail: <div />, bottomNav: <div data-testid="bottom" /> };

  it('is padded by default: padding on every side and the banners above the page', () => {
    setViewportWidth(1200);
    renderShell(
      <ShellLayout {...slots} banners={<div data-testid="banner" />}>
        <p>page</p>
      </ShellLayout>,
    );
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('data-main-variant', 'padded');
    expect(screen.getByTestId('banner')).toBeInTheDocument();
    expect(emittedRulesFor(main)).toMatch(/padding:24px/);
  });

  it.each([599, 600, 1200])('full bleed drops the padding and the banners but keeps gate 3 at %ipx', (width) => {
    setViewportWidth(width);
    renderShell(
      <ShellLayout {...slots} mainVariant="full-bleed" banners={<div data-testid="banner" />}>
        <p>page</p>
      </ShellLayout>,
    );
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('data-main-variant', 'full-bleed');
    expect(screen.queryByTestId('banner')).not.toBeInTheDocument();
    const rules = emittedRulesFor(main);
    expect(rules).toMatch(/padding:0/);
    // Gate 3, unchanged: the bottom bar is still cleared below `sm`.
    expect(rules).toMatch(/@media \(min-width:0px\)\{[^}]*padding-bottom:80px/);
    expect(rules).toMatch(/@media \(min-width:600px\)\{[^}]*padding-bottom:24px/);
    expect(getComputedStyle(main).minWidth).toBe('0px');
  });

  it('lets a page ask for full bleed while it is mounted, without remounting the shell', async () => {
    setViewportWidth(1400);
    renderShell(
      <ShellLayout navigation={PANE_NAVIGATION} banners={<div data-testid="banner" />}>
        <Pages />
      </ShellLayout>,
      { user: ADMIN },
    );
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(screen.getByRole('main')).toHaveAttribute('data-main-variant', 'padded');

    await userEvent.click(screen.getByRole('button', { name: 'go /map' }));
    expect(screen.getByText('map')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('data-main-variant', 'full-bleed');
    expect(screen.queryByTestId('banner')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBe(nav);

    // Leaving the page resets the request.
    await userEvent.click(screen.getByRole('button', { name: 'go /' }));
    expect(screen.getByRole('main')).toHaveAttribute('data-main-variant', 'padded');
    expect(screen.getByTestId('banner')).toBeInTheDocument();
  });

  it('is a no-op outside a ShellLayout', () => {
    renderShell(<FullBleedPage />);
    expect(screen.getByText('map')).toBeInTheDocument();
  });
});

describe('ShellNavigationRail context pane', () => {
  it.each([
    [1200, true],
    [1199, false],
    [900, false],
    [899, false],
    [600, false],
  ])('at %ipx the pane is shown: %s (the rail is expanded only at lg)', (width, shown) => {
    setViewportWidth(width);
    renderShell(<ShellNavigationRail navigation={PANE_NAVIGATION} />, { route: '/library' });
    expect(Boolean(screen.queryByTestId('pane'))).toBe(shown);
  });

  it('is not drawn below sm, where the layout mounts no rail', () => {
    setViewportWidth(599);
    renderShell(<ShellLayout navigation={PANE_NAVIGATION}><p>page</p></ShellLayout>, { route: '/library' });
    expect(screen.queryByTestId('pane')).not.toBeInTheDocument();
  });

  it('sits beside the expanded rail, after it in focus order and before main', () => {
    setViewportWidth(1200);
    renderShell(<ShellLayout navigation={PANE_NAVIGATION}><p>page</p></ShellLayout>, { route: '/library' });
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    const pane = screen.getByRole('complementary', { name: 'Library' });
    const main = screen.getByRole('main');
    expect(nav.compareDocumentPosition(pane) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pane.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('pane')).toHaveTextContent('library /library');
    const rules = emittedRulesFor(pane);
    expect(rules).toContain(`width:${CONTEXT_PANE_WIDTH}px`);
    expect(rules).toContain('min-width:0');
  });

  it('is only drawn for the destination that declares one', () => {
    setViewportWidth(1400);
    renderShell(<ShellNavigationRail navigation={PANE_NAVIGATION} />, { route: '/settings' });
    expect(screen.queryByTestId('pane')).not.toBeInTheDocument();
  });

  it('is hidden when the desktop rail is collapsed', () => {
    railPreference.railCollapsed = true;
    setViewportWidth(1400);
    renderShell(<ShellNavigationRail navigation={PANE_NAVIGATION} />, { route: '/library' });
    expect(screen.queryByTestId('pane')).not.toBeInTheDocument();
  });

  it('is hidden in Console mode', () => {
    setViewportWidth(1400);
    const navigation: ShellNavigation<Key> = {
      ...PANE_NAVIGATION,
      destinationRoutes: { ...PANE_NAVIGATION.destinationRoutes!, library: ['/library', '/admin/library'] },
      console: { prefix: '/admin', sections: NAVIGATION.console!.sections },
    };
    renderShell(<ShellNavigationRail navigation={navigation} />, { route: '/admin/library', user: ADMIN });
    expect(screen.getByRole('navigation', { name: 'Console navigation' })).toBeInTheDocument();
    expect(screen.queryByTestId('pane')).not.toBeInTheDocument();
  });

  it('is not drawn for a destination the viewer cannot see', () => {
    setViewportWidth(1400);
    renderShell(<ShellNavigationRail navigation={PANE_NAVIGATION} />, { route: '/secret' });
    expect(screen.queryByTestId('pane')).not.toBeInTheDocument();
  });

  it('stays mounted across a route change inside the destination, and leaves with the expanded rail', async () => {
    setViewportWidth(1400);
    renderShell(
      <ShellLayout navigation={PANE_NAVIGATION}>
        <Pages />
      </ShellLayout>,
      { route: '/library' },
    );
    expect(screen.getByTestId('pane')).toHaveTextContent('/library');
    await userEvent.click(screen.getByRole('button', { name: 'go /library/two' }));
    expect(screen.getByTestId('pane')).toHaveTextContent('/library/two');
    expect(paneMounts).toBe(1);

    // Back to the medium rail: the pane goes with the expanded rail.
    await act(async () => setViewportWidth(1199));
    expect(screen.queryByTestId('pane')).not.toBeInTheDocument();
  });
});
