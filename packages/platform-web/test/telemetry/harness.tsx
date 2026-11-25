// The telemetry slice's test harness (issue #704): what the reference app's
// `apps/web/src/__tests__/utils/test-utils.tsx` gave these tests before they
// moved here, built from the package's own parts instead of the app's.
//
//   - a `createTestPlatformHost` transport (canned responses, recorded
//     requests) and a viewer with the fixture user's permissions;
//   - the telemetry adapters (AI on/off, the model list, no spinner);
//   - optionally a settled `TelemetryConfigContext` answer;
//   - a router and a theme passed through `withTelemetryTokens`.
//
// `render(ui, { wrapperOptions })` keeps the app helper's signature so the
// moved tests read as they did.

import { render as rtlRender, renderHook as rtlRenderHook } from '@testing-library/react';
import type { RenderHookOptions, RenderOptions, RenderResult } from '@testing-library/react';
import { CssBaseline } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import {
  TelemetryConfigContext,
  TelemetryWebAdaptersProvider,
  withTelemetryTokens,
} from '../../src/telemetry/headless/index.js';
import type {
  TelemetryAssistantModelOption,
  TelemetryPublicConfig,
  TelemetryWebAdapters,
  UseTelemetryConfigReturn,
} from '../../src/telemetry/headless/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import type { TestApiResponse, TestPlatformHost } from '../../src/testing/index.js';
import { mockTelemetryPublicConfigDisabled, mockTelemetryPublicConfigEnabled } from './fixtures/telemetry.js';

export * from '@testing-library/react';

/** A signed-in viewer, as the app's fixture users looked. */
export interface MockUser {
  id: string;
  permissions: string[];
}

/** Every permission the telemetry pages read. */
export const mockAdminUser: MockUser = {
  id: 'admin-user',
  permissions: [
    'telemetry:read',
    'telemetry:write',
    'telemetry:query',
    'ai:use',
    'ai_config:read',
    'system_settings:read',
    'system_settings:write',
  ],
};

/** A viewer without any telemetry permission. */
export const mockUser: MockUser = { id: 'plain-user', permissions: ['user_settings:read'] };

/** The light and dark test themes, through the token contract like the app's. */
export const lightTestTheme: Theme = withTelemetryTokens(createTheme({ palette: { mode: 'light' } }));
export const darkTestTheme: Theme = withTelemetryTokens(createTheme({ palette: { mode: 'dark' } }));

export interface WrapperOptions {
  route?: string;
  /** `location.state` of the initial entry. */
  routeState?: unknown;
  theme?: 'light' | 'dark' | Theme;
  /** The viewer. Default {@link mockAdminUser}; `null` for nobody. */
  user?: MockUser | null;
  /** A settled shell answer for `GET /telemetry/config`; omitted, no provider (hooks fetch). */
  telemetryEnabled?: boolean | TelemetryPublicConfig;
  /** The `useAiEnabled` adapter's answer. Default `false`. */
  aiEnabled?: boolean;
  /** The `useAssistantModels` adapter's models. Default none. */
  models?: TelemetryAssistantModelOption[];
  /** Replace any adapter outright. */
  adapters?: Partial<TelemetryWebAdapters>;
  /** Canned API responses for the test host. */
  responses?: Readonly<Record<string, TestApiResponse>>;
  /** A host to use as is (its viewer wins over `user`). */
  host?: TestPlatformHost;
}

/** The host and the wrapper for `options`. */
export function createWrapper(options: WrapperOptions = {}): {
  host: TestPlatformHost;
  Wrapper: (props: { children: ReactNode }) => ReactElement;
} {
  const user = options.user === undefined ? mockAdminUser : options.user;
  const host =
    options.host ??
    createTestPlatformHost({
      permissions: user?.permissions ?? [],
      userId: user?.id ?? null,
      ...(options.responses ? { responses: options.responses } : {}),
    });
  const adapters: TelemetryWebAdapters = {
    useAiEnabled: () => ({ enabled: options.aiEnabled === true, isLoading: false }),
    useAssistantModels: () => ({ models: options.models ?? [], isLoading: false, error: null }),
    ...options.adapters,
  };
  const telemetry = options.telemetryEnabled;
  const telemetryValue: UseTelemetryConfigReturn | null =
    telemetry === undefined
      ? null
      : {
          config:
            typeof telemetry === 'object'
              ? telemetry
              : telemetry
                ? mockTelemetryPublicConfigEnabled
                : mockTelemetryPublicConfigDisabled,
          isLoading: false,
          error: null,
          refresh: vi.fn().mockResolvedValue(undefined),
        };
  const theme =
    options.theme === 'dark' ? darkTestTheme : options.theme === undefined || options.theme === 'light' ? lightTestTheme : options.theme;
  const route = options.route ?? '/';
  const initialEntry = (() => {
    if (options.routeState === undefined) return route;
    const url = new URL(route, 'http://test.local');
    return { pathname: url.pathname, search: url.search, hash: url.hash, state: options.routeState };
  })();

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    const inner = telemetryValue ? (
      <TelemetryConfigContext.Provider value={telemetryValue}>{children}</TelemetryConfigContext.Provider>
    ) : (
      children
    );
    return (
      <MemoryRouter initialEntries={[initialEntry]}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <PlatformHostProvider host={host}>
            <TelemetryWebAdaptersProvider adapters={adapters}>{inner}</TelemetryWebAdaptersProvider>
          </PlatformHostProvider>
        </ThemeProvider>
      </MemoryRouter>
    );
  }
  return { host, Wrapper };
}

/** Testing Library's `render` inside the telemetry wrapper; also returns the host. */
export function render(
  ui: ReactElement,
  options: Omit<RenderOptions, 'wrapper'> & { wrapperOptions?: WrapperOptions } = {},
): RenderResult & { host: TestPlatformHost } {
  const { wrapperOptions, ...rest } = options;
  const { host, Wrapper } = createWrapper(wrapperOptions);
  return { ...rtlRender(ui, { wrapper: Wrapper, ...rest }), host };
}

/** Testing Library's `renderHook` inside the telemetry wrapper; also returns the host. */
export function renderHook<Result, Props>(
  hook: (props: Props) => Result,
  options: Omit<RenderHookOptions<Props>, 'wrapper'> & { wrapperOptions?: WrapperOptions } = {},
) {
  const { wrapperOptions, ...rest } = options;
  const { host, Wrapper } = createWrapper(wrapperOptions);
  return { ...rtlRenderHook(hook, { wrapper: Wrapper, ...rest }), host };
}
