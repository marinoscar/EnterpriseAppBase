// The shell's headless half (issue #868): the navigation model, the theme
// builder and the providers composition.

import HomeIcon from '@mui/icons-material/Home';
import { render, screen } from '@testing-library/react';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import {
  ShellProviders,
  createShellTheme,
  isDestinationVisible,
  owns,
  resolveActiveDestination,
  shellComponentOverrides,
  shellDestinationRoutes,
  shellPalette,
} from '../../src/shell/headless/index.js';
import type { ShellDestination } from '../../src/shell/headless/index.js';

describe('owns', () => {
  it('respects segment boundaries and keeps the root exact', () => {
    expect(owns('/settings', '/settings')).toBe(true);
    expect(owns('/settings', '/settings/profile')).toBe(true);
    expect(owns('/settings', '/settingsfoo')).toBe(false);
    expect(owns('/', '/')).toBe(true);
    expect(owns('/', '/settings')).toBe(false);
  });
});

describe('isDestinationVisible', () => {
  const has = (granted: string[]) => (permission: string) => granted.includes(permission);

  it('ANDs permission with anyPermission, and fails closed on a feature', () => {
    const both = { permission: 'ai:use', anyPermission: ['ai_config:read'] };
    expect(isDestinationVisible(both, has(['ai:use']))).toBe(false);
    expect(isDestinationVisible(both, has(['ai:use', 'ai_config:read']))).toBe(true);
    expect(isDestinationVisible({ anyPermission: ['a', 'b'] }, has(['b']))).toBe(true);
    expect(isDestinationVisible({ feature: 'ai' }, has([]))).toBe(false);
    expect(isDestinationVisible({ feature: 'ai' }, has([]), { ai: true })).toBe(true);
    expect(isDestinationVisible({}, has([]))).toBe(true);
  });
});

describe('resolveActiveDestination and shellDestinationRoutes', () => {
  const destinations: ShellDestination<'home' | 'console'>[] = [
    { key: 'home', label: 'Home', compactLabel: 'Home', Icon: HomeIcon, path: '/' },
    { key: 'console', label: 'Console', compactLabel: 'Console', Icon: HomeIcon, path: '/admin/settings' },
  ];

  it("defaults each destination's routes to its own path", () => {
    expect(shellDestinationRoutes({ destinations })).toEqual({ home: ['/'], console: ['/admin/settings'] });
    expect(resolveActiveDestination(shellDestinationRoutes({ destinations }), '/admin/users')).toBeNull();
  });

  it('uses the declared ownership table, longest prefix winning', () => {
    const routes = shellDestinationRoutes({ destinations, destinationRoutes: { home: ['/'], console: ['/admin'] } });
    expect(resolveActiveDestination(routes, '/admin/users')).toBe('console');
    expect(resolveActiveDestination(routes, '/')).toBe('home');
    expect(resolveActiveDestination(routes, '/login')).toBeNull();
    expect(resolveActiveDestination({ a: ['/x'], b: ['/x/y'] }, '/x/y/z')).toBe('b');
  });
});

describe('createShellTheme', () => {
  it('builds the shell base with the brand colour, keeping the hand-picked tints', () => {
    const light = createShellTheme('light', { palette: { primary: { main: '#c62828' } } });
    expect(light.palette.mode).toBe('light');
    expect(light.palette.primary.main).toBe('#c62828');
    expect(light.palette.primary.light).toBe('#42a5f5');
    expect(light.palette.primary.dark).toBe('#1565c0');
    expect(light.palette.background.default).toBe('#f5f5f5');
    expect(light.shape.borderRadius).toBe(8);
    expect(light.typography.fontFamily).toContain('Inter');
    expect(light.components?.MuiButton?.styleOverrides?.root).toEqual({ textTransform: 'none', fontWeight: 500 });
  });

  it('builds the dark theme and applies extend last', () => {
    const dark = createShellTheme('dark', { extend: (theme) => ({ ...theme, marker: true }) as typeof theme });
    expect(dark.palette.primary.main).toBe('#90caf9');
    expect(dark.palette.background.paper).toBe('#1e1e1e');
    expect((dark as unknown as { marker: boolean }).marker).toBe(true);
  });

  it('merges palette groups one level deep and other keys shallowly', () => {
    expect(shellPalette('light', { text: { primary: '#000' } }).text).toEqual({ primary: '#000', secondary: 'rgba(0, 0, 0, 0.6)' });
    expect(shellPalette('dark', { divider: '#444' }).divider).toBe('#444');
    expect(shellComponentOverrides('dark').MuiAppBar?.styleOverrides?.root).toEqual({
      boxShadow: 'none',
      borderBottom: '1px solid #333333',
    });
  });
});

describe('ShellProviders', () => {
  const Order = createContext<string[]>([]);
  function named(name: string) {
    return function Provider({ children }: { children: ReactNode }) {
      const outer = useContext(Order);
      return <Order.Provider value={[...outer, name]}>{children}</Order.Provider>;
    };
  }
  function Reader() {
    return <span data-testid="order">{useContext(Order).join(' > ')}</span>;
  }

  it('nests the stack with the first provider outermost and adds no element', () => {
    const { container } = render(
      <ShellProviders providers={[named('a'), named('b'), named('c')]}>
        <Reader />
      </ShellProviders>,
    );
    expect(screen.getByTestId('order')).toHaveTextContent('a > b > c');
    expect(container.firstElementChild?.tagName).toBe('SPAN');
  });

  it('renders the children alone for an empty stack', () => {
    render(<ShellProviders providers={[]}><Reader /></ShellProviders>);
    expect(screen.getByTestId('order')).toHaveTextContent('');
  });
});
