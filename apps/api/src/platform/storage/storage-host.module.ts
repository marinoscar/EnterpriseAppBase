// =============================================================================
// The reference app's bindings of the storage slice's host ports (issue #736)
// =============================================================================
//
// `@Global()`, passed to `StorageModule.forRoot({ imports })` (./storage.config.ts):
//
//   STORAGE_SYSTEM_DATA -> PrismaSystemService (the bypass client; `asSystem(reason)`)
//
// The tenant client is the core port `PLATFORM_PRISMA` (`PlatformHostModule`,
// bound to `PrismaService`, whose `forOrg` / `runInOrg` the slice uses).
// This file is on the reviewed allowlist of
// `test/tenancy/system-injection-boundary.spec.ts`: the slice's four
// cross-organization paths (the stale-upload sweep, the stranded-object count,
// the public avatar route, the avatar replacement across an org switch) reach
// the bypass client through it, each naming its reason.
// =============================================================================

import { Global, Module } from '@nestjs/common';
import { STORAGE_SYSTEM_DATA } from '@marinoscar/platform-api/storage';

import { PrismaSystemService } from '../../prisma/prisma-system.service';

const BINDINGS = [{ provide: STORAGE_SYSTEM_DATA, useExisting: PrismaSystemService }];

@Global()
@Module({
  providers: BINDINGS,
  exports: BINDINGS.map((binding) => binding.provide),
})
export class StorageHostModule {}
