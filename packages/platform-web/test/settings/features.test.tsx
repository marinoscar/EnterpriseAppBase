// The open settings feature registry (#733): an app adds a key by module
// augmentation and registers how to read it; useSettingsFeatures() asks every
// resolver, and the set is fixed once it rendered.
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';

import {
  isFeatureEnabled,
  registerSettingsFeature,
  registeredSettingsFeatures,
  resetSettingsFeaturesForTests,
  useSettingsFeatures,
  type SettingsFeatureKey,
} from '../../src/settings/headless/features.js';

declare module '../../src/settings/headless/index.js' {
  interface SettingsFeatureRegistry {
    /** A test app's own feature. */
    coachMode: true;
  }
}

afterEach(() => resetSettingsFeaturesForTests());

describe('settings feature registry', () => {
  it('accepts an app-augmented key at the type level', () => {
    expectTypeOf<'coachMode'>().toMatchTypeOf<SettingsFeatureKey>();
    expectTypeOf<'ai' | 'telemetry'>().toMatchTypeOf<SettingsFeatureKey>();
    // @ts-expect-error -- a key nobody declared is refused
    const nope: SettingsFeatureKey = 'nope';
    void nope;
  });

  it('asks every registered resolver, in registration order', () => {
    registerSettingsFeature('ai', () => true);
    registerSettingsFeature('coachMode', () => false);
    expect(registeredSettingsFeatures()).toEqual(['ai', 'coachMode']);
    const { result } = renderHook(() => useSettingsFeatures());
    expect(result.current).toEqual({ ai: true, coachMode: false });
    expect(isFeatureEnabled('ai', result.current)).toBe(true);
    expect(isFeatureEnabled('coachMode', result.current)).toBe(false);
    expect(isFeatureEnabled(undefined, result.current)).toBe(true);
  });

  it('refuses a NEW key once the map rendered, but lets a key be re-registered (hot reload)', () => {
    registerSettingsFeature('ai', () => false);
    renderHook(() => useSettingsFeatures());
    expect(() => registerSettingsFeature('telemetry', () => true)).toThrow(/fixed once useSettingsFeatures/);
    expect(() => registerSettingsFeature('ai', () => true)).not.toThrow();
  });

  it('answers off for an unregistered feature', () => {
    const { result } = renderHook(() => useSettingsFeatures());
    expect(isFeatureEnabled('telemetry', result.current)).toBe(false);
  });
});
