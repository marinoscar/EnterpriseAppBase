import { Global, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';

import { permissionRegistry } from '../../core/index';
import { InProcessDelegation } from './in-process-delegation.service';
import './oauth-credential-kind';
import { findOAuthRegistryProblems } from './oauth-resource.registry';
import { OAuthServerSettingsReader } from './oauth-server-settings.reader';
import { OAuthTokenResolver } from './oauth-token.resolver';

/**
 * Checks the scope and resource registries against the permission registry
 * once every registration is done (module init runs after import time). A
 * scope naming an unregistered permission, a resource naming an unregistered
 * scope or one with no default scope stops the application from booting, and
 * the message names the scope or resource.
 *
 * @internal
 */
@Injectable()
export class OAuthRegistryBootstrapCheck implements OnModuleInit {
  private readonly logger = new Logger(OAuthRegistryBootstrapCheck.name);

  /** @throws Error naming every offending scope or resource. */
  onModuleInit(): void {
    const problems = findOAuthRegistryProblems((id) => permissionRegistry.has(id));
    if (problems.length > 0) {
      throw new Error(`OAuth server registries are inconsistent:\n  - ${problems.map((p) => p.message).join('\n  - ')}`);
    }
    this.logger.debug('OAuth scope and resource registries are consistent');
  }
}

/**
 * The OAuth server's resource-server half (PP-15.3): the token resolver, the
 * settings reader and in-process delegation. Mounted by
 * `IdentityModule.forRoot({ oauthServer })`; absent, an `oat_` header is a
 * `401`. Global, because `JwtAuthGuard` is instantiated in every module whose
 * controllers use `@Auth()`.
 *
 * @stability experimental
 */
@Global()
@Module({
  providers: [OAuthServerSettingsReader, OAuthTokenResolver, InProcessDelegation, OAuthRegistryBootstrapCheck],
  exports: [OAuthServerSettingsReader, OAuthTokenResolver, InProcessDelegation],
})
export class OAuthServerModule {}

let mounted = false;

/**
 * Records that `IdentityModule.forRoot({ oauthServer })` mounted the OAuth
 * server. The settings slice (above identity) reads it to register the
 * `oauthServer` namespace only for a deployment that mounts the server.
 *
 * @internal
 */
export function markOAuthServerMounted(): void {
  mounted = true;
}

/**
 * Whether the OAuth server sub-slice has been mounted in this process.
 *
 * @stability experimental
 */
export function isOAuthServerMounted(): boolean {
  return mounted;
}
