import { describe, it, expect, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook as rtlRenderHook, waitFor, screen } from '@testing-library/react';
import {
  TELEMETRY_CONFIG_DISABLED,
  TelemetryConfigContext,
  isTelemetryOn,
  useTelemetryConfig,
  useTelemetryFeatures,
  type UseTelemetryConfigReturn,
} from '../../../src/telemetry/headless/context/telemetryConfig.js';
import { TelemetryConfigProvider } from '../../../src/telemetry/headless/context/TelemetryConfigProvider.js';
import { RequireTelemetryEnabled } from '../../../src/telemetry/headless/guards/RequireTelemetryEnabled.js';
import { createTestApiError, createTestPlatformHost } from '../../../src/testing/index.js';
import { render, renderHook } from '../harness.js';
import {
  mockTelemetryPublicConfigDisabled,
  mockTelemetryPublicConfigEnabled,
} from '../fixtures/telemetry.js';

/**
 * `useTelemetryConfig` / `useTelemetryFeatures` / `RequireTelemetryEnabled`
 * (issue #537, epic #528) — the telemetry feature flag, mirroring the AI one.
 * The app's `useSettingsFeatures` merge is tested in the app (#704).
 */

function telemetryValue(config = mockTelemetryPublicConfigEnabled): UseTelemetryConfigReturn {
  return { config, isLoading: false, error: null, refresh: vi.fn().mockResolvedValue(undefined) };
}

function withTelemetry(value: UseTelemetryConfigReturn | null) {
  return ({ children }: { children: ReactNode }) =>
    createElement(TelemetryConfigContext.Provider, { value }, children);
}

describe('isTelemetryOn', () => {
  it('needs both a store and collection switched on', () => {
    expect(isTelemetryOn({ available: true, enabled: true, assistantEnabled: false })).toBe(true);
    expect(isTelemetryOn({ available: false, enabled: true, assistantEnabled: true })).toBe(false);
    expect(isTelemetryOn({ available: true, enabled: false, assistantEnabled: true })).toBe(false);
  });
});

describe('useTelemetryConfig — standalone', () => {
  it('starts fail-closed and then fetches GET /telemetry/config through the host', async () => {
    const { result, host } = renderHook(() => useTelemetryConfig(), {
      wrapperOptions: { responses: { 'GET /telemetry/config': mockTelemetryPublicConfigEnabled } },
    });
    expect(result.current.config).toEqual(TELEMETRY_CONFIG_DISABLED);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.config).toEqual(mockTelemetryPublicConfigEnabled);
    expect(host.requests).toEqual([{ method: 'GET', path: '/telemetry/config' }]);
  });

  it('stays disabled when the first fetch fails', async () => {
    const { result } = renderHook(() => useTelemetryConfig(), {
      wrapperOptions: {
        responses: {
          'GET /telemetry/config': () => {
            throw createTestApiError(500, 'boom');
          },
        },
      },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.config).toEqual(TELEMETRY_CONFIG_DISABLED);
    expect(result.current.error).toBe('boom');
  });

  it('stays disabled, with an error, when there is neither a host nor a transport', async () => {
    const { result } = rtlRenderHook(() => useTelemetryConfig());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.config).toEqual(TELEMETRY_CONFIG_DISABLED);
    expect(result.current.error).toBe('Failed to load telemetry configuration');
  });

  it('reads the provider value instead of fetching when one is mounted', () => {
    const value = telemetryValue();
    const { result } = rtlRenderHook(() => useTelemetryConfig(), { wrapper: withTelemetry(value) });
    expect(result.current).toBe(value);
  });
});

describe('TelemetryConfigProvider', () => {
  it('fetches once with the transport it is given, above any platform host (#704)', async () => {
    const transport = createTestPlatformHost({
      responses: { 'GET /telemetry/config': mockTelemetryPublicConfigEnabled },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TelemetryConfigProvider api={transport.api}>{children}</TelemetryConfigProvider>
    );
    const { result } = rtlRenderHook(() => ({ config: useTelemetryConfig(), features: useTelemetryFeatures() }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.features.telemetry).toBe(true));
    expect(result.current.config.config).toEqual(mockTelemetryPublicConfigEnabled);
    expect(transport.requests).toHaveLength(1);
  });
});

describe('useTelemetryFeatures', () => {
  it('answers off with no provider, without fetching', () => {
    const { result, host } = renderHook(() => useTelemetryFeatures());
    expect(result.current).toEqual({ telemetry: false });
    expect(host.requests).toEqual([]);
  });

  it('answers on only when the provider says available and enabled', () => {
    const on = rtlRenderHook(() => useTelemetryFeatures(), { wrapper: withTelemetry(telemetryValue()) });
    expect(on.result.current.telemetry).toBe(true);
    const off = rtlRenderHook(() => useTelemetryFeatures(), {
      wrapper: withTelemetry(telemetryValue(mockTelemetryPublicConfigDisabled)),
    });
    expect(off.result.current.telemetry).toBe(false);
  });
});

describe('RequireTelemetryEnabled', () => {
  it('renders its children while telemetry is on', () => {
    render(<RequireTelemetryEnabled>inside</RequireTelemetryEnabled>, {
      wrapperOptions: { telemetryEnabled: true },
    });
    expect(screen.getByText('inside')).toBeInTheDocument();
  });

  it('renders the fallback while telemetry is off', () => {
    render(
      <RequireTelemetryEnabled fallback={<span>fallback</span>}>inside</RequireTelemetryEnabled>,
      { wrapperOptions: { telemetryEnabled: false } },
    );
    expect(screen.getByText('fallback')).toBeInTheDocument();
    expect(screen.queryByText('inside')).not.toBeInTheDocument();
  });

  it('treats an available store with collection off as off', () => {
    render(
      <RequireTelemetryEnabled fallback={<span>fallback</span>}>inside</RequireTelemetryEnabled>,
      { wrapperOptions: { telemetryEnabled: { available: true, enabled: false, assistantEnabled: true } } },
    );
    expect(screen.getByText('fallback')).toBeInTheDocument();
  });

  it('shows the loading element, else the adapter spinner, while the first answer is in flight', () => {
    const loading = { config: TELEMETRY_CONFIG_DISABLED, isLoading: true, error: null, refresh: vi.fn() };
    const { unmount } = render(
      <TelemetryConfigContext.Provider value={loading}>
        <RequireTelemetryEnabled loading={<span>waiting</span>}>inside</RequireTelemetryEnabled>
      </TelemetryConfigContext.Provider>,
    );
    expect(screen.getByText('waiting')).toBeInTheDocument();
    unmount();

    render(
      <TelemetryConfigContext.Provider value={loading}>
        <RequireTelemetryEnabled>inside</RequireTelemetryEnabled>
      </TelemetryConfigContext.Provider>,
      { wrapperOptions: { adapters: { Spinner: () => <span>app spinner</span> } } },
    );
    expect(screen.getByText('app spinner')).toBeInTheDocument();
    expect(screen.queryByText('inside')).not.toBeInTheDocument();
  });
});
