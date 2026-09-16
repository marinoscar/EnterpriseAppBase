import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { CredentialsModule } from './credentials.module';
import { UserCredentialResolver } from './user-credential-resolver.service';
import { UserCredentialsService } from './user-credentials.service';

// =============================================================================
// UserCredentialsModule (issue #387)
// =============================================================================
//
// The per-user half of the credential story. Imports `CredentialsModule`
// because `UserCredentialResolver` needs the SYSTEM store to answer step 2 of
// its rule — "the user has none, use the deployment's" — and that is the only
// reason: nothing here writes a system credential, and the dependency runs one
// way. (`CredentialsModule` does not import this one, and must not: the system
// store has no business knowing that per-user credentials exist, and a cycle
// between two modules whose providers are constructor-injected is a boot
// failure under `emitDecoratorMetadata`, not a style problem.)
//
// NO CONTROLLER, ON PURPOSE — the same argument `CredentialsModule` makes, and
// it applies with more force here. Exposing per-user credentials over HTTP is
// not in scope for #387, which builds the store and the resolution rule. With
// no route there is no request handler to widen and no OpenAPI schema that
// could grow a secret-bearing field; the settings page that eventually lets a
// user manage their own keys adds its endpoints in its own module, where
// reviewing an endpoint that reads and writes somebody's API key is the point
// of the diff rather than a detail buried in shared infrastructure. That
// review has something specific to check here that the system store never
// had: every route must scope to the AUTHENTICATED user's id and never to one
// taken from a path or a body.
//
// NOT @Global(), for the same reason as `CredentialsModule`.
// `UserCredentialsService.getSecret` and `UserCredentialResolver.resolve` both
// return plaintext, so the set of modules able to inject them should be a list
// someone can read. Requiring `imports: [UserCredentialsModule]` makes every
// new consumer a visible line in a diff; @Global would make injecting them
// invisible and available everywhere by default, which is the wrong default
// for this.
//
// DELIBERATELY NOT REGISTERED IN `app.module.ts`, AND THAT IS NOT AN
// OVERSIGHT. Nothing consumes this yet — #387 is the foundation, and the
// purpose registry ships empty because there is no LLM feature to register.
// A module wired into the root with no consumer is dead weight that implies a
// surface which does not exist: it would appear in the dependency graph, be
// instantiated at every boot, and read to the next person as "something uses
// this, find it". The feature that needs a per-user key adds
// `imports: [UserCredentialsModule]` to ITS OWN module — which is where the
// import belongs anyway, given the not-@Global reasoning above — and that one
// line is the moment this store acquires a consumer, visibly, in the diff that
// introduces it.
// =============================================================================

@Module({
  imports: [PrismaModule, CredentialsModule],
  providers: [UserCredentialsService, UserCredentialResolver],
  exports: [UserCredentialsService, UserCredentialResolver],
})
export class UserCredentialsModule {}
