import { Global, Injectable, Logger, Module, OnModuleInit, Optional } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

import { permissionRegistry } from '../../core/index';
import { OAUTH_CLIENT_RESOLVER } from './client-resolver';
import { CimdFetcher } from './clients/cimd.fetcher';
import { ClientIdentityResolver } from './clients/client-identity.resolver';
import { ClientRefusalRecorder } from './clients/client-refusal.recorder';
import { ClientRegistrationService } from './clients/client-registration.service';
import { ClientTrustPolicy } from './clients/client-trust.policy';
import { OAuthClientCleanupHandler } from './clients/oauth-client-cleanup.handler';
import { OAuthClientCleanupTask } from './clients/oauth-client-cleanup.task';
import { OAuthClientsAdminController } from './clients/oauth-clients-admin.controller';
import { OAuthClientsAdminService } from './clients/oauth-clients-admin.service';
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
 * Declares that dynamic registration and metadata documents are served, so the
 * authorization server metadata advertises `registration_endpoint` and
 * `client_id_metadata_document_supported` while their settings are on (PP-15.5).
 *
 * @internal
 */
@Injectable()
export class OAuthClientIdentityBootstrap implements OnModuleInit {
  constructor(private readonly features: OAuthServerFeatures) {}

  /** Enables both features. */
  onModuleInit(): void {
    this.features.enable('dynamicClientRegistration');
    this.features.enable('clientIdMetadataDocuments');
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
 * The client is looked up through `OAUTH_CLIENT_RESOLVER` (default: `ClientIdentityResolver`:
 * stored rows, metadata documents and the host trust policy of PP-15.5); the rate limiter is `OAUTH_RATE_LIMITER` when an app binds one, else an
 * in-memory fixed window.
 *
 * @stability experimental
 */
@Global()
@Module({
  controllers: [OAuthProtocolController, OAuthConsentController, OAuthGrantsController, OAuthClientsAdminController],
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
    // Client identity and the trust policy (PP-15.5).
    CimdFetcher,
    ClientTrustPolicy,
    ClientRefusalRecorder,
    ClientRegistrationService,
    OAuthClientsAdminService,
    OAuthClientIdentityBootstrap,
    OAuthClientCleanupHandler,
    OAuthClientCleanupTask,
    ClientIdentityResolver,
    { provide: OAUTH_CLIENT_RESOLVER, useExisting: ClientIdentityResolver },
  ],
  exports: [
    OAuthServerSettingsReader,
    OAuthTokenResolver,
    InProcessDelegation,
    OAuthServerContext,
    OAuthServerFeatures,
    OAuthGrantService,
    OAUTH_CLIENT_RESOLVER,
    ClientTrustPolicy,
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
