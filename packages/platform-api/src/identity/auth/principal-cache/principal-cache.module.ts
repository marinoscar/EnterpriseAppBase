import { Module } from '@nestjs/common';

import { PrincipalCache } from './principal-cache.service';

// =============================================================================
// PrincipalCacheModule (PP-1.12, issue #683)
// =============================================================================
//
// A LEAF MODULE, imported explicitly by every module whose providers read or
// invalidate the cache: `AuthModule`, `CommonModule`
// (`AdminBootstrapService.assignAdminRole`), `UsersModule`, `SettingsModule`
// and `TestAuthModule`. It is not provided by `AuthModule` because
// `AuthModule` itself imports `CommonModule`, which would put an import cycle
// on the authentication path. It imports nothing: it needs only the global
// `ConfigService` and (optionally) the global `EVENT_BUS`.
//
// ONE INSTANCE PER PROCESS: Nest instantiates a module class once per
// application however many modules import it, so every importer shares the
// same map. Two instances would each hold entries the other's `invalidate`
// never reaches.
// =============================================================================

/**
 * Provides the one {@link PrincipalCache} of the process. Import it where a
 * service invalidates principals.
 *
 * @stability stable
 */
@Module({
  providers: [PrincipalCache],
  exports: [PrincipalCache],
})
export class PrincipalCacheModule {}
