// Fixtures for the shell slice's tests (issue #868): a small navigation with a
// Console, two settings surfaces, and a render helper with the router, the
// shell's theme, a settled auth context and a test platform host.

import HomeIcon from '@mui/icons-material/Home';
import SettingsIcon from '@mui/icons-material/Settings';
import AdminIcon from '@mui/icons-material/AdminPanelSettings';
import PeopleIcon from '@mui/icons-material/People';
import WorkIcon from '@mui/icons-material/Work';
import { ThemeProvider } from '@mui/material/styles';
import { render as rtlRender } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import { AuthContext } from '../../src/identity/headless/index.js';
import type { AuthUser } from '../../src/identity/headless/index.js';
import type { SettingsSectionDef } from '../../src/settings/ui/index.js';
import { createShellTheme } from '../../src/shell/headless/index.js';
import type { ShellNavigation, ShellRailPreference } from '../../src/shell/headless/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import { USER, authValue } from '../identity/harness.js';

export const ADMIN_SECTIONS: SettingsSectionDef[] = [
  {
    label: 'People',
    cards: [
      { title: 'Users', description: 'Who may sign in.', Icon: PeopleIcon, path: '/admin/settings/users', permission: 'users:read' },
    ],
  },
  {
    label: 'Operations',
    cards: [
      { title: 'Jobs', description: 'The queue.', Icon: WorkIcon, path: '/admin/settings/jobs', permission: 'jobs:read' },
      { title: 'Job Insights', description: 'Trends.', Icon: WorkIcon, path: '/admin/settings/jobs/insights', permission: 'jobs:read' },
    ],
  },
];

export const USER_SECTIONS: SettingsSectionDef[] = [
  {
    label: 'Account',
    cards: [{ title: 'Profile', description: 'Your name.', Icon: SettingsIcon, path: '/settings/profile' }],
  },
];

export const railPreference = {
  railCollapsed: false as boolean,
  toggleRailCollapsed: vi.fn<() => void>(),
} satisfies ShellRailPreference;

export const NAVIGATION: ShellNavigation<'home' | 'settings' | 'console'> = {
  destinations: [
    { key: 'home', label: 'Home', compactLabel: 'Home', Icon: HomeIcon, path: '/' },
    { key: 'settings', label: 'User Settings', compactLabel: 'Settings', Icon: SettingsIcon, path: '/settings' },
    {
      key: 'console',
      label: 'Console',
      compactLabel: 'Console',
      Icon: AdminIcon,
      path: '/admin/settings',
      anyPermission: ['system_settings:read', 'users:read'],
      pinned: true,
    },
  ],
  destinationRoutes: { home: ['/'], settings: ['/settings'], console: ['/admin'] },
  settingsSurfaces: [
    { sections: ADMIN_SECTIONS, hubPath: '/admin/settings', hubTitle: 'Administration' },
    { sections: USER_SECTIONS, hubPath: '/settings', hubTitle: 'Settings' },
  ],
  console: { prefix: '/admin', sections: ADMIN_SECTIONS },
  useRailPreference: () => railPreference,
};

export const ADMIN: AuthUser = {
  ...USER,
  id: 'admin',
  email: 'admin@example.com',
  displayName: 'Admin User',
  permissions: ['user_settings:read', 'system_settings:read', 'users:read', 'jobs:read'],
};

function Where(): ReactElement {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

export interface ShellRenderOptions {
  route?: string;
  user?: AuthUser | null;
  /** Rendered around the element, inside everything else (a theme provider). */
  wrap?: (children: ReactNode) => ReactElement;
}

export const lightTheme = createShellTheme('light');

export function renderShell(ui: ReactElement, options: ShellRenderOptions = {}): RenderResult & { logout: ReturnType<typeof vi.fn> } {
  const { route = '/', user = USER, wrap = (children) => <>{children}</> } = options;
  const host = createTestPlatformHost({ permissions: user?.permissions ?? [], userId: user?.id ?? null });
  const auth = authValue({ user });
  const result = rtlRender(
    <MemoryRouter initialEntries={[route]}>
      <ThemeProvider theme={lightTheme}>
        <AuthContext.Provider value={auth}>
          <PlatformHostProvider host={host}>
            {wrap(
              <Routes>
                <Route path="*" element={<>{ui}<Where /></>} />
              </Routes>,
            )}
          </PlatformHostProvider>
        </AuthContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
  );
  return Object.assign(result, { logout: auth.logout as ReturnType<typeof vi.fn> });
}

/**
 * The emotion rules emitted for `element`, joined: jsdom's getComputedStyle
 * ignores `@media` blocks, so a responsive `sx` value is read off the styles.
 */
export function emittedRulesFor(element: Element): string {
  const emotionClass = [...element.classList].find((name) => name.startsWith('css-'));
  if (!emotionClass) throw new Error('element carries no emotion class');
  return [...document.querySelectorAll('style')]
    .map((style) => style.textContent ?? '')
    .join('')
    .split('}}')
    .filter((block) => block.includes(`.${emotionClass}{`))
    .join('}}');
}
