import { Global, Injectable, Logger, Module, OnModuleInit, Optional } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

import { permissionRegistry } from '../../core/index';
import { OAUTH_CLIENT_RESOLVER, StoredClientResolver } from './client-resolver';
import { InProcessDelegation } from './in-process-delegation.service';
import { OAuthAuthorizationService } from './oauth-authorization.service';
import { installOAuthBodyGuard } from './oauth-body-guard';
import { OAuthConsentController, OAuthGrantsController } from './oauth-consent.controller';
import { OAuthGrantService } from './oauth-grant.service';
import { OAuthProtocolController } from './oauth-protocol.controller';
import { OAuthRateLimitService } from './oauth-rate-limiter';
import { OAuthServerContext, OAuthServerFeatures } from './oauth-server-context';
import { OAuthTokenService } from './oauth-token.service';
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
 * Installs the body rules of `/api/oauth/token` and `/api/oauth/revoke` (form
 * only, 16 KiB) on the HTTP server, before it starts listening.
 *
 * @internal
 */
@Injectable()
export class OAuthBodyGuardInstaller implements OnModuleInit {
  constructor(
    private readonly settings: OAuthServerSettingsReader,
    @Optional() private readonly adapterHost?: HttpAdapterHost,
  ) {}

  /** Registers the hook; a host with no Fastify instance (a unit test) is skipped. */
  onModuleInit(): void {
    const instance = this.adapterHost?.httpAdapter?.getInstance?.();
    installOAuthBodyGuard(instance, () => this.settings.isEnabled());
  }
}

/**
 * The OAuth server: the resource-server half (PP-15.3: the token resolver, the
 * settings reader, in-process delegation) and the authorization server core
 * (PP-15.4: metadata, authorize, the consent API, token, revoke and the grants
 * API under `/api/oauth`). Mounted by `IdentityModule.forRoot({ oauthServer })`;
 * absent, an `oat_` header is a `401` and no route exists. Global, because
 * `JwtAuthGuard` is instantiated in every module whose controllers use `@Auth()`.
 *
 * The client is looked up through `OAUTH_CLIENT_RESOLVER` (default: the stored
 * rows); the rate limiter is `OAUTH_RATE_LIMITER` when an app binds one, else an
 * in-memory fixed window.
 *
 * @stability experimental
 */
@Global()
@Module({
  controllers: [OAuthProtocolController, OAuthConsentController, OAuthGrantsController],
  providers: [
    OAuthServerSettingsReader,
    OAuthTokenResolver,
    InProcessDelegation,
    OAuthRegistryBootstrapCheck,
    OAuthServerContext,
    OAuthServerFeatures,
    OAuthRateLimitService,
    OAuthGrantService,
    OAuthAuthorizationService,
    OAuthTokenService,
    OAuthBodyGuardInstaller,
    { provide: OAUTH_CLIENT_RESOLVER, useClass: StoredClientResolver },
  ],
  exports: [
    OAuthServerSettingsReader,
    OAuthTokenResolver,
    InProcessDelegation,
    OAuthServerContext,
    OAuthServerFeatures,
    OAuthGrantService,
    OAUTH_CLIENT_RESOLVER,
  ],
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
