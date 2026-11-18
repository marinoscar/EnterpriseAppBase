// Fixtures and a mount helper for the OAuth page tests (PP-15.7, #1185).
// Placeholder hosts and names only (`*.example.test`).

import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { OAuthAdminGrantView, OAuthClientView, OAuthConsentRequest, OAuthGrantView } from '@marinoscar/platform-contract/identity';

import { PlatformHostProvider } from '../../src/core/index.js';
import { AuthContext, IdentityWebAdaptersProvider } from '../../src/identity/headless/index.js';
import type { AuthContextValue, AuthUser, IdentityWebAdapters } from '../../src/identity/headless/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import type { TestApiResponse, TestPlatformHost } from '../../src/testing/index.js';
import { USER, authValue } from './harness.js';

export const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
export const ORG_A = '22222222-2222-4222-8222-222222222222';
export const ORG_B = '33333333-3333-4333-8333-333333333333';

const OLD = '2026-01-01T00:00:00.000Z';

/** A consent request with four scopes: two low (one required), one elevated, one high. */
export function consentRequest(overrides: Partial<OAuthConsentRequest> = {}): OAuthConsentRequest {
  return {
    id: REQUEST_ID,
    client: {
      name: 'Example Assistant',
      host: 'chat.example.test',
      logoUri: 'https://chat.example.test/logo.png',
      kind: 'cimd',
      firstSeenAt: OLD,
      isNewToDeployment: false,
    },
    redirectHost: 'callback.example.test',
    isLoopbackRedirect: false,
    resource: { id: 'runs', name: 'Runs' },
    scopes: [
      { id: 'runs:read', title: 'Read runs', description: 'See your runs.', risk: 'low', grantable: true, required: true, alreadyGranted: false },
      { id: 'runs:list', title: 'List runs', description: 'List your runs.', risk: 'low', grantable: true, required: false, alreadyGranted: false },
      { id: 'runs:write', title: 'Start runs', description: 'Start and stop runs.', risk: 'elevated', grantable: true, required: false, alreadyGranted: false },
      { id: 'runs:admin', title: 'Delete runs', description: 'Deletes runs for good.', risk: 'high', grantable: true, required: false, alreadyGranted: false },
    ],
    offlineAccess: true,
    organizations: [],
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function grant(overrides: Partial<OAuthGrantView> = {}): OAuthGrantView {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    client: { name: 'Example Assistant', host: 'chat.example.test', logoUri: null },
    resource: { id: 'runs', name: 'Runs' },
    scopes: [
      { id: 'runs:read', title: 'Read runs' },
      { id: 'runs:write', title: 'Start runs' },
    ],
    organization: null,
    createdAt: OLD,
    lastUsedAt: null,
    ...overrides,
  };
}

export function client(overrides: Partial<OAuthClientView> = {}): OAuthClientView {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    clientId: 'oc_example',
    kind: 'registered',
    name: 'Example Desk',
    host: 'desk.example.test',
    redirectUris: ['https://desk.example.test/callback'],
    tokenEndpointAuthMethod: 'client_secret_basic',
    activeGrantCount: 3,
    lastUsedAt: null,
    disabledAt: null,
    disabled: false,
    createdAt: OLD,
    ...overrides,
  };
}

/** A user's grant to {@link client} as an administrator sees it (`GET /api/admin/oauth/grants`). */
export function adminGrant(overrides: Partial<OAuthAdminGrantView> = {}): OAuthAdminGrantView {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    user: { id: '88888888-8888-4888-8888-888888888888', email: 'person.a@example.test' },
    client: { id: '55555555-5555-4555-8555-555555555555', name: 'Example Desk', host: 'desk.example.test' },
    resource: { id: 'runs', name: 'Runs' },
    scopes: ['runs:read', 'runs:write'],
    organization: { id: ORG_A, name: 'Org Alpha' },
    createdAt: OLD,
    lastUsedAt: null,
    revokedAt: null,
    revokedReason: null,
    ...overrides,
  };
}

export const SERVER_SETTINGS = {
  enabled: false,
  accessTokenTtlMinutes: 60,
  refreshTokenTtlDays: 30,
  refreshTokenMaxAgeDays: 180,
  alwaysIssueRefreshToken: true,
  clientIdMetadataDocuments: true,
  dynamicClientRegistration: true,
  allowedClientHosts: ['chat.example.test'],
  allowAnyClientHost: false,
  allowLoopbackClients: true,
  dynamicClientUnusedDays: 7,
};

/** Renders the current location for a router assertion. */
export function LocationProbe(): ReactElement {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

export interface MountOptions {
  route?: string;
  path?: string;
  user?: AuthUser | null;
  permissions?: string[];
  responses?: Record<string, TestApiResponse>;
  auth?: Partial<AuthContextValue>;
  adapters?: IdentityWebAdapters;
  /** Extra providers inside the host (e.g. the status provider). */
  wrap?: (children: ReactNode) => ReactNode;
  dark?: boolean;
}

/** Mounts `ui` at `path` under a router, a theme, an auth context and a test platform host. */
export function mountOAuth(ui: ReactElement, options: MountOptions = {}): RenderResult & { host: TestPlatformHost } {
  const user = options.user === undefined ? { ...USER, permissions: options.permissions ?? USER.permissions } : options.user;
  const host = createTestPlatformHost({ permissions: options.permissions ?? [], responses: options.responses ?? {} });
  const theme = createTheme({ palette: { mode: options.dark ? 'dark' : 'light' } });
  const route = options.route ?? '/';
  const path = options.path ?? route.split('?')[0] ?? '/';
  const inner = options.wrap ? options.wrap(ui) : ui;
  const result = render(
    <MemoryRouter initialEntries={[route]}>
      <ThemeProvider theme={theme}>
        <AuthContext.Provider value={authValue({ user, ...options.auth })}>
          <PlatformHostProvider host={host}>
            <IdentityWebAdaptersProvider adapters={options.adapters ?? { appName: 'Product X' }}>
              <Routes>
                <Route path={path} element={inner} />
                <Route path="*" element={<LocationProbe />} />
              </Routes>
            </IdentityWebAdaptersProvider>
          </PlatformHostProvider>
        </AuthContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
  );
  return Object.assign(result, { host });
}
