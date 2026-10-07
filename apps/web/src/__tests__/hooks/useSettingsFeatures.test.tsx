/**
 * `useSettingsFeatures` (#425, #537): the settings hubs' feature map merges
 * the app's AI flag with the packaged telemetry slice's (#704), stably.
 * Moved here from the telemetry config test when the slice was packaged.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { TelemetryConfigContext, type UseTelemetryConfigReturn } from '@marinoscar/platform-web/telemetry/headless';

import { useSettingsFeatures } from '../../hooks/useSettingsFeatures';
import { AiConfigContext, type UseAiConfigReturn } from '../../hooks/useAiConfig';
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
    expect(result.current).toEqual({ ai: true, telemetry: true });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('answers both off with no shell providers, without fetching', () => {
    const { result } = renderHook(() => useSettingsFeatures());
    expect(result.current).toEqual({ ai: false, telemetry: false });
  });
});
