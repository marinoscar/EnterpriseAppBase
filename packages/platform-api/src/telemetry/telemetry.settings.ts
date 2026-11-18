// =============================================================================
// The `telemetry` system-settings namespace, as data (issue #677; exported by #703)
// =============================================================================
//
// The slice owns the namespace's SHAPE (the contract's `telemetrySettingsSchema`,
// #702), its defaults and its merge rule; the app declares it in its own
// settings-namespace registry with these (the reference app:
// `apps/api/src/platform/telemetry/telemetry.system-settings.ts`), and stores
// and validates it. Pure data: no Nest, no registry call.
//
// NO CREDENTIAL HERE: the assistant's provider key is resolved by the app's AI
// platform like every other AI call (`TELEMETRY_SETTINGS_CARRIES_NO_SECRET`).
// =============================================================================

import type { TelemetrySettings } from '@marinoscar/platform-contract/telemetry';

/**
 * The namespace key under which the app stores the telemetry policy.
 *
 * @stability stable
 */
export const TELEMETRY_SETTINGS_NAMESPACE = 'telemetry' as const;

/**
 * The namespace's one-line description for the app's settings catalog.
 *
 * @stability experimental
 */
export const TELEMETRY_SETTINGS_DESCRIPTION =
  'Telemetry policy: whether telemetry is collected, how long it is kept, the bounds of an ad-hoc query, and the AI assistant over it.';

/**
 * The namespace's defaults: OFF and INERT, matching every namespace that ships
 * ahead of its consumers. A fresh deployment does not collect or retain
 * observability data nobody asked for.
 *
 * - `instanceId: null` follows the app's slug, resolved at the point of use,
 *   so a renamed fork follows its new name until an administrator overrides it.
 * - `assistant.enabled: false` on top of `enabled: false`: a second, narrower switch.
 * - `assistant.shareResults: true`: an assistant that cannot see the rows it
 *   queried cannot explain them; an administrator turns it off deliberately.
 *
 * @stability stable
 */
export const TELEMETRY_SETTINGS_DEFAULTS: TelemetrySettings = {
  enabled: false,
  retentionDays: 30,
  instanceId: null,
  query: {
    maxRows: 10000,
    timeoutSeconds: 30,
  },
  assistant: {
    enabled: false,
    provider: null,
    modelId: null,
    shareResults: true,
    maxResultRowsToModel: 100,
    maxSteps: 15,
  },
};

/**
 * A partial update of the namespace: every field optional, `instanceId`,
 * `assistant.provider` and `assistant.modelId` nullable (an explicit `null`
 * clears them).
 *
 * @stability experimental
 */
export interface TelemetrySettingsPatch {
  /** Whether telemetry is exported. */
  enabled?: boolean;
  /** The store's TTL, in days. */
  retentionDays?: number;
  /** The `app.instance.id` label; `null` follows the app's slug. */
  instanceId?: string | null;
  /** The bounds of an ad-hoc query. */
  query?: {
    /** Rows a query returns at most. */
    maxRows?: number;
    /** A query's timeout, seconds. */
    timeoutSeconds?: number;
  };
  /** The telemetry assistant. */
  assistant?: {
    /** Whether the assistant is on. */
    enabled?: boolean;
    /** Its AI provider; `null` clears it. */
    provider?: string | null;
    /** Its model; `null` clears it. */
    modelId?: string | null;
    /** Whether row values are shown to the model. */
    shareResults?: boolean;
    /** Rows per statement the model sees at most. */
    maxResultRowsToModel?: number;
    /** Model round-trips per turn at most. */
    maxSteps?: number;
  };
}

/**
 * Merges a patch over the current value, field by field, one level deep into
 * `query` and `assistant`. An absent field keeps its stored value; the three
 * NULLABLE fields (`instanceId`, `assistant.provider`, `assistant.modelId`)
 * take an explicit `null` as "clear" (`!== undefined`, never `??`, or an
 * operator could never clear a provider once set).
 *
 * @param current - the stored value.
 * @param patch - the update, or `undefined` for none.
 * @returns the merged value.
 *
 * @stability stable
 */
export function mergeTelemetrySettings(
  current: TelemetrySettings,
  patch: TelemetrySettingsPatch | undefined,
): TelemetrySettings {
  return {
    enabled: patch?.enabled ?? current.enabled,
    retentionDays: patch?.retentionDays ?? current.retentionDays,
    instanceId: patch?.instanceId !== undefined ? patch.instanceId : current.instanceId,
    query: {
      maxRows: patch?.query?.maxRows ?? current.query.maxRows,
      timeoutSeconds: patch?.query?.timeoutSeconds ?? current.query.timeoutSeconds,
    },
    assistant: {
      enabled: patch?.assistant?.enabled ?? current.assistant.enabled,
      provider: patch?.assistant?.provider !== undefined ? patch.assistant.provider : current.assistant.provider,
      modelId: patch?.assistant?.modelId !== undefined ? patch.assistant.modelId : current.assistant.modelId,
      shareResults: patch?.assistant?.shareResults ?? current.assistant.shareResults,
      maxResultRowsToModel: patch?.assistant?.maxResultRowsToModel ?? current.assistant.maxResultRowsToModel,
      maxSteps: patch?.assistant?.maxSteps ?? current.assistant.maxSteps,
    },
  };
}
