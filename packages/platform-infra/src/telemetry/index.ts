/**
 * `@marinoscar/platform-infra/telemetry`: the telemetry infra fragment.
 *
 * The files themselves ship under `telemetry/` in the package; this module is
 * their typed manifest, read by `platform-infra sync` and by the app CLI's
 * compose file list.
 *
 * @packageDocumentation
 */
export type { ComposeSlot, InfraComposeFile, InfraFile, InfraFragment } from './manifest.js';
export { telemetryInfraFragment } from './manifest.js';
