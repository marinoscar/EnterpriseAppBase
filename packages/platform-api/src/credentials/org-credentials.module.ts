import { Module } from '@nestjs/common';

import { OrgCredentialsService } from './org-credentials.service';

// =============================================================================
// OrgCredentialsModule (issue #735)
// =============================================================================
//
// NO CONTROLLER and NOT @Global(), for the reasons `CredentialsModule` gives:
// its service yields plaintext, so every consumer is a visible
// `imports: [OrgCredentialsModule]` line in a diff, and the HTTP surface is
// added by the feature that presents its organization's keys. The database is
// the core `PLATFORM_PRISMA` port.
// =============================================================================

/**
 * Provides and exports {@link OrgCredentialsService}. Import it where an
 * organization's own key is read or written, and next to `UserCredentialsModule`
 * to give the resolver its org tier.
 *
 * @example
 * ```ts
 * @Module({ imports: [OrgCredentialsModule], providers: [OrgAiKeyService] })
 * export class OrgAiKeysModule {}
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
@Module({
  providers: [OrgCredentialsService],
  exports: [OrgCredentialsService],
})
export class OrgCredentialsModule {}
