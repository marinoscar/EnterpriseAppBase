// =============================================================================
// Dynamic client registration, RFC 7591 (PP-15.5)
// =============================================================================
//
// `POST /api/oauth/register`. Validates the metadata, applies the trust policy,
// stores a `dynamic` client and returns its id (and, once, its secret). Errors
// are RFC 7591 JSON: `invalid_redirect_uri`, `invalid_client_metadata`, and `403
// invalid_client_metadata` for a host the deployment does not allow.
//
// A public client that registers again with exactly the same redirect URIs, name
// and host as an existing dynamic public client gets THAT client back: hosted
// clients register on every connection, and without this the table would grow
// without bound.
// =============================================================================

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { OAuthRegistrationResponse } from '@marinoscar/platform-contract/identity';

import { PLATFORM_PRISMA } from '../../../core/index';
import { IDENTITY_METRICS, NOOP_IDENTITY_METRICS, type IdentityMetrics } from '../../ports';
import { isPrismaErrorCode, type IdentityOAuthClientRow, type IdentityPrisma } from '../../data/identity-db';
import { OAuthProtocolError } from '../oauth-protocol.error';
import { isLoopbackRedirectUri, registeredRedirectUris } from '../redirect-uri';
import { CLIENT_NAME_MAX_LENGTH, sharedRedirectHost, validateRedirectUris } from './client-redirects';
import { ClientRefusalRecorder } from './client-refusal.recorder';
import { ClientTrustPolicy } from './client-trust.policy';
import { hashClientSecret, newClientId, newClientSecret } from './client-secret';

const METHODS = ['none', 'client_secret_post', 'client_secret_basic'] as const;

/** `400 invalid_client_metadata`. */
function invalidMetadata(description: string): OAuthProtocolError {
  return new OAuthProtocolError(400, 'invalid_client_metadata', description);
}

/** The one string an optional field may be, or `undefined`. */
function optionalString(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalidMetadata(`${field} must be a string.`);
  if (value.length > max) throw invalidMetadata(`${field} is longer than ${max} characters.`);
  return value;
}

/** An optional `https:` URL, or `undefined` when it is not one. */
function httpsUrl(value: string | undefined): URL | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sorted = [...a].sort();
  const other = [...b].sort();
  return sorted.every((value, index) => value === other[index]);
}

/**
 * Registers dynamic clients.
 *
 * @stability experimental
 */
@Injectable()
export class ClientRegistrationService {
  private readonly logger = new Logger(ClientRegistrationService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: IdentityPrisma,
    private readonly trust: ClientTrustPolicy,
    private readonly refusals: ClientRefusalRecorder,
    @Optional() @Inject(IDENTITY_METRICS) private readonly metrics: IdentityMetrics = NOOP_IDENTITY_METRICS,
  ) {}

  /**
   * Validates `body` and returns the registered (or the identical existing) client.
   *
   * @param body - the parsed JSON body.
   * @returns the RFC 7591 response.
   * @throws OAuthProtocolError 400 `invalid_client_metadata` / `invalid_redirect_uri`; 403 `invalid_client_metadata` for a host that is not allowed.
   */
  async register(body: unknown): Promise<OAuthRegistrationResponse> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw invalidMetadata('The body must be a JSON object.');
    const input = body as Record<string, unknown>;

    const redirects = input.redirect_uris;
    if (!Array.isArray(redirects)) throw new OAuthProtocolError(400, 'invalid_redirect_uri', 'redirect_uris is required and must be an array.');

    const appTypeRaw = input.application_type;
    if (appTypeRaw !== undefined && appTypeRaw !== 'web' && appTypeRaw !== 'native') throw invalidMetadata('application_type must be web or native.');
    const hasLoopback = redirects.some((uri) => typeof uri === 'string' && isLoopbackRedirectUri(uri));
    const applicationType: 'web' | 'native' = appTypeRaw ?? (hasLoopback ? 'native' : 'web');
    const problem = validateRedirectUris(redirects, applicationType);
    if (problem) throw new OAuthProtocolError(400, 'invalid_redirect_uri', problem.message);
    const redirectUris = redirects as string[];
    const host = sharedRedirectHost(redirectUris);
    if (host === null) throw new OAuthProtocolError(400, 'invalid_redirect_uri', 'Every non-loopback redirect URI must be on the same host.');

    const method = input.token_endpoint_auth_method ?? 'none';
    if (typeof method !== 'string' || !(METHODS as readonly string[]).includes(method)) throw invalidMetadata('token_endpoint_auth_method is not supported.');
    const grantTypes = input.grant_types;
    if (grantTypes !== undefined && (!Array.isArray(grantTypes) || !grantTypes.includes('authorization_code'))) throw invalidMetadata('grant_types must include authorization_code.');
    const responseTypes = input.response_types;
    if (responseTypes !== undefined && (!Array.isArray(responseTypes) || !responseTypes.includes('code'))) throw invalidMetadata('response_types must include code.');
    optionalString(input.scope, 'scope', 2000);

    const name = (optionalString(input.client_name, 'client_name', CLIENT_NAME_MAX_LENGTH) ?? '').trim() || host;
    const clientUri = httpsUrl(optionalString(input.client_uri, 'client_uri', 2000))?.href;
    const logoUrl = httpsUrl(optionalString(input.logo_uri, 'logo_uri', 2000));
    // Shown only when `https:` and on the client's host.
    const logoUri = logoUrl && logoUrl.hostname.toLowerCase() === host ? logoUrl.href : undefined;

    // The trust policy runs at registration too.
    const verdict = await this.trust.evaluate({ kind: 'dynamic', host, redirectUris });
    if (!verdict.admitted) {
      await this.refusals.record(verdict.host, verdict.reason);
      throw new OAuthProtocolError(403, 'invalid_client_metadata', `The client host is not allowed on this deployment.`);
    }

    // Idempotence for a public client.
    if (method === 'none') {
      const candidates = await this.prisma.oAuthClient.findMany<IdentityOAuthClientRow>({
        where: { kind: 'dynamic', tokenEndpointAuthMethod: 'none', host, name, disabledAt: null },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      const same = candidates.find((row) => sameSet(registeredRedirectUris(row.redirectUris), redirectUris));
      if (same) return this.toResponse(same, undefined);
    }

    const secret = method === 'none' ? undefined : newClientSecret();
    const row = await this.createWithFreshId({
      kind: 'dynamic',
      name,
      redirectUris,
      tokenEndpointAuthMethod: method,
      applicationType,
      host,
      ...(secret ? { secretHash: hashClientSecret(secret) } : {}),
      ...(clientUri ? { clientUri } : {}),
      ...(logoUri ? { logoUri } : {}),
    });
    this.metrics.add('oauthClientRegistrations', 1, { kind: 'dynamic' });
    this.logger.log(`oauth register: client ${row.id} (${method === 'none' ? 'public' : 'confidential'})`);
    return this.toResponse(row, secret);
  }

  private async createWithFreshId(data: Record<string, unknown>): Promise<IdentityOAuthClientRow> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.oAuthClient.create<IdentityOAuthClientRow>({ data: { ...data, clientId: newClientId() } });
      } catch (error) {
        if (attempt < 2 && isPrismaErrorCode(error, 'P2002')) continue;
        throw error;
      }
    }
  }

  private toResponse(row: IdentityOAuthClientRow, secret: string | undefined): OAuthRegistrationResponse {
    return {
      client_id: row.clientId,
      ...(secret ? { client_secret: secret } : {}),
      client_secret_expires_at: 0 as const,
      client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
      redirect_uris: registeredRedirectUris(row.redirectUris),
      client_name: row.name,
      token_endpoint_auth_method: row.tokenEndpointAuthMethod as OAuthRegistrationResponse['token_endpoint_auth_method'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      application_type: row.applicationType === 'native' ? 'native' : 'web',
      ...(row.clientUri ? { client_uri: row.clientUri } : {}),
      ...(row.logoUri ? { logo_uri: row.logoUri } : {}),
    };
  }
}
