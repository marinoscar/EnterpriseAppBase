import { Module } from '@nestjs/common';

import { CredentialsService } from './credentials.service';

// =============================================================================
// CredentialsModule (issue #115, epic #108)
// =============================================================================
//
// NO CONTROLLER, ON PURPOSE. Exposing credentials over HTTP is not in scope
// for #115 — #109 injects `CredentialsService` and consumes it directly. With
// no route there is no request handler to widen and no OpenAPI schema that
// could grow a secret-bearing field; the admin UI that eventually needs one
// adds it in its own module, where reviewing it is the point of the diff
// rather than a detail buried in shared infrastructure.
//
// NOT @Global(), unlike PatModule. `CredentialsService.getSecret` returns
// plaintext, so the set of modules able to inject it should be a list someone
// can read. Requiring `imports: [CredentialsModule]` makes every new consumer
// a visible line in a diff; @Global would make injecting it invisible and
// available everywhere by default, which is the wrong default for this.
//
// The database is the core `PLATFORM_PRISMA` port, bound once and globally by
// the app's `PlatformHostModule.forRoot({ prisma })`, so this module imports
// nothing (issue #735).
// =============================================================================

/**
 * Provides and exports {@link CredentialsService}. Import it in every module
 * that reads or writes a deployment credential; it is deliberately not global.
 *
 * @example
 * ```ts
 * @Module({ imports: [CredentialsModule], providers: [SmtpEmailProvider] })
 * export class EmailModule {}
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
@Module({
  providers: [CredentialsService],
  exports: [CredentialsService],
})
export class CredentialsModule {}
