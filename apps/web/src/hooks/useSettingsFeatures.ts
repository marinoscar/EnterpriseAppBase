/**
 * The complete deployment feature map the registries read
 * (`visibleSettingsSections`, `settingsPageTitle`, `isDestinationVisible`) —
 * issue #537, epic #528.
 *
 * One hook so every navigation surface asks for the SAME map: `ai` from
 * `useAiFeatures()` (#425), `telemetry` from `useTelemetryFeatures()` and
 * `orgs` from `useOrgsFeature()` (#726: `/api/auth/me` reports
 * `tenancyMode: 'multi'`). All read the shell's providers only and never
 * fetch, so without a provider every feature answers "off" — fail closed, no
 * network side effects.
 */
import { useMemo } from 'react';
import type { SettingsFeatures } from '../config/adminSections';
import { useAiFeatures } from './useAiConfig';
import { useTelemetryFeatures } from '@marinoscar/platform-web/telemetry/headless';
import { useOrgsFeature } from './useOrgsFeature';

export interface SettingsFeatureFlags extends SettingsFeatures {
  ai: boolean;
  telemetry: boolean;
  orgs: boolean;
}

export function useSettingsFeatures(): SettingsFeatureFlags {
  const { ai } = useAiFeatures();
  const { telemetry } = useTelemetryFeatures();
  const orgs = useOrgsFeature();
  return useMemo(() => ({ ai, telemetry, orgs }), [ai, telemetry, orgs]);
}
