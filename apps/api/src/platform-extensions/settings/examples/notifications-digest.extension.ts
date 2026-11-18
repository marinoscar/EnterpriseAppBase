// =============================================================================
// Example: an org-overridable field added to a platform namespace (PP-14.21)
// =============================================================================
//
// `notifications` already has an org layer (an organization may only tighten
// the browser policy). This extension adds a top-level `weeklyDigest` switch to
// it and makes it org-overridable too: an organization may switch the digest
// OFF for its members, never on when the deployment has it off (`'and'`). The
// organization settings page lists it with the namespace's other fields, with
// no page change: it is generated from the org schema.
//
// Only the ADDED field joins the org layer; naming a base field in `org.fields`
// is refused. `test/examples/settings/org-extension.spec.ts` proves it over
// HTTP.
// =============================================================================

import type { SystemSettingsNamespaceExtension } from '@marinoscar/platform-api/settings';
import { z } from 'zod';

/** `notifications.weeklyDigest`, on by default; an organization may switch it off. */
export const NOTIFICATIONS_DIGEST_EXTENSION: SystemSettingsNamespaceExtension = {
  key: 'notifications',
  storedSchema: z.object({ weeklyDigest: z.boolean() }),
  defaults: { weeklyDigest: true },
  org: { mode: 'tighten', tighten: { weeklyDigest: 'and' } },
};
