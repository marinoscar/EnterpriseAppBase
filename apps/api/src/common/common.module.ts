import { Module } from '@nestjs/common';
import { RegistryFreezeService } from '@marinoscar/platform-api/core';
// Fills the role and permission registries (#676) at import time, so
// RegistryFreezeService finds them complete when it freezes on bootstrap.
import './permissions';

// `AdminBootstrapService` (the INITIAL_ADMIN_EMAIL bootstrap) moved into the
// identity slice with the rest of sign-in (#727); `AuthModule` provides it.
@Module({
  providers: [RegistryFreezeService],
})
export class CommonModule {}
