// =============================================================================
// WebhookSecretsService: an endpoint's signing secrets (issue #1046)
// =============================================================================
//
// The secret is never a column and never in a delivery row. It lives in the
// encrypted credentials store, in the tier that matches the endpoint:
//
//   user scope    UserCredentialsService   (the owner's own store)
//   org scope     OrgCredentialsService    (the organization's store)
//   system scope  CredentialsService       (the deployment's store)
//
// under the purpose `webhook_signing` and the name `endpoint:<id>:v<version>`.
// A rotation writes version N+1 and keeps N for the overlap window; the
// endpoint row's `secretVersion` says which is current.
// =============================================================================

import { Injectable } from '@nestjs/common';

import { CredentialsService, OrgCredentialsService, UserCredentialsService } from '../credentials/index';
import type { WebhookEndpointRow } from './data/webhooks-db';
import { WEBHOOK_SIGNING_PURPOSE } from './webhooks.constants';

/** The columns of an endpoint the store addresses by. @stability experimental */
export type SecretAddress = Pick<WebhookEndpointRow, 'id' | 'scope' | 'orgId' | 'ownerUserId'>;

/**
 * The credential name of one secret version.
 *
 * @param endpointId - the endpoint id.
 * @param version - the secret version.
 * @returns `endpoint:<id>:v<version>`.
 *
 * @stability experimental
 */
export function secretName(endpointId: string, version: number): string {
  return `endpoint:${endpointId}:v${version}`;
}

/**
 * The signing-secret port. See the file header.
 *
 * @stability experimental
 */
export abstract class WebhookSecrets {
  /** Stores version `version` of an endpoint's secret. */
  abstract put(endpoint: SecretAddress, version: number, secret: string): Promise<void>;
  /** Reads a version, or `null` when it is gone. */
  abstract get(endpoint: SecretAddress, version: number): Promise<string | null>;
  /** Deletes one version (a rotation's expired predecessor). */
  abstract remove(endpoint: SecretAddress, version: number): Promise<void>;
  /** Deletes versions `1..upTo` of an endpoint (its deletion). */
  abstract removeAll(endpoint: SecretAddress, upTo: number): Promise<void>;
}

/**
 * The credentials-store implementation.
 *
 * @internal
 *
 * @stability experimental
 */
@Injectable()
export class CredentialsWebhookSecrets extends WebhookSecrets {
  constructor(
    private readonly userCredentials: UserCredentialsService,
    private readonly orgCredentials: OrgCredentialsService,
    private readonly systemCredentials: CredentialsService,
  ) {
    super();
  }

  async put(endpoint: SecretAddress, version: number, secret: string): Promise<void> {
    const name = secretName(endpoint.id, version);
    const label = 'Webhook signing secret';
    if (endpoint.scope === 'user') await this.userCredentials.setSecret(this.owner(endpoint), WEBHOOK_SIGNING_PURPOSE, name, secret, { label });
    else if (endpoint.scope === 'org') await this.orgCredentials.setSecret(this.org(endpoint), WEBHOOK_SIGNING_PURPOSE, name, secret, { label });
    else await this.systemCredentials.setSecret(WEBHOOK_SIGNING_PURPOSE, name, secret, { label });
  }

  async get(endpoint: SecretAddress, version: number): Promise<string | null> {
    const name = secretName(endpoint.id, version);
    if (endpoint.scope === 'user') return this.userCredentials.getSecret(this.owner(endpoint), WEBHOOK_SIGNING_PURPOSE, name);
    if (endpoint.scope === 'org') return this.orgCredentials.getSecret(this.org(endpoint), WEBHOOK_SIGNING_PURPOSE, name);
    return this.systemCredentials.getSecret(WEBHOOK_SIGNING_PURPOSE, name);
  }

  async remove(endpoint: SecretAddress, version: number): Promise<void> {
    const name = secretName(endpoint.id, version);
    if (endpoint.scope === 'user') await this.userCredentials.deleteSecret(this.owner(endpoint), WEBHOOK_SIGNING_PURPOSE, name);
    else if (endpoint.scope === 'org') await this.orgCredentials.deleteSecret(this.org(endpoint), WEBHOOK_SIGNING_PURPOSE, name);
    else await this.systemCredentials.deleteSecret(WEBHOOK_SIGNING_PURPOSE, name);
  }

  async removeAll(endpoint: SecretAddress, upTo: number): Promise<void> {
    for (let version = 1; version <= upTo; version += 1) await this.remove(endpoint, version);
  }

  private owner(endpoint: SecretAddress): string {
    if (!endpoint.ownerUserId) throw new Error('A user-scope webhook endpoint has no owner');
    return endpoint.ownerUserId;
  }

  private org(endpoint: SecretAddress): string {
    if (!endpoint.orgId) throw new Error('An org-scope webhook endpoint has no organization');
    return endpoint.orgId;
  }
}
