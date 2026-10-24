// =============================================================================
// Example: changing the DEFAULTS of platform namespaces (PP-14.21)
// =============================================================================
//
// A deployment that wants a different starting point (shorter notification
// retention, the audit log kept by default) changes the DEFAULTS of the
// namespace, not its shape and not its merge. Two spellings, same effect:
//
//   - data, in `app-registrations/settings.ts` (`APP_SYSTEM_SETTINGS_DEFAULT_OVERRIDES`)
//   - a call, `overrideSettingsNamespaceDefaults(key, partial)`, at import time,
//     which is what a package's side-effect import uses
//
// The override is checked when the manifest assembles the namespaces: every path
// must exist in the namespace's stored schema and the result must satisfy it, so
// a typo or a wrong type fails the boot naming the namespace. Run
// `npm run catalog:settings --workspace=api` after adding one in production.
// The reference app registers none; `test/examples/settings/extensions.http.spec.ts`
// boots the application with both.
// =============================================================================

import type { SettingsDefaultsOverride } from '@marinoscar/platform-api/settings';

/** Keep notifications 30 days (not 180) and the audit log on by default. */
export const RETENTION_DEFAULTS_OVERRIDE: SettingsDefaultsOverride = {
  key: 'retention',
  defaults: { notifications: { days: 30 }, auditEvents: { enabled: true } },
};

/** A job counts as stuck after 45 minutes (not 30); the call form a package would use. */
export const JOBS_STUCK_THRESHOLD_MINUTES = 45;
