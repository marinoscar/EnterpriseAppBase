import { Module } from '@nestjs/common';

import { CredentialsModule } from './credentials.module';
import { OrgCredentialsModule } from './org-credentials.module';
import { userCredentialPurposeRegistry } from './registry';
import {
  USER_CREDENTIAL_PURPOSE_REGISTRY,
  UserCredentialResolver,
} from './user-credential.resolver';
import { UserCredentialsService } from './user-credentials.service';

// =============================================================================
// UserCredentialsModule (issue #387)
// =============================================================================
//
// NO CONTROLLER and NOT @Global(), for exactly the reasons `CredentialsModule`
// gives: both exported providers can yield plaintext, so every consumer must
// be a visible `imports: [UserCredentialsModule]` line in a diff, and any HTTP
// surface is added by the feature that needs it, in its own module.
//
// The purpose registry is provided under a token rather than imported by the
// resolver directly, so tests can supply their own list. The production value
// is the static registry's entries (`registerUserCredentialPurpose`, #735),
// read when the provider is built: after every manifest ran at import time.
// `OrgCredentialsModule` is imported so the resolver has its `org` tier.
// =============================================================================

/**
 * Provides and exports {@link UserCredentialsService} and
 * {@link UserCredentialResolver}. Import it where a user's own key is read or
 * resolved; it is deliberately not global.
 *
 * @example
 * ```ts
 * @Module({ imports: [UserCredentialsModule], providers: [WebhookSigner] })
 * export class WebhooksModule {}
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
@Module({
  imports: [CredentialsModule, OrgCredentialsModule],
  providers: [
    UserCredentialsService,
    UserCredentialResolver,
    { provide: USER_CREDENTIAL_PURPOSE_REGISTRY, useFactory: () => userCredentialPurposeRegistry.list() },
  ],
  exports: [UserCredentialsService, UserCredentialResolver],
})
export class UserCredentialsModule {}
