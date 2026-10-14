// =============================================================================
// System settings namespace `telemetry` (issue #677; namespace epic #528, story #533)
// =============================================================================
//
// A declaration file: pure data, imports only leaf modules. Registered by
// `settings/registry/system-settings.manifest.ts`. Recipe:
// `settings/registry/README.md`.
//
// The telemetry slice (`@marinoscar/platform-api/telemetry`, #703) owns the
// namespace's key, description, defaults and merge rule; this file binds them
// to the app's settings registry with the app's own stored, patch and wire
// schemas (the stored and PUT schemas are the contract's
// `telemetrySettingsSchema`, #702).
//
// NO CREDENTIAL HERE: the assistant's provider key is resolved through
// `AiKeyResolver` like every other AI call. Proved at compile time in
// `common/schemas/settings.schema.ts` (`TELEMETRY_SETTINGS_CARRIES_NO_SECRET`).
// =============================================================================

import {
  TELEMETRY_SETTINGS_DEFAULTS,
  TELEMETRY_SETTINGS_DESCRIPTION,
  TELEMETRY_SETTINGS_NAMESPACE,
  mergeTelemetrySettings,
} from '@marinoscar/platform-api/telemetry';
import type { z } from 'zod';

import {
  systemTelemetryPatchSchema,
  systemTelemetrySchema,
  type SystemTelemetryValue,
} from '../../common/schemas/settings.schema';
import {
  telemetrySettingsPatchSchema,
  telemetrySettingsSchema,
} from '../../common/schemas/system-settings-wire.schemas';
import type { SystemSettingsNamespace } from '@marinoscar/platform-api/settings';

export const TELEMETRY_SYSTEM_SETTINGS = {
  key: TELEMETRY_SETTINGS_NAMESPACE,
  description: TELEMETRY_SETTINGS_DESCRIPTION,
  storedSchema: systemTelemetrySchema,
  patchSchema: systemTelemetryPatchSchema,
  putSchema: telemetrySettingsSchema,
  wirePatchSchema: telemetrySettingsPatchSchema,
  // The documented response (`systemSettingsResponseSchema`) has never
  // declared `telemetry`, although `GET /api/system-settings` returns it. Kept
  // `null` so the OpenAPI document is unchanged by #677; publishing it is a
  // separate, visible contract change.
  responseSchema: null,
  // A copy, so nothing the app does to its defaults reaches the package's.
  defaults: structuredClone(TELEMETRY_SETTINGS_DEFAULTS) as SystemTelemetryValue,
  requiredOnPut: false,
  // Field by field, one level deep into `query` and `assistant`; an explicit
  // `null` clears `instanceId`, `assistant.provider` and `assistant.modelId`
  // (see `mergeTelemetrySettings`).
  merge: mergeTelemetrySettings,
} satisfies SystemSettingsNamespace<
  'telemetry',
  SystemTelemetryValue,
  z.infer<typeof telemetrySettingsPatchSchema>
>;

declare module '@marinoscar/platform-api/settings' {
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
