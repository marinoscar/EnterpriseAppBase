import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { EmailSettingsService } from './email-settings.service';
import { SesEmailProvider } from './providers/ses-email.provider';
import { SmtpEmailProvider } from './providers/smtp-email.provider';

// =============================================================================
// EmailModule (issue #122, epic #109)
// =============================================================================
//
// The transport layer, and only the transport layer. #123 adds templates,
// #124 the admin settings page and its test-send endpoint, #125 the dispatcher
// that decides which provider to use for which event. Those land in this
// module as they arrive; #122 ships what they all sit on.
//
// NO CONTROLLER. There is no HTTP surface here yet, and adding one before
// there is something to expose would mean a route to review in infrastructure
// rather than in the diff that needs it -- the same reasoning CredentialsModule
// gives for having none.
//
// BOTH PROVIDERS ARE REGISTERED UNCONDITIONALLY, not chosen here from the
// configured `provider` setting. Provider selection is a per-send, runtime
// decision: the setting lives in the database and an admin can change it
// without a restart, so a module-construction-time choice would be stale the
// moment they did. Both classes are cheap to instantiate -- neither opens a
// socket or reads a credential until its first send -- so registering both and
// letting #125 pick costs nothing and keeps the choice where it can respond to
// a settings change.
//
// NOT @Global(). SmtpEmailProvider depends transitively on
// `CredentialsService.getSecret`, which returns plaintext; the set of modules
// that can reach it should stay a list a person can read, which means every
// consumer writes `imports: [EmailModule]` and shows up in a diff.
// =============================================================================

@Module({
  imports: [
    // EmailSettingsService reads the `email` row of `system_settings`.
    PrismaModule,
    // The SMTP password. Imported explicitly (CredentialsModule is
    // deliberately not global) so this module's access to a plaintext-
    // returning service is visible right here.
    CredentialsModule,
  ],
  providers: [EmailSettingsService, SesEmailProvider, SmtpEmailProvider],
  exports: [EmailSettingsService, SesEmailProvider, SmtpEmailProvider],
})
export class EmailModule {}
