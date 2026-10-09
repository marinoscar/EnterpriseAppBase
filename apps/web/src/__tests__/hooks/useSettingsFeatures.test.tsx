/**
 * `useSettingsFeatures` (#425, #537, #726): the settings hubs' feature map
 * merges the app's AI flag, the packaged telemetry slice's (#704) and the
 * multi-org flag read from the signed-in user, stably.
 * Moved here from the telemetry config test when the slice was packaged.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createElement, type ContextType, type ReactNode } from 'react';
import { AuthContext } from '@marinoscar/platform-web/identity/headless';
import { TelemetryConfigContext, type UseTelemetryConfigReturn } from '@marinoscar/platform-web/telemetry/headless';

import { useSettingsFeatures } from '../../hooks/useSettingsFeatures';
import { AiConfigContext, type UseAiConfigReturn } from '@marinoscar/platform-web/ai/headless';
import { mockAiPublicConfigEnabled } from '../mocks/fixtures/ai';
import { mockTelemetryPublicConfigEnabled } from '../mocks/fixtures/telemetry';

describe('useSettingsFeatures', () => {
  it('merges ai and telemetry into one stable map', () => {
    const ai: UseAiConfigReturn = { config: mockAiPublicConfigEnabled, isLoading: false, error: null, refresh: vi.fn() };
    const telemetry: UseTelemetryConfigReturn = {
      config: mockTelemetryPublicConfigEnabled,
      isLoading: false,
      error: null,
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        AiConfigContext.Provider,
        { value: ai },
        createElement(TelemetryConfigContext.Provider, { value: telemetry }, children),
      );
    const { result, rerender } = renderHook(() => useSettingsFeatures(), { wrapper });
    expect(result.current).toEqual({ ai: true, telemetry: true, orgs: false });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('answers every feature off with no shell providers, without fetching', () => {
    const { result } = renderHook(() => useSettingsFeatures());
    expect(result.current).toEqual({ ai: false, telemetry: false, orgs: false });
  });

  // #726: `orgs` is on iff `/api/auth/me` reports `tenancyMode: 'multi'`.
  it.each([
    ['multi', true],
    ['single', false],
    [undefined, false],
  ] as const)('answers orgs from the signed-in user (tenancyMode %s -> %s)', (tenancyMode, expected) => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        AuthContext.Provider,
        { value: { user: { tenancyMode } } as unknown as ContextType<typeof AuthContext> },
        children,
      );
    const { result } = renderHook(() => useSettingsFeatures(), { wrapper });
    expect(result.current.orgs).toBe(expected);
  });
});
