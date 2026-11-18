// =============================================================================
// OAuth server test helpers (PP-15.4; PP-15.8's test kit re-exports them)
// =============================================================================
//
// What a suite that drives the authorization server "as a client would" needs:
// a PKCE verifier and challenge pair, and a client row in `oauth_clients` with
// a known secret. Structural over the Prisma client (`oAuthClient.create`), so
// the helper depends on no generated client. Test code only.
// =============================================================================

import { createHash, randomBytes, randomUUID } from 'node:crypto';

/**
 * A PKCE pair (RFC 7636, S256).
 *
 * @stability experimental
 */
export interface OAuthTestPkcePair {
  /** The code verifier (43 characters). */
  readonly verifier: string;
  /** `BASE64URL(SHA256(verifier))`. */
  readonly challenge: string;
}

/**
 * A fresh PKCE verifier and its S256 challenge.
 *
 * @returns the pair.
 *
 * @stability experimental
 */
export function createOAuthTestPkce(): OAuthTestPkcePair {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier, 'ascii').digest('base64url') };
}

/**
 * Options of {@link createOAuthTestClient}.
 *
 * @stability experimental
 */
export interface OAuthTestClientOptions {
  /** `client_id`; default a generated `oc_...`. */
  clientId?: string;
  /** Display name; default `Test Client`. */
  name?: string;
  /** `registered` (default), `dynamic` or `cimd`. */
  kind?: 'registered' | 'dynamic' | 'cimd';
  /** Registered redirect URIs; default `https://client.example.test/callback`. */
  redirectUris?: string[];
  /** `none` (default, a public client), `client_secret_post` or `client_secret_basic`. */
  tokenEndpointAuthMethod?: 'none' | 'client_secret_post' | 'client_secret_basic';
  /** The client's host; default `client.example.test`. */
  host?: string;
  /** Insert it disabled. */
  disabled?: boolean;
  /** A logo URL. */
  logoUri?: string;
}

/**
 * A client row created by {@link createOAuthTestClient}.
 *
 * @stability experimental
 */
export interface OAuthTestClient {
  /** `oauth_clients.id`. */
  readonly id: string;
  /** The public `client_id`. */
  readonly clientId: string;
  /** The registered redirect URIs. */
  readonly redirectUris: readonly string[];
  /** The first redirect URI. */
  readonly redirectUri: string;
  /** The authentication method. */
  readonly tokenEndpointAuthMethod: string;
  /** The client secret, for a confidential client only (the row stores its hash). */
  readonly secret?: string;
  /** The client's host. */
  readonly host: string;
}

/**
 * The part of the Prisma client the helper calls.
 *
 * @stability experimental
 */
export interface OAuthTestClientDb {
  /** The `oauth_clients` delegate. */
  oAuthClient: OAuthTestClientDelegate;
}

/**
 * What `create` resolves to.
 *
 * @stability experimental
 */
export interface OAuthTestClientCreated {
  /** The row id. */
  id: string;
}

/**
 * The `create` of the `oauth_clients` delegate.
 *
 * @stability experimental
 */
export interface OAuthTestClientDelegate {
  /**
   * Inserts one client row.
   *
   * @param args - the Prisma `create` arguments.
   * @returns the row (its `id`).
   */
  create(args: { data: Record<string, unknown> }): Promise<OAuthTestClientCreated>;
}

/**
 * Inserts a client row, as PP-15.5 will in production, and returns what a test
 * needs to act as that client (including the secret of a confidential one).
 *
 * @param db - a Prisma client (or anything with `oAuthClient.create`).
 * @param options - see {@link OAuthTestClientOptions}.
 * @returns the client.
 *
 * @stability experimental
 * @example
 * ```ts
 * const client = await createOAuthTestClient(prisma, { tokenEndpointAuthMethod: 'client_secret_basic' });
 * const { verifier, challenge } = createOAuthTestPkce();
 * ```
 */
export async function createOAuthTestClient(db: OAuthTestClientDb, options: OAuthTestClientOptions = {}): Promise<OAuthTestClient> {
  const clientId = options.clientId ?? `oc_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const method = options.tokenEndpointAuthMethod ?? 'none';
  const redirectUris = options.redirectUris ?? ['https://client.example.test/callback'];
  const host = options.host ?? 'client.example.test';
  const secret = method === 'none' ? undefined : randomBytes(24).toString('base64url');
  const row = await db.oAuthClient.create({
    data: {
      clientId,
      kind: options.kind ?? 'registered',
      name: options.name ?? 'Test Client',
      redirectUris,
      tokenEndpointAuthMethod: method,
      host,
      ...(options.logoUri ? { logoUri: options.logoUri } : {}),
      ...(secret ? { secretHash: createHash('sha256').update(secret).digest('hex') } : {}),
      ...(options.disabled ? { disabledAt: new Date() } : {}),
    },
  });
  return { id: row.id, clientId, redirectUris, redirectUri: redirectUris[0]!, tokenEndpointAuthMethod: method, host, ...(secret ? { secret } : {}) };
}
