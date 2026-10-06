// =============================================================================
// System settings namespace `telemetry` (issue #677; namespace epic #528, story #533)
// =============================================================================
//
// A declaration file: pure data, imports only leaf modules. Registered by
// `settings/registry/system-settings.manifest.ts`. Recipe:
// `settings/registry/README.md`.
//
// NO CREDENTIAL HERE: the assistant's provider key is resolved through
// `AiKeyResolver` like every other AI call. Proved at compile time in
// `common/schemas/settings.schema.ts` (`TELEMETRY_SETTINGS_CARRIES_NO_SECRET`).
// =============================================================================

import type { z } from 'zod';
import {
  systemTelemetryPatchSchema,
  systemTelemetrySchema,
  type SystemTelemetryValue,
} from '../common/schemas/settings.schema';
import {
  telemetrySettingsPatchSchema,
  telemetrySettingsSchema,
} from '../settings/dto/system-settings-wire.schemas';
import type { SystemSettingsNamespace } from '../settings/registry/system-settings-namespace';

// OFF, and INERT, matching every namespace that ships ahead of its own
// consumers (`databaseBackup.enabled`, `ai.enabled`): a fresh deployment does
// not start collecting or retaining observability data nobody asked for merely
// because this namespace exists.
const TELEMETRY_SYSTEM_DEFAULTS: SystemTelemetryValue = {
  enabled: false,
  retentionDays: 30,
  // #565: `null` means "follow `APP_SLUG`" — resolved at the point of use
  // (`resolveTelemetryInstanceId`), so a renamed fork follows its new name
  // until an administrator overrides it. Storing the slug literally here
  // would freeze it at the first write. A row written before this field
  // existed lacks it, fails the field's own parse in `readNamespace`, and
  // reads back as this `null` — no migration.
  instanceId: null,
  query: {
    maxRows: 10000,
    timeoutSeconds: 30,
  },
  assistant: {
    // OFF, on top of `enabled` above being off — see `systemTelemetrySchema`
    // for why this is a second, narrower switch rather than folded into it.
    enabled: false,
    provider: null,
    modelId: null,
    // ON by default: an assistant that cannot see the rows it queried
    // cannot explain them, and an administrator who wants the narrower
    // behavior turns it off deliberately.
    shareResults: true,
    maxResultRowsToModel: 100,
    maxSteps: 15,
  },
};

export const TELEMETRY_SYSTEM_SETTINGS = {
  key: 'telemetry',
  description: 'Telemetry policy: whether telemetry is collected, how long it is kept, the bounds of an ad-hoc query, and the AI assistant over it.',
  storedSchema: systemTelemetrySchema,
  patchSchema: systemTelemetryPatchSchema,
  putSchema: telemetrySettingsSchema,
  wirePatchSchema: telemetrySettingsPatchSchema,
  // The documented response (`systemSettingsResponseSchema`) has never
  // declared `telemetry`, although `GET /api/system-settings` returns it. Kept
  // `null` so the OpenAPI document is unchanged by #677; publishing it is a
  // separate, visible contract change.
  responseSchema: null,
  defaults: TELEMETRY_SYSTEM_DEFAULTS,
  requiredOnPut: false,
  merge(current, patch) {
    // Field by field, one level deep into `query` and `assistant`. `??` is
    // right for every REQUIRED field: none of them is nullable, and `??`
    // leaves an omitted field at its current stored value.
    //
    // `assistant.provider`/`assistant.modelId` are NULLABLE, not optional
    // (`systemTelemetrySchema` never allows them to be absent), so they take
    // the `maintenance.startedAt`/`storage.forcePathStyle` `!== undefined`
    // form rather than `mergeOptional`: absent keeps the stored value, an
    // explicit `null` CLEARS it. `??` would treat a sent `null` as absent,
    // and an operator could then never clear a provider or model once set.
    return {
      enabled: patch?.enabled ?? current.enabled,
      retentionDays: patch?.retentionDays ?? current.retentionDays,
      // #565: nullable, same `!== undefined` form as `assistant.provider`
      // below — an explicit `null` returns to the `APP_SLUG` default.
      instanceId: patch?.instanceId !== undefined ? patch.instanceId : current.instanceId,
      query: {
        maxRows: patch?.query?.maxRows ?? current.query.maxRows,
        timeoutSeconds: patch?.query?.timeoutSeconds ?? current.query.timeoutSeconds,
      },
      assistant: {
        enabled: patch?.assistant?.enabled ?? current.assistant.enabled,
        provider:
          patch?.assistant?.provider !== undefined ? patch.assistant.provider : current.assistant.provider,
        modelId: patch?.assistant?.modelId !== undefined ? patch.assistant.modelId : current.assistant.modelId,
        shareResults: patch?.assistant?.shareResults ?? current.assistant.shareResults,
        maxResultRowsToModel: patch?.assistant?.maxResultRowsToModel ?? current.assistant.maxResultRowsToModel,
        maxSteps: patch?.assistant?.maxSteps ?? current.assistant.maxSteps,
      },
    };
  },
} satisfies SystemSettingsNamespace<
  'telemetry',
  SystemTelemetryValue,
  z.infer<typeof telemetrySettingsPatchSchema>
>;

declare module '../settings/registry/system-settings-namespace' {
  interface SystemSettingsNamespaces {
    /**
     * Telemetry policy (epic #528, story #533): collection, retention, query
     * bounds and the AI assistant that may be pointed at it.
     */
    telemetry: SystemTelemetryValue;
  }
  interface SystemSettingsNamespaceDeclarations {
    telemetry: typeof TELEMETRY_SYSTEM_SETTINGS;
  }
}
