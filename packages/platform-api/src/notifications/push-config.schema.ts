// The wire schemas live in @marinoscar/platform-contract/notifications since
// #738 (moved from this file with their meaning unchanged; channel ids are
// open). This file wraps them as DTOs and re-exports them under their old
// names, so the controllers and their importers did not change.

import type { PushConfig } from '@marinoscar/platform-contract/notifications';

export { DEFAULT_VAPID_SUBJECT, pushConfigSchema, vapidSubjectSchema } from '@marinoscar/platform-contract/notifications';
export type { PushConfig } from '@marinoscar/platform-contract/notifications';

/**
 * What an unconfigured deployment reads: push off, no key pair.
 *
 * @stability stable
 */
export const DEFAULT_PUSH_CONFIG: PushConfig = {
  enabled: false,
  publicKey: null,
  subject: null,
};
