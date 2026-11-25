// =============================================================================
// Reference example: labelling a job type whose handler is not loaded here
// (issue #734)
// =============================================================================
//
// A handler labels its own type (`readonly label = 'Example echo'`). Rows can
// name types no handler in THIS process registers: a type retired with its
// history kept, or one only another deployment role (a dedicated worker)
// runs. `registerJobTypeLabel` gives those a label too, so the admin job list
// shows a phrase rather than the dotted key. Call it once, at import time or
// from a module's `onModuleInit`; the last registration of a type wins.
// =============================================================================

import { registerJobTypeLabel } from '@marinoscar/platform-api/jobs';

/** A type this app no longer registers a handler for; its history rows stay. */
export const RETIRED_EXAMPLE_JOB_TYPE = 'example.legacy-export';

/** Registers the labels of the app's handler-less types. Idempotent. */
export function registerExampleJobTypeLabels(): void {
  registerJobTypeLabel(RETIRED_EXAMPLE_JOB_TYPE, 'Legacy export (retired)');
}
