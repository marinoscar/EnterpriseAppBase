import { Global, Module } from '@nestjs/common';

import { PrincipalCache } from './principal-cache.service';

// =============================================================================
// PrincipalCacheModule (PP-1.12, issue #683)
// =============================================================================
//
// `@Global()` and imported ONCE, in `app.module.ts` next to `EventBusModule`.
// The cache is written from modules that `AuthModule` itself depends on —
// `CommonModule` (`AdminBootstrapService.assignAdminRole`) — as well as from
// `UsersModule`, `SettingsModule` and `TestAuthModule`. Providing it from
// `AuthModule` would put an import cycle on the authentication path; a global
// leaf module with no imports of its own (it needs only `ConfigService` and
// the global `EVENT_BUS`) has none.
//
// ONE INSTANCE PER PROCESS: two would each hold entries the other's
// `invalidate` never reaches.
// =============================================================================

@Global()
@Module({
  providers: [PrincipalCache],
  exports: [PrincipalCache],
})
export class PrincipalCacheModule {}
