// =============================================================================
// Deployment facts the authorization server derives from configuration (PP-15.4)
// =============================================================================
//
// The issuer, the endpoint URLs and the resource identifiers all come from
// `APP_URL` (the `appUrl` configuration): one place, so the metadata document,
// the `iss` response parameter, the consent redirect and the resource compared
// at `/authorize` cannot disagree.
// =============================================================================

import { Injectable, InternalServerErrorException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { oauthResourceRegistry, type OAuthProtectedResourceDefinition } from './oauth-resource.registry';
import { normalizeResourceIdentifier } from './redirect-uri';
import { oauthResourceIdentifier } from './oauth-token.resolver';

/**
 * Which optional metadata features a route exists for. `registration_endpoint`
 * and `client_id_metadata_document_supported` are advertised only while their
 * setting is on AND something serves them: PP-15.5 (dynamic registration and
 * metadata documents) calls {@link OAuthServerFeatures.enable} when it mounts
 * its routes. Until then both stay out of the metadata document.
 *
 * @stability experimental
 */
@Injectable()
export class OAuthServerFeatures {
  private registration = false;
  private metadataDocuments = false;

  /**
   * Declares that a route exists for a feature (called by the code that mounts it).
   *
   * @param feature - `dynamicClientRegistration` or `clientIdMetadataDocuments`.
   */
  enable(feature: 'dynamicClientRegistration' | 'clientIdMetadataDocuments'): void {
    if (feature === 'dynamicClientRegistration') this.registration = true;
    else this.metadataDocuments = true;
  }

  /** Whether a dynamic registration route exists. */
  get hasDynamicClientRegistration(): boolean {
    return this.registration;
  }

  /** Whether metadata document clients are supported. */
  get hasClientIdMetadataDocuments(): boolean {
    return this.metadataDocuments;
  }
}

/**
 * The issuer, endpoint URLs and resource identifiers of this deployment.
 *
 * @stability experimental
 */
@Injectable()
export class OAuthServerContext {
  constructor(@Optional() private readonly config?: ConfigService) {}

  /**
   * `APP_URL` without a trailing slash.
   *
   * @throws InternalServerErrorException when `APP_URL` is not configured: the server cannot name itself.
   */
  appUrl(): string {
    const appUrl = this.config?.get<string>('appUrl');
    if (!appUrl) throw new InternalServerErrorException('The OAuth server needs APP_URL to be configured');
    return appUrl.replace(/\/+$/, '');
  }

  /** The issuer: `APP_URL` with no trailing slash. */
  issuer(): string {
    return this.appUrl();
  }

  /** The absolute URL of a path under the application root. */
  url(path: string): string {
    return `${this.appUrl()}${path}`;
  }

  /** The audience a grant of `resource` is stored under. */
  identifierOf(resource: OAuthProtectedResourceDefinition): string {
    return oauthResourceIdentifier(this.appUrl(), resource)!;
  }

  /**
   * The registered resource a client's `resource` parameter names, compared
   * after normalisation, or `undefined`.
   */
  resourceForParameter(value: string): OAuthProtectedResourceDefinition | undefined {
    const wanted = normalizeResourceIdentifier(value);
    if (wanted === null) return undefined;
    return oauthResourceRegistry.list().find((candidate) => normalizeResourceIdentifier(this.identifierOf(candidate)) === wanted);
  }

  /** The registered resource a stored grant's audience names, or `undefined` (no longer registered). */
  resourceForIdentifier(identifier: string): OAuthProtectedResourceDefinition | undefined {
    return oauthResourceRegistry.list().find((candidate) => this.identifierOf(candidate) === identifier);
  }
}
