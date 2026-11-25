/**
 * The complete deployment feature map the registries read
 * (`visibleSettingsSections`, `settingsPageTitle`, `isDestinationVisible`) —
 * issue #537, epic #528; the feature set is OPEN since #733.
 *
 * The map is `@marinoscar/platform-web/settings/headless`'s
 * `useSettingsFeatures()`: every resolver registered with
 * `registerSettingsFeature`, asked in registration order. This file is the
 * app's registration (the reference example of the extension point):
 *
 *   - `ai` from `useAiFeatures()` (#425) and `telemetry` from
 *     `useTelemetryFeatures()` (#537): the platform's two keys, read where
 *     they always were;
 *   - `oauthServer` from `useOAuthServerFeature()` (#1185: the OAuth server
 *     answers its metadata document), the platform's third key;
 *   - `orgs` from `useOrgsFeature()` (#726: `/api/auth/me` reports
 *     `tenancyMode: 'multi'`): THIS APP's key, added to the open
 *     `SettingsFeatureRegistry` by module augmentation below.
 *
 * All read the shell's providers only and never fetch, so without a provider
 * every feature answers "off" — fail closed, no network side effects.
 */
import { useTelemetryFeatures } from '@marinoscar/platform-web/telemetry/headless';
import {
  registerSettingsFeature,
  useSettingsFeatures as usePlatformSettingsFeatures,
} from '@marinoscar/platform-web/settings/headless';
import type { SettingsFeatures } from '@marinoscar/platform-web/settings/headless';
import { useAiFeatures } from '@marinoscar/platform-web/ai/headless';
import { useOAuthServerFeature, useOrgsFeature } from '@marinoscar/platform-web/identity/headless';

declare module '@marinoscar/platform-web/settings/headless' {
  interface SettingsFeatureRegistry {
    /** The deployment runs with `TENANCY_MODE=multi` (#726). */
    orgs: true;
  }
}

registerSettingsFeature('ai', () => useAiFeatures().ai);
registerSettingsFeature('telemetry', () => useTelemetryFeatures().telemetry);
registerSettingsFeature('orgs', useOrgsFeature);
// #1185: the platform's `oauthServer` key, read from the shell's
// `OAuthServerStatusProvider` (`platform/shellProviders.tsx`).
registerSettingsFeature('oauthServer', useOAuthServerFeature);

export interface SettingsFeatureFlags extends SettingsFeatures {
  ai: boolean;
  telemetry: boolean;
  orgs: boolean;
  oauthServer: boolean;
}

export function useSettingsFeatures(): SettingsFeatureFlags {
  return usePlatformSettingsFeatures() as SettingsFeatureFlags;
}
