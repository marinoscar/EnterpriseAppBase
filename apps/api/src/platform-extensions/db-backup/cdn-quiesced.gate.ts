// =============================================================================
// The `cdn-quiesced` restore gate: an app's own pre-flight check (PP-14.12)
// =============================================================================
//
// A restore swaps the database under a running application. If the app fronts
// it with a CDN that caches API-adjacent content, a restore while the CDN is
// still serving yesterday's state publishes pages the restored database no
// longer backs. So this gate asks: "has the operator quiesced the CDN?" and
// BLOCKS the restore until the answer is yes.
//
// IT IS THE WORKED EXAMPLE OF `registerRestoreGate`
// (`@marinoscar/platform-api/db-backup`):
//   - it registers at import time from `app-registrations/db-backup.ts`, after
//     the eight built-in gates, with no package edit;
//   - it is READ-ONLY: it reads one system settings namespace through the
//     context's `settings.get` and nothing else. It creates, changes and calls
//     nothing, which is the rule every gate keeps (the kit asserts it);
//   - it is INERT UNLESS CONFIGURED: the setting it reads, a `cdn` namespace
//     with `{ quiesced: boolean }`, belongs to the app that has a CDN. The
//     reference app has none, so `settings.get('cdn')` is `undefined` and the
//     gate passes with a message saying so. A fork with a CDN registers the
//     namespace (`CDN_SETTINGS_EXAMPLE` below is its declaration) and the same
//     gate starts to bite, unchanged.
//
// `fail` blocks the restore outright and cannot be overridden from the request
// (the override, `overrideSchemaCheck`, answers the schema gate only).
// =============================================================================

import type { RestoreGateDefinition } from '@marinoscar/platform-api/db-backup';
import type { SystemSettingsNamespace } from '@marinoscar/platform-api/settings';
import { z } from 'zod';

/** The gate's id, as it appears in the pre-flight result and the restore dialog. */
export const CDN_QUIESCED_GATE_ID = 'cdn-quiesced';

/** The system settings namespace the gate reads. */
export const CDN_SETTINGS_KEY = 'cdn';

/** The gate. Registered by `app-registrations/db-backup.ts`. */
export const cdnQuiescedGate: RestoreGateDefinition = {
  id: CDN_QUIESCED_GATE_ID,
  label: 'CDN quiesced',
  async check(ctx) {
    const cdn = await ctx.settings.get(CDN_SETTINGS_KEY);

    if (cdn === undefined) {
      return {
        status: 'pass',
        message: 'This application has no CDN configured (the "cdn" settings namespace is not registered), so there is nothing to quiesce.',
      };
    }

    if (cdn.quiesced === true) {
      return { status: 'pass', message: 'The CDN is quiesced.' };
    }

    return {
      status: 'fail',
      message: 'The CDN is still serving traffic. A restore swaps the database under it, so cached pages could outlive the data behind them.',
      action: 'Pause or purge the CDN, set "quiesced" on the cdn settings, then run the pre-flight again.',
    };
  },
};

const cdnSettingsSchema = z.object({ quiesced: z.boolean() });

/** The stored `cdn` value. */
export type CdnSettingsValue = z.infer<typeof cdnSettingsSchema>;

/**
 * The declaration of the settings namespace the gate reads: what an app WITH a
 * CDN adds to `APP_SYSTEM_SETTINGS_NAMESPACES` (`app-registrations/settings.ts`).
 * The reference app compiles it as an example and does not register it (that
 * would change the system-settings document and the published OpenAPI), exactly
 * as `platform-extensions/settings/examples/org-overridable.namespaces.ts` does.
 */
export const CDN_SETTINGS_EXAMPLE = {
  key: CDN_SETTINGS_KEY,
  description: 'Whether the CDN in front of this application has been quiesced for a restore.',
  storedSchema: cdnSettingsSchema,
  patchSchema: cdnSettingsSchema.partial(),
  putSchema: cdnSettingsSchema,
  wirePatchSchema: cdnSettingsSchema.partial(),
  responseSchema: cdnSettingsSchema,
  defaults: { quiesced: false },
  requiredOnPut: false,
  merge: (current, patch) => ({ ...current, ...(patch ?? {}) }),
} satisfies SystemSettingsNamespace<'cdn', CdnSettingsValue, Partial<CdnSettingsValue>>;
