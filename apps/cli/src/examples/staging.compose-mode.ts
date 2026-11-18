import type { ComposeModeRegistration } from '@marinoscar/platform-infra';

// =============================================================================
// EXAMPLE, NOT WIRED: an app compose mode (PP-14.22)
// =============================================================================
//
// The platform's modes (`dev`, `devdb`, `prod`, `vps`, `worker`, `test`) are
// ordered lists of compose files with the app's overlays last. An app with a
// stack of its own - a staging server built from the production files - registers
// a mode, and the mode's id becomes its overlay scope:
//
//   registerComposeMode(stagingMode)
//   composeFilesForMode('staging', { overlays: readdirSync('infra/compose') })
//
// `app.staging.*.compose.yml` applies to this mode alone; a plain
// `app.<name>.compose.yml` applies to it too, because its list holds
// `base.compose.yml`. (The `test` mode is built in: `app.test.*` overlays reach
// the disposable test database only.)
// =============================================================================

/** Production files with the VPS hardening, under its own overlay scope. */
export const stagingMode: ComposeModeRegistration = {
  id: 'staging',
  files: ['base.compose.yml', 'prod.compose.yml', 'vps.compose.yml'],
};
