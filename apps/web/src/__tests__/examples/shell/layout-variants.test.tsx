/**
 * The shell's two layout affordances (issue #1080), as an app uses them:
 *
 *  - a map-like page asks for a full-bleed `<main>` with `useShellMainVariant`,
 *    without remounting the shell;
 *  - a destination declares a `contextPane` that the packaged rail draws beside
 *    itself when expanded (desktop), so the destination's contents are one
 *    click away with no drill-down.
 *
 * Neither is a breakpoint gate; the `shell-layout-variants` conformance suite
 * (registered in `conformance.test.ts`) proves it.
 */
import HomeIcon from '@mui/icons-material/Home';
import FolderIcon from '@mui/icons-material/Folder';
import MapIcon from '@mui/icons-material/Map';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { act, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { PlatformHostProvider } from '@marinoscar/platform-web/core';
import type { ShellContextPaneProps, ShellNavigation } from '@marinoscar/platform-web/shell/headless';
import { ShellLayout, useShellMainVariant } from '@marinoscar/platform-web/shell/ui';
import { createTestPlatformHost } from '@marinoscar/platform-web/testing';

import { resetViewportWidth, setViewportWidth } from '../../setup';

function ProjectsPane({ pathname }: ShellContextPaneProps): ReactElement {
  return <p>Projects pane at {pathname}</p>;
}

function MapPage(): ReactElement {
  useShellMainVariant('full-bleed');
  return <p>Map canvas</p>;
}

const NAVIGATION: ShellNavigation<'home' | 'projects' | 'map'> = {
  destinations: [
    { key: 'home', label: 'Home', compactLabel: 'Home', Icon: HomeIcon, path: '/' },
    { key: 'projects', label: 'Projects', compactLabel: 'Projects', Icon: FolderIcon, path: '/projects', contextPane: ProjectsPane },
    { key: 'map', label: 'Map', compactLabel: 'Map', Icon: MapIcon, path: '/map' },
  ],
  useRailPreference: () => ({ railCollapsed: false, toggleRailCollapsed: () => undefined }),
};

function renderAt(route: string) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <PlatformHostProvider host={createTestPlatformHost({ permissions: [] })}>
        <MemoryRouter initialEntries={[route]}>
          <ShellLayout navigation={NAVIGATION} appBar={<div />} banners={<p>Maintenance banner</p>}>
            <Routes>
              <Route path="/map" element={<MapPage />} />
              <Route path="*" element={<p>Page</p>} />
            </Routes>
          </ShellLayout>
        </MemoryRouter>
      </PlatformHostProvider>
    </ThemeProvider>,
  );
}

afterEach(() => resetViewportWidth());

describe('shell layout variants in an app', () => {
  it('draws a full-bleed map page without the banners', () => {
    act(() => setViewportWidth(1440));
    renderAt('/map');
    expect(screen.getByText('Map canvas')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('data-main-variant', 'full-bleed');
    expect(screen.queryByText('Maintenance banner')).not.toBeInTheDocument();
  });

  it('draws the destination context pane beside the expanded rail on desktop only', () => {
    act(() => setViewportWidth(1440));
    const desktop = renderAt('/projects/alpha');
    expect(screen.getByRole('complementary', { name: 'Projects' })).toHaveTextContent('Projects pane at /projects/alpha');
    desktop.unmount();

    act(() => setViewportWidth(1000));
    renderAt('/projects/alpha');
    expect(screen.queryByRole('complementary', { name: 'Projects' })).not.toBeInTheDocument();
  });
});
