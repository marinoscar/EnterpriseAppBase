import { PrincipalCacheModule } from '../auth/principal-cache/principal-cache.module';
import { Module } from '@nestjs/common';
import { AdminBootstrapService } from './services/admin-bootstrap.service';
import { RegistryFreezeService } from '@marinoscar/platform-api/core';
// Fills the role and permission registries (#676) at import time, so
// RegistryFreezeService finds them complete when it freezes on bootstrap.
import './permissions';

@Module({
  // PP-1.12 (#683): `AdminBootstrapService` invalidates principals.
  imports: [PrincipalCacheModule],
  providers: [AdminBootstrapService, RegistryFreezeService],
  exports: [AdminBootstrapService],
})
export class CommonModule {}
