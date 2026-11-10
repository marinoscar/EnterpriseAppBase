// =============================================================================
// Example: configuring the sharing slice (issue #732)
// =============================================================================
//
// Extension point: `SharingModule.forRoot(options)` (rung 1: options).
//
// Every option is code, never an environment variable: the module merges them
// over the defaults, validates them at boot (an invalid value throws naming
// the option) and freezes the result. A photo app (MemoriaHub) wants shorter
// invites, shorter-lived links and a shorter audit window than the defaults:
//
//   groups.inviteTtlDays   14  -> 7    an unanswered invite expires after a week
//   groups.maxMembersPerGroup 1000 -> 50 a family circle, not a company
//   links.defaultTtlDays   30  -> 7    a link with no expiry lasts a week
//   links.maxTtlDays       365 -> 30   and never more than a month
//   grants.retentionDays   90  -> 30   revoked and expired grants go after 30 days
//
// The reference app's own binding is src/platform/sharing/sharing.config.ts.
// Proven by ./sharing-options.example.db.spec.ts.
// =============================================================================

import type { DynamicModule } from '@nestjs/common';
import { SharingModule, type SharingModuleOptions } from '@marinoscar/platform-api/sharing';

import { platformHost } from '../../../src/platform/platform-host';
import { SharingHostModule } from '../../../src/platform/sharing/sharing-host.module';

/** The options, apart from the host and its ports. */
export const photoAppSharingOptions = {
  groups: { inviteTtlDays: 7, maxMembersPerGroup: 50 },
  links: { defaultTtlDays: 7, maxTtlDays: 30, appUrl: () => process.env.APP_URL || 'http://localhost:3535' },
  grants: { retentionDays: 30 },
} satisfies Omit<SharingModuleOptions, 'host' | 'imports'>;

/** What the app's root module imports. */
export const photoAppSharingModule: DynamicModule = SharingModule.forRoot({
  host: platformHost,
  imports: [SharingHostModule],
  ...photoAppSharingOptions,
});
