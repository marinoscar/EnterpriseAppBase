// =============================================================================
// Example: a field INSIDE a nested object, organization-tightenable (PP-14.21)
// =============================================================================
//
// `telemetry.query` is a real nested object of a platform namespace (`maxRows`,
// `timeoutSeconds`). This extension adds `slowQuerySeconds` inside it, with
// `path: 'query'`, and lets an organization LOWER it (`'min'`) for its own
// members and never raise it. The base fields beside it (`maxRows`,
// `timeoutSeconds`) stay deployment-wide: the org layer holds only the added
// field, under the same path.
//
// An app lists it in `app-registrations/settings.ts`
// (`APP_SYSTEM_SETTINGS_EXTENSIONS`); the reference app keeps that list empty,
// so the tests fold it in: `test/examples/settings/telemetry-query.spec.ts`.
// =============================================================================

import type { SystemSettingsNamespaceExtension } from '@marinoscar/platform-api/settings';
import { z } from 'zod';

/** The query duration above which the explorer flags a query as slow. */
export const TELEMETRY_SLOW_QUERY_SECONDS = z.number().int().min(1).max(120);

/** `telemetry.query.slowQuerySeconds`, default 10, tightenable per organization. */
export const TELEMETRY_QUERY_EXTENSION: SystemSettingsNamespaceExtension = {
  key: 'telemetry',
  path: 'query',
  storedSchema: z.object({ slowQuerySeconds: TELEMETRY_SLOW_QUERY_SECONDS }),
  defaults: { slowQuerySeconds: 10 },
  org: { mode: 'tighten', tighten: { slowQuerySeconds: 'min' } },
};
