// =============================================================================
// The client resolver seam (PP-15.4; PP-15.5 plugs the real policy in)
// =============================================================================
//
// "Which client is this `client_id`?" is answered through ONE interface, so the
// authorization server core does not know where clients come from. This issue
// ships the default: rows that already exist in `oauth_clients`, found by
// `client_id`. PP-15.5 adds the Client ID Metadata Document fetch (an HTTPS
// `client_id`), dynamic registration and the host trust policy behind the same
// interface, without touching the endpoints.
//
// TWO ENTRY POINTS, because the latency rules differ: `/authorize` MAY do the
// one outbound fetch a CIMD client needs (a person is waiting); `/token` and
// `/revoke` NEVER make an outbound call (hosted clients abandon them after
// 10 seconds), so they read only what is stored.
// =============================================================================

import { Inject, Injectable } from '@nestjs/common';
import type { OAuthErrorPageCode } from '@marinoscar/platform-contract/identity';

import { PLATFORM_PRISMA } from '../../core/index';
import type { IdentityOAuthClientRow, IdentityPrisma } from '../data/identity-db';
import { registeredRedirectUris } from './redirect-uri';

/**
 * Injection token of the app's {@link ClientResolver}. The default
 * ({@link StoredClientResolver}) is bound by `OAuthServerModule`.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const OAUTH_CLIENT_RESOLVER: unique symbol = Symbol.for('@marinoscar/platform/identity/OAUTH_CLIENT_RESOLVER');

/**
 * One OAuth client as the authorization server uses it.
 *
 * @stability experimental
 */
export interface OAuthClientRecord {
  /** The row id (what grants and tokens reference). */
  readonly id: string;
  /** The public `client_id`. */
  readonly clientId: string;
  /** `cimd`, `dynamic` or `registered`. */
  readonly kind: 'cimd' | 'dynamic' | 'registered';
  /** The self-asserted display name. */
  readonly name: string;
  /** The client's logo URL, or `null`. */
  readonly logoUri: string | null;
  /** The registered redirect URIs. */
  readonly redirectUris: readonly string[];
  /** `none`, `client_secret_post` or `client_secret_basic`. */
  readonly tokenEndpointAuthMethod: string;
  /** SHA-256 of the client secret (confidential clients), or `null`. */
  readonly secretHash: string | null;
  /** The lower-cased host. */
  readonly host: string;
  /** When the client was disabled, or `null`. */
  readonly disabledAt: Date | null;
  /** When the client first appeared on this deployment. */
  readonly createdAt: Date;
}

/**
 * The answer of {@link ClientResolver.resolveForAuthorization}: a client, or
 * the code of the web error page that explains why not (never a redirect to the
 * client's own redirect URI).
 *
 * @stability experimental
 */
export type ClientResolution = ClientResolved | ClientRefused;

/**
 * A client that may start an authorization.
 *
 * @stability experimental
 */
export interface ClientResolved {
  /** Always `true`. */
  readonly ok: true;
  /** The client. */
  readonly client: OAuthClientRecord;
}

/**
 * A client that may not, with the web error page code that says why.
 *
 * @stability experimental
 */
export interface ClientRefused {
  /** Always `false`. */
  readonly ok: false;
  /** `unknown_client`, `client_not_allowed` or `client_metadata_unavailable`. */
  readonly code: Extract<OAuthErrorPageCode, 'unknown_client' | 'client_not_allowed' | 'client_metadata_unavailable'>;
  /** For `client_not_allowed`: the host the error page names. */
  readonly host?: string;
}

/**
 * Where the authorization server learns about a client.
 *
 * @stability experimental
 */
export interface ClientResolver {
  /**
   * At `/authorize`: the client for `clientId` that may start an authorization,
   * or why not. May make one outbound call (a metadata document fetch).
   *
   * @param clientId - the `client_id` the request carries.
   */
  resolveForAuthorization(clientId: string): Promise<ClientResolution>;
  /**
   * At `/token` and `/revoke`: the STORED client row for `clientId`, a disabled
   * one included (the caller decides what a disabled client means), or `null`.
   * Never makes an outbound call.
   *
   * @param clientId - the `client_id` the request authenticated as.
   */
  resolveStored(clientId: string): Promise<OAuthClientRecord | null>;
}

/**
 * Maps a stored row to the record the server uses.
 *
 * @internal
 */
export function toClientRecord(row: IdentityOAuthClientRow): OAuthClientRecord {
  return {
    id: row.id,
    clientId: row.clientId,
    kind: row.kind,
    name: row.name,
    logoUri: row.logoUri,
    redirectUris: registeredRedirectUris(row.redirectUris),
    tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
    secretHash: row.secretHash,
    host: row.host,
    disabledAt: row.disabledAt,
    createdAt: row.createdAt,
  };
}

/**
 * The default resolver: a row that exists in `oauth_clients` and is not
 * disabled. A client that is not stored is `unknown_client`.
 *
 * @stability experimental
 */
@Injectable()
export class StoredClientResolver implements ClientResolver {
  constructor(@Inject(PLATFORM_PRISMA) private readonly prisma: IdentityPrisma) {}

  /** Implements the interface method of the same name. */
  async resolveForAuthorization(clientId: string): Promise<ClientResolution> {
    const client = await this.resolveStored(clientId);
    if (!client || client.disabledAt !== null) return { ok: false, code: 'unknown_client' };
    return { ok: true, client };
  }

  /** Implements the interface method of the same name. */
  async resolveStored(clientId: string): Promise<OAuthClientRecord | null> {
    const row = await this.prisma.oAuthClient.findUnique({ where: { clientId } });
    return row ? toClientRecord(row) : null;
  }
}
