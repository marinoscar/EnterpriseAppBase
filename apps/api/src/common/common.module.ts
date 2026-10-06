import { Module } from '@nestjs/common';
import { AdminBootstrapService } from './services/admin-bootstrap.service';
import { RegistryFreezeService } from './registry/registry-freeze.service';
// Fills the role and permission registries (#676) at import time, so
// RegistryFreezeService finds them complete when it freezes on bootstrap.
import './permissions';

@Module({
  providers: [AdminBootstrapService, RegistryFreezeService],
  exports: [AdminBootstrapService],
})
export class CommonModule {}
