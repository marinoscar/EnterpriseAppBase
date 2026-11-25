import { Module } from '@nestjs/common';

import { IdentityUserCreatedListener } from './identity-user-created.listener';

// The reference app's extensions of the identity slice (#727): listeners on its
// events. The host-port bindings are in `platform/identity/`; the four
// notification events identity raises are declared in `./notifications/`.
@Module({
  providers: [IdentityUserCreatedListener],
})
export class IdentityExtensionsModule {}
