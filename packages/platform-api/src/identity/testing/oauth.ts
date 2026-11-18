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

import { oauthResourceRegistry } from '../oauth-server/oauth-resource.registry';

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

// =============================================================================
// The OAuth server test kit (PP-15.8, #1186)
// =============================================================================

/** Alias of {@link createOAuthTestPkce}: a PKCE verifier and its S256 challenge. @stability experimental */
export const pkcePair = createOAuthTestPkce;

/**
 * The part of the Prisma client {@link mintOAuthTestToken} calls.
 *
 * @stability experimental
 */
export interface OAuthTestTokenDb extends OAuthTestClientDb {
  /** `oauth_grants`. */
  oAuthGrant: { create(args: { data: Record<string, unknown> }): Promise<{ id: string }> };
  /** `oauth_tokens`. */
  oAuthToken: { create(args: { data: Record<string, unknown> }): Promise<{ id: string }> };
}

/**
 * Input of {@link mintOAuthTestToken}.
 *
 * @stability experimental
 */
export interface MintOAuthTestTokenInput {
  /** The user the grant belongs to (must exist and hold the permissions the scopes name). */
  userId: string;
  /** The registered protected resource id the token is for. */
  resourceId: string;
  /** The scope ids the grant and the token carry. */
  scopes: readonly string[];
  /** The application root (`APP_URL`); the resource identifier is `appUrl + resource.path`. */
  appUrl: string;
  /** The organization the grant acts in; omit for an unbound grant (single mode). */
  orgId?: string;
  /** Use this client row instead of creating one. */
  client?: Pick<OAuthTestClient, 'id'>;
  /** Access token life in milliseconds; one hour by default. */
  ttlMs?: number;
}

/**
 * A minted token and the rows behind it.
 *
 * @stability experimental
 */
export interface MintedOAuthTestToken {
  /** The raw `oat_` access token. */
  readonly token: string;
  /** `oauth_grants.id`. */
  readonly grantId: string;
  /** `oauth_tokens.id`. */
  readonly tokenId: string;
  /** `oauth_clients.id`. */
  readonly clientRowId: string;
}

/**
 * Inserts a client (unless given), a grant and an access token row, and returns
 * the raw token: a token without the consent round trip, for tests that probe
 * the resource side (confinement, narrowing, revocation).
 *
 * @param db - a Prisma client.
 * @param input - see {@link MintOAuthTestTokenInput}.
 * @returns the token and its row ids.
 * @throws Error when the resource is not registered.
 *
 * @stability experimental
 */
export async function mintOAuthTestToken(db: OAuthTestTokenDb, input: MintOAuthTestTokenInput): Promise<MintedOAuthTestToken> {
  const resource = oauthResourceRegistry.get(input.resourceId);
  if (!resource) throw new Error(`mintOAuthTestToken: unknown protected resource "${input.resourceId}"`);
  const client = input.client ?? (await createOAuthTestClient(db));
  const grant = await db.oAuthGrant.create({
    data: {
      userId: input.userId,
      clientId: client.id,
      resource: `${input.appUrl.replace(/\/+$/, '')}${resource.path}`,
      scopes: [...input.scopes],
      ...(input.orgId ? { orgId: input.orgId } : {}),
    },
  });
  const token = `oat_${randomBytes(32).toString('base64url')}`;
  const row = await db.oAuthToken.create({
    data: {
      kind: 'access',
      tokenHash: createHash('sha256').update(token).digest('hex'),
      tokenPrefix: token.slice(4, 12),
      grantId: grant.id,
      scopes: [...input.scopes],
      expiresAt: new Date(Date.now() + (input.ttlMs ?? 3_600_000)),
    },
  });
  return { token, grantId: grant.id, tokenId: row.id, clientRowId: client.id };
}

/**
 * The part of a Nest Fastify application the flow helpers drive.
 *
 * @stability experimental
 */
export interface OAuthTestApp {
  /** The HTTP adapter host. */
  getHttpAdapter(): {
    /** The Fastify instance. */
    getInstance(): {
      /** Fastify's `inject`. */
      inject(options: Record<string, unknown>): Promise<{ statusCode: number; headers: Record<string, unknown>; body: string }>;
    };
  };
}

/**
 * Input of {@link runOAuthAuthorizationCodeFlow}.
 *
 * @stability experimental
 */
export interface OAuthCodeFlowInput {
  /** The client (from {@link createOAuthTestClient}, or any `{ clientId, redirectUri }`). */
  client: { clientId: string; redirectUri: string };
  /** The signed-in user approving: a SESSION access token (the consent routes refuse any other credential). */
  user: { sessionToken: string };
  /** The scopes requested. */
  scopes: readonly string[];
  /** The resource URL (`APP_URL` + the resource path). */
  resource: string;
  /** The `state`; a fresh one by default. */
  state?: string;
  /** `approve` (default) or `deny`. */
  decision?: 'approve' | 'deny';
  /** A PKCE pair; a fresh one by default. */
  pkce?: OAuthTestPkcePair;
}

/**
 * What the flow produced.
 *
 * @stability experimental
 */
export interface OAuthCodeFlowResult {
  /** The code from the redirect (absent after a deny or an error). */
  readonly code?: string;
  /** The final redirect URL the consent API answered. */
  readonly redirectTo: string;
  /** `state` as it came back. */
  readonly state: string | null;
  /** `iss` as it came back. */
  readonly iss: string | null;
  /** The PKCE pair used. */
  readonly pkce: OAuthTestPkcePair;
  /** The pending request id. */
  readonly requestId: string;
}

/**
 * Drives `/authorize`, the consent read and the decision as a client and a user
 * would, in process.
 *
 * @param app - the booted application.
 * @param input - see {@link OAuthCodeFlowInput}.
 * @returns the code and what came back on the redirect.
 * @throws Error when a step does not answer as the protocol says.
 *
 * @stability experimental
 */
export async function runOAuthAuthorizationCodeFlow(app: OAuthTestApp, input: OAuthCodeFlowInput): Promise<OAuthCodeFlowResult> {
  const fastify = app.getHttpAdapter().getInstance();
  const pkce = input.pkce ?? createOAuthTestPkce();
  const state = input.state ?? randomBytes(8).toString('hex');
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: input.client.clientId,
    redirect_uri: input.client.redirectUri,
    scope: input.scopes.join(' '),
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    resource: input.resource,
  });
  const authorized = await fastify.inject({ method: 'GET', url: `/api/oauth/authorize?${query.toString()}` });
  const location = String(authorized.headers.location ?? '');
  const requestId = location ? new URL(location).searchParams.get('request') : null;
  if (authorized.statusCode !== 302 || !requestId) throw new Error(`authorize did not reach the consent page (${authorized.statusCode} ${location})`);
  const headers = { authorization: `Bearer ${input.user.sessionToken}` };
  const read = await fastify.inject({ method: 'GET', url: `/api/oauth/requests/${requestId}`, headers });
  if (read.statusCode !== 200) throw new Error(`consent read answered ${read.statusCode}`);
  const decided = await fastify.inject({
    method: 'POST',
    url: `/api/oauth/requests/${requestId}/decision`,
    headers: { ...headers, 'content-type': 'application/json' },
    payload: JSON.stringify({ decision: input.decision ?? 'approve' }),
  });
  if (decided.statusCode !== 200) throw new Error(`consent decision answered ${decided.statusCode}`);
  const redirectTo = (JSON.parse(decided.body) as { data: { redirectTo: string } }).data.redirectTo;
  const url = new URL(redirectTo);
  return { code: url.searchParams.get('code') ?? undefined, redirectTo, state: url.searchParams.get('state'), iss: url.searchParams.get('iss'), pkce, requestId };
}

/**
 * Exchanges a code at the token endpoint with a form body, as a client does.
 *
 * @param app - the booted application.
 * @param input - the client, the code, the PKCE verifier and an optional secret (sent as `client_secret_post`).
 * @returns the status and parsed JSON body.
 *
 * @stability experimental
 */
export async function exchangeOAuthCode(
  app: OAuthTestApp,
  input: { client: { clientId: string; redirectUri: string; secret?: string }; code: string; verifier: string },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.client.redirectUri,
    code_verifier: input.verifier,
    client_id: input.client.clientId,
    ...(input.client.secret ? { client_secret: input.client.secret } : {}),
  });
  const res = await app.getHttpAdapter().getInstance().inject({
    method: 'POST',
    url: '/api/oauth/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: form.toString(),
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, unknown> };
}
