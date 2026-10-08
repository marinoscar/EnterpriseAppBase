// =============================================================================
// The deployment feature map the settings registries read (issue #733)
// =============================================================================
//
// A settings card may carry `feature: 'ai'`: it exists only while that
// deployment feature is on. The set of feature keys is OPEN (rung 2, module
// augmentation): the platform declares `ai` and `telemetry`, an app adds its
// own by augmenting `SettingsFeatureRegistry` and registering how to read it
// (`registerSettingsFeature(key, useIsOn)`). `useSettingsFeatures()` asks every
// registered resolver, in registration order, so every navigation surface
// (the hubs, the rail, the AppBar title resolver) reads the SAME map.
//
// The resolvers are React hooks (they read the app's context), so the set is
// FIXED once the first `useSettingsFeatures()` render ran: a later
// registration would change the hook order mid-session. Register at module
// scope, before the first render.
// =============================================================================

import { useMemo } from 'react';

/**
 * The known deployment feature keys, as an augmentation target. The platform
 * declares `ai` and `telemetry`; an app adds a key with module augmentation
 * and registers its resolver with {@link registerSettingsFeature}.
 *
 * @example
 * ```ts
 * declare module '@marinoscar/platform-web/settings/headless' {
 *   interface SettingsFeatureRegistry { orgs: true }
 * }
 * registerSettingsFeature('orgs', useOrgsFeature);
 * ```
 *
 * @stability experimental
 */
export interface SettingsFeatureRegistry {
  /** AI is switched on for this deployment. */
  ai: true;
  /** A telemetry store is deployed and collection is on. */
  telemetry: true;
}

/**
 * One deployment feature key a settings card may be gated on.
 *
 * @stability experimental
 */
export type SettingsFeatureKey = keyof SettingsFeatureRegistry & string;

/**
 * Which features are on. Partial: a missing key is "off" (fail closed).
 *
 * @stability experimental
 */
export type SettingsFeatures = Partial<Record<SettingsFeatureKey, boolean>>;

/**
 * Whether a card's `feature` gate (if any) is open under `features`.
 *
 * @param feature - the card's feature, or `undefined` for an always-present card.
 * @param features - the feature map; omitted, every gated card is closed.
 * @returns `true` when the card exists in this deployment.
 *
 * @stability stable
 */
export function isFeatureEnabled(feature: SettingsFeatureKey | undefined, features: SettingsFeatures = {}): boolean {
  return feature === undefined || features[feature] === true;
}

type FeatureResolver = () => boolean;

const resolvers = new Map<string, FeatureResolver>();
let sealed = false;

/**
 * Registers how one feature is read: a React hook returning whether it is on.
 * Call at module scope, before the first render.
 *
 * Registering a key again replaces its resolver in place (a hot module
 * reload re-runs the registering module); a NEW key after the first
 * `useSettingsFeatures()` render would change the hook order and is refused.
 *
 * @param key - the feature key (augment {@link SettingsFeatureRegistry} for an app key).
 * @param useIsOn - a hook reading the app's own context; it must never fetch.
 * @throws Error for a new key once `useSettingsFeatures()` has rendered.
 *
 * @example
 * ```ts
 * registerSettingsFeature('ai', () => useAiFeatures().ai);
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerSettingsFeature(key: SettingsFeatureKey, useIsOn: FeatureResolver): void {
  if (sealed && !resolvers.has(key)) {
    throw new Error(
      `registerSettingsFeature("${key}"): the feature set is fixed once useSettingsFeatures() rendered; register at module scope.`,
    );
  }
  resolvers.set(key, useIsOn);
}

/**
 * The registered feature keys, in registration order.
 *
 * @returns the keys.
 *
 * @stability experimental
 */
export function registeredSettingsFeatures(): SettingsFeatureKey[] {
  return [...resolvers.keys()] as SettingsFeatureKey[];
}

/**
 * The complete deployment feature map: every registered resolver, asked in
 * registration order. Without a resolver a feature is off.
 *
 * @returns the feature map.
 *
 * @stability experimental
 */
export function useSettingsFeatures(): SettingsFeatures {
  sealed = true;
  const entries: Array<[string, boolean]> = [];
  for (const [key, useIsOn] of resolvers) entries.push([key, useIsOn()]);
  const signature = entries.map(([key, on]) => `${key}:${on ? 1 : 0}`).join(',');
  return useMemo(() => Object.fromEntries(entries) as SettingsFeatures, [signature]);
}

/**
 * Clears the feature registry (tests only).
 *
 * @internal
 */
export function resetSettingsFeaturesForTests(): void {
  resolvers.clear();
  sealed = false;
}
