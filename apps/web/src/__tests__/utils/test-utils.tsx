import { ReactElement, ReactNode } from 'react';
import { render, renderHook as rtlRenderHook, RenderOptions, RenderResult } from '@testing-library/react';
import type { RenderHookOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CssBaseline } from '@mui/material';
import { vi } from 'vitest';

// Import AuthContext and ThemeContextProvider
import { AuthContext, IdentityWebAdaptersProvider } from '@marinoscar/platform-web/identity/headless';
import type { AuthProviderInfo as AuthProviderType } from '@marinoscar/platform-web/identity/headless';
import { ThemeContextProvider } from '../../contexts/ThemeContext';
import { AiConfigContext, type UseAiConfigReturn } from '@marinoscar/platform-web/ai/headless';
import {
  mockAiPublicConfigDisabled,
  mockAiPublicConfigEnabled,
} from '../mocks/fixtures/ai';
import {
  TelemetryConfigContext,
  TelemetryWebAdaptersProvider,
  type TelemetryPublicConfig,
  type UseTelemetryConfigReturn,
} from '@marinoscar/platform-web/telemetry/headless';
import {
  mockTelemetryPublicConfigDisabled,
  mockTelemetryPublicConfigEnabled,
} from '../mocks/fixtures/telemetry';
import { AppPlatformHostProvider } from '../../platform/platformHost';
import { appIdentityAdapters } from '../../platform/identityAdapters';
import { appTelemetryAdapters } from '../../platform/telemetryAdapters';
import { appAiAdapters } from '../../platform/aiAdapters';
import { AiWebAdaptersProvider } from '@marinoscar/platform-web/ai/headless';
import { JobsWebAdaptersProvider } from '@marinoscar/platform-web/jobs/headless';
import { appJobsAdapters } from '../../platform/jobsAdapters';
import { DbBackupWebAdaptersProvider } from '@marinoscar/platform-web/db-backup/headless';
import { appDbBackupAdapters } from '../../platform/dbBackupAdapters';

interface WrapperOptions {
  route?: string;
  /** `location.state` of the initial entry (`route`), e.g. a navigation handoff. */
  routeState?: unknown;
  theme?: 'light' | 'dark';
  authenticated?: boolean;
  user?: MockUser | null;
  isLoading?: boolean;
  providers?: AuthProviderType[];
  /** `AuthContext.sessionExpired`: the server refused a refresh. */
  sessionExpired?: boolean;
  /**
   * Stand in for the shell's `AiConfigProvider` (#425) with a settled answer:
   * `true` → AI on (`mockAiPublicConfigEnabled`), `false` → AI off. Omitted,
   * no provider is mounted — `useAiFeatures()` then answers "off" and
   * `useAiConfig()` fetches `GET /ai/config` itself (MSW default: disabled).
   */
  aiEnabled?: boolean;
  /**
   * Stand in for the shell's `TelemetryConfigProvider` (#537) with a settled
   * answer: `true` → available, collecting and the assistant on
   * (`mockTelemetryPublicConfigEnabled`), `false` → no store. An object is
   * used verbatim. Omitted, no provider is mounted — `useTelemetryFeatures()`
   * answers "off" and `useTelemetryConfig()` fetches `GET /telemetry/config`
   * itself (MSW default: unavailable).
   */
  telemetryEnabled?: boolean | TelemetryPublicConfig;
}

export interface MockUser {
  id: string;
  email: string;
  displayName: string | null;
  profileImageUrl: string | null;
  /** The sign-in provider's picture, whatever the chosen source (#367). */
  providerProfileImageUrl?: string | null;
  /** Whether an uploaded picture is stored, whatever the chosen source (#367). */
  hasUploadedProfileImage?: boolean;
  roles: { name: string }[];
  permissions: string[];
  isActive: boolean;
  createdAt: string;
  /** #726: `multi` turns the organization UI on. Absent reads as single-org. */
  tenancyMode?: 'single' | 'multi';
  activeOrg?: { id: string; name: string; slug: string } | null;
  memberships?: { orgId: string; name: string; slug: string; role: string }[];
}

export const mockUser: MockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  displayName: 'Test User',
  profileImageUrl: null,
  roles: [{ name: 'viewer' }],
  // `ai:use` (#425): seeded to every role by default, withholdable per role.
  permissions: ['user_settings:read', 'user_settings:write', 'ai:use'],
  isActive: true,
  createdAt: new Date().toISOString(),
};

export const mockAdminUser: MockUser = {
  id: 'admin-user-id',
  email: 'admin@example.com',
  displayName: 'Admin User',
  profileImageUrl: null,
  roles: [{ name: 'admin' }],
  permissions: [
    'user_settings:read',
    'user_settings:write',
    'system_settings:read',
    'system_settings:write',
    'users:read',
    'users:write',
    'rbac:manage',
    // Present because the seeded `admin` role grants them
    // (apps/api/prisma/seed.ts). The Allowlist tab gates on `allowlist:read`,
    // so an admin fixture missing it would test a user that cannot exist.
    'allowlist:read',
    'allowlist:write',
    // Present for the same reason as the allowlist pair above: the seeded
    // `admin` role grants the whole operations set (#256, epic #254), so an
    // admin fixture without them would be a user that cannot exist — and any
    // test rendering the real Console surface with this fixture would silently
    // be testing a hub with no `Operations` group.
    'jobs:read',
    'jobs:write',
    'nodes:read',
    'nodes:write',
    'db_backup:read',
    'db_backup:write',
    'db_backup:restore',
    // Present because the seeded `admin` role grants them (#320, epic #319).
    // Without these, every test rendering the real Console surface would
    // silently be testing a hub with no `Broadcasts` card — a user that cannot
    // exist, asserted against as though it could.
    'broadcasts:read',
    'broadcasts:write',
    // Present because the seeded `admin` role grants them (#355). Without
    // these, every test rendering the real Console surface would silently be
    // testing a hub with no `Web Push` card — a user that cannot exist.
    'push:read',
    'push:write',
    // Present because the seeded `admin` role grants them (#376, epic #372 —
    // `prisma/seed-data.ts`). Without these, every test rendering the real
    // Console surface would silently be testing a hub with no `Storage` card —
    // a user that cannot exist.
    'storage_config:read',
    'storage_config:write',
    'ai_config:read',
    'ai_config:write',
    'ai:use',
    // Present because the seeded `admin` role grants them (epic #528, story
    // #533 — `prisma/seed-data.ts`). Without these, every test rendering the
    // real Console surface would silently be testing a hub with no
    // `Telemetry` card — a user that cannot exist.
    'telemetry:read',
    'telemetry:write',
    'telemetry:query',
  ],
  isActive: true,
  createdAt: new Date().toISOString(),
};

// Default mock providers
const defaultMockProviders: AuthProviderType[] = [
  { name: 'google', authUrl: '/api/auth/google' },
];

// Mock Auth Provider for testing
interface MockAuthProviderProps {
  children: ReactNode;
  authenticated?: boolean;
  user?: MockUser | null;
  isLoading?: boolean;
  providers?: AuthProviderType[];
  sessionExpired?: boolean;
}

function MockAuthProvider({
  children,
  authenticated = true,
  user = mockUser,
  isLoading = false,
  providers = defaultMockProviders,
  sessionExpired = false,
}: MockAuthProviderProps) {
  const contextValue = {
    user: authenticated ? user : null,
    isLoading,
    isAuthenticated: authenticated,
    providers,
    sessionExpired,
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    refreshUser: vi.fn().mockResolvedValue(undefined),
    // #727: the packaged callback page hands the token to the session client.
    setAccessToken: vi.fn(),
    // #726: the org fields `AuthProvider` derives from `/api/auth/me`.
    activeOrg: (authenticated ? user?.activeOrg : null) ?? null,
    memberships: (authenticated ? user?.memberships : undefined) ?? [],
    switchOrg: vi.fn().mockResolvedValue(undefined),
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function createWrapper(options: WrapperOptions = {}) {
  const {
    route = '/',
    routeState,
    authenticated = true,
    user = mockUser,
    isLoading = false,
    providers = defaultMockProviders,
    sessionExpired = false,
    aiEnabled,
    telemetryEnabled,
  } = options;

  const aiValue: UseAiConfigReturn | null =
    aiEnabled === undefined
      ? null
      : {
          config: aiEnabled ? mockAiPublicConfigEnabled : mockAiPublicConfigDisabled,
          isLoading: false,
          error: null,
          refresh: vi.fn().mockResolvedValue(undefined),
        };

  const telemetryValue: UseTelemetryConfigReturn | null =
    telemetryEnabled === undefined
      ? null
      : {
          config:
            typeof telemetryEnabled === 'object'
              ? telemetryEnabled
              : telemetryEnabled
                ? mockTelemetryPublicConfigEnabled
                : mockTelemetryPublicConfigDisabled,
          isLoading: false,
          error: null,
          refresh: vi.fn().mockResolvedValue(undefined),
        };

  const initialEntry = (() => {
    if (routeState === undefined) return route;
    const url = new URL(route, 'http://test.local');
    return { pathname: url.pathname, search: url.search, hash: url.hash, state: routeState };
  })();

  return function Wrapper({ children }: { children: ReactNode }) {
    // The real platform host adapter (#696), innermost like the shell mounts
    // it, so a packaged page (the Doctor) runs through the app's transport and
    // the fixture user's permissions.
    // The telemetry adapters (#704), the jobs adapters (#854) and the
    // db-backup adapters (#740) beside it, as `App.tsx` mounts them.
    const withHost = (
      <TelemetryWebAdaptersProvider adapters={appTelemetryAdapters}>
        <JobsWebAdaptersProvider adapters={appJobsAdapters}>
          <DbBackupWebAdaptersProvider adapters={appDbBackupAdapters}>
            <AiWebAdaptersProvider adapters={appAiAdapters}>
              <AppPlatformHostProvider>{children}</AppPlatformHostProvider>
            </AiWebAdaptersProvider>
          </DbBackupWebAdaptersProvider>
        </JobsWebAdaptersProvider>
      </TelemetryWebAdaptersProvider>
    );
    const withTelemetry = telemetryValue ? (
      <TelemetryConfigContext.Provider value={telemetryValue}>{withHost}</TelemetryConfigContext.Provider>
    ) : (
      withHost
    );
    return (
      <MemoryRouter initialEntries={[initialEntry]}>
        <ThemeContextProvider>
          <CssBaseline />
          <MockAuthProvider
            authenticated={authenticated}
            user={user}
            isLoading={isLoading}
            providers={providers}
            sessionExpired={sessionExpired}
          >
            {/* The identity adapters (#727), around the routes as `App.tsx` mounts them. */}
            <IdentityWebAdaptersProvider adapters={appIdentityAdapters}>
              {aiValue ? (
                <AiConfigContext.Provider value={aiValue}>{withTelemetry}</AiConfigContext.Provider>
              ) : (
                withTelemetry
              )}
            </IdentityWebAdaptersProvider>
          </MockAuthProvider>
        </ThemeContextProvider>
      </MemoryRouter>
    );
  };
}

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  wrapperOptions?: WrapperOptions;
}

export function renderWithProviders(
  ui: ReactElement,
  options: CustomRenderOptions = {},
): RenderResult {
  const { wrapperOptions, ...renderOptions } = options;

  return render(ui, {
    wrapper: createWrapper(wrapperOptions),
    ...renderOptions,
  });
}

// Re-export everything from testing library
export * from '@testing-library/react';
export { renderWithProviders as render };

/**
 * `renderHook` inside the same providers `render` mounts (the real platform
 * host, so a packaged hook reaches the app's transport). The packaged hooks
 * read their transport from the host (#890).
 */
export function renderHookWithProviders<Result, Props>(
  hook: (props: Props) => Result,
  options: Omit<RenderHookOptions<Props>, 'wrapper'> & { wrapperOptions?: WrapperOptions } = {},
) {
  const { wrapperOptions, ...rest } = options;
  return rtlRenderHook(hook, { ...rest, wrapper: createWrapper(wrapperOptions) });
}
export { renderHookWithProviders as renderHook };
