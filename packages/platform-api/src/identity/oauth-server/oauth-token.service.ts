// =============================================================================
// The token and revocation endpoints (PP-15.4)
// =============================================================================
//
// RFC 6749 §4.1.3 / §6 / §5, RFC 7636 (PKCE, S256 only), RFC 7009; the contract
// is docs/specs/oauth-server.md §2.11 and §2.13, as amended (the refresh grace
// window): the server stores only HASHES, so a retried refresh cannot be answered
// with "the same successor". Inside the 10-second window, a previous refresh
// token presented again, whose successor has NOT been used yet, revokes that
// successor and issues a NEW pair; a successor already used is REUSE and kills
// the grant.
//
// LATENCY BUDGET (issue #1182, section 8): hosted clients abandon token calls after
// 10 seconds. No outbound call, and the two hot paths are FIVE data statements
// (the budget is six; BEGIN and COMMIT are transaction control, not queries):
//   client row (1) + the code or refresh token (1) + its grant (1), all by unique
//   key, then in ONE transaction a conditional UPDATE that consumes or rotates (1)
//   and one INSERT of both tokens (`createMany`, 1).
// (The generated client has no `relationJoins` preview, so an `include` is a
// second statement; the count is the same.)
// `apps/api/test/identity/oauth/oauth-authorization-server.db.spec.ts` pins it.
//
// ERRORS never say which check failed: an unknown, expired, consumed, revoked or
// foreign code or token is the same `invalid_grant`.
// =============================================================================

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OAuthTokenResponse } from '@marinoscar/platform-contract/identity';

import { PLATFORM_PRISMA } from '../../core/index';
import type { IdentityOAuthGrantRow, IdentityOAuthTokenRow, IdentityPrisma, IdentityOAuthAuthorizationCodeRow } from '../data/identity-db';
import { OAUTH_CLIENT_RESOLVER, type ClientResolver, type OAuthClientRecord } from './client-resolver';
import { OAuthGrantService, OAUTH_AUDIT_ACTIONS, type OAuthGrantRef } from './oauth-grant.service';
import { invalidClient, oauthError, rateLimited } from './oauth-protocol.error';
import { OAuthRateLimitService } from './oauth-rate-limiter';
import {
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_RATE_LIMITS,
  OAUTH_REFRESH_GRACE_MS,
  OAUTH_REFRESH_TOKEN_PREFIX,
} from './oauth-server.constants';
import { OFFLINE_ACCESS_SCOPE } from './oauth-scope.registry';
import { OAuthServerSettingsReader } from './oauth-server-settings.reader';
import { verifyPkce } from './pkce';

const DAY_MS = 86_400_000;

/** The parsed form body of a protocol request: every value a string. */
export type OAuthFormBody = Readonly<Record<string, string>>;

type CodeWithGrant = IdentityOAuthAuthorizationCodeRow & { grant: IdentityOAuthGrantRow };
type TokenWithGrant = IdentityOAuthTokenRow & { grant: IdentityOAuthGrantRow };

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Constant-time equality of two hex strings. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Parses an `application/x-www-form-urlencoded` body that the HTTP adapter already
 * decoded into a plain object. A repeated parameter (an array) is refused: OAuth
 * parameters occur at most once (RFC 6749 §3.1).
 *
 * @param raw - the parsed body.
 * @returns the body as string values.
 * @throws OAuthProtocolError `400 invalid_request` for a non-form body or a repeated parameter.
 *
 * @stability experimental
 */
export function parseOAuthForm(raw: unknown): OAuthFormBody {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw oauthError('invalid_request', 'The request body must be application/x-www-form-urlencoded.');
  const out: Record<string, string> = {};
  let size = 0;
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') throw oauthError('invalid_request', 'Each parameter may appear only once.');
    size += name.length + value.length;
    out[name] = value;
  }
  // A proxy for the 16 KiB wire limit, for a body without a Content-Length (chunked).
  if (size > 16 * 1024) throw oauthError('invalid_request', 'The request body is too large.');
  return out;
}

/** Decodes an `Authorization: Basic` header (RFC 6749 §2.3.1: both parts are form-url-encoded). */
function parseBasic(header: string | undefined): { id: string; secret: string } | null {
  if (!header || !/^basic /i.test(header)) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  } catch {
    return null;
  }
  const colon = decoded.indexOf(':');
  if (colon < 0) return null;
  try {
    return { id: decodeURIComponent(decoded.slice(0, colon).replace(/\+/g, ' ')), secret: decodeURIComponent(decoded.slice(colon + 1).replace(/\+/g, ' ')) };
  } catch {
    return null;
  }
}

/**
 * The token endpoint and revocation.
 *
 * @stability experimental
 */
@Injectable()
export class OAuthTokenService {
  private readonly logger = new Logger(OAuthTokenService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: IdentityPrisma,
    @Inject(OAUTH_CLIENT_RESOLVER) private readonly clients: ClientResolver,
    private readonly limiter: OAuthRateLimitService,
    private readonly settings: OAuthServerSettingsReader,
    private readonly grants: OAuthGrantService,
  ) {}

  // ---- client authentication -----------------------------------------------------------------

  /**
   * Authenticates the client of a `/token` or `/revoke` request (RFC 6749 §2.3):
   * `none` (public; `client_id` in the body), `client_secret_post` or
   * `client_secret_basic`, as the client's `token_endpoint_auth_method` says.
   * The rate limit (per claimed client id) is applied FIRST: an attacker
   * guessing secrets is throttled before any lookup.
   *
   * @throws OAuthProtocolError `invalid_request`, `invalid_client` (401) or `temporarily_unavailable` (429).
   */
  private async authenticate(body: OAuthFormBody, authorization: string | undefined, bucket: 'token' | 'revoke'): Promise<OAuthClientRecord> {
    const basic = parseBasic(authorization);
    const claimed = basic?.id ?? body.client_id;
    if (!claimed) throw oauthError('invalid_request', 'The client_id is required.');
    if (basic && body.client_id !== undefined && body.client_id !== basic.id) throw oauthError('invalid_request', 'The client_id does not match the Authorization header.');

    const spec = bucket === 'token' ? OAUTH_RATE_LIMITS.tokenPerClient : OAUTH_RATE_LIMITS.revokePerClient;
    const verdict = await this.limiter.consume(`oauth:${bucket}:${claimed}`, spec.limit, spec.windowMs);
    if (!verdict.allowed) throw rateLimited(verdict.retryAfterSeconds);

    const client = await this.clients.resolveStored(claimed);
    if (!client) throw invalidClient();

    const method = client.tokenEndpointAuthMethod;
    if (method === 'none') return client;
    if (client.secretHash === null) throw invalidClient();
    const secret = method === 'client_secret_basic' ? basic?.secret : body.client_secret;
    if (secret === undefined || secret === '' || !safeEqual(sha256(secret), client.secretHash)) throw invalidClient();
    return client;
  }

  // ---- POST /token -----------------------------------------------------------------------------

  /**
   * Answers a token request.
   *
   * @param body - the parsed form.
   * @param authorization - the `Authorization` header, if any.
   * @returns the RFC 6749 §5.1 body.
   * @throws OAuthProtocolError the RFC 6749 §5.2 errors.
   */
  async token(body: OAuthFormBody, authorization: string | undefined): Promise<OAuthTokenResponse> {
    const client = await this.authenticate(body, authorization, 'token');
    const grantType = body.grant_type;
    if (grantType === 'authorization_code') return this.exchangeCode(client, body);
    if (grantType === 'refresh_token') return this.refresh(client, body);
    if (grantType === undefined) throw oauthError('invalid_request', 'The grant_type is required.');
    throw oauthError('unsupported_grant_type', 'Supported grant types: authorization_code, refresh_token.');
  }

  private async exchangeCode(client: OAuthClientRecord, body: OAuthFormBody): Promise<OAuthTokenResponse> {
    const { code, redirect_uri: redirectUri, code_verifier: verifier, resource } = body;
    if (!code || !redirectUri) throw oauthError('invalid_request', 'The code and redirect_uri are required.');
    if (!verifier) throw oauthError('invalid_request', 'The code_verifier is required.');

    // 1. The code, by hash, with its grant.
    const row = await this.prisma.oAuthAuthorizationCode.findUnique<CodeWithGrant>({
      where: { codeHash: sha256(code) },
      include: { grant: true },
    });
    if (!row) throw this.invalidGrant('code');

    // 2. Already consumed: somebody replayed it. The grant dies.
    if (row.consumedAt !== null) {
      await this.reuse(row.grant, 'authorization_code');
      throw this.invalidGrant('code reuse');
    }
    // 3. Expired, another client's, a different redirect URI or resource, a dead grant or client.
    const now = new Date();
    if (
      row.expiresAt.getTime() <= now.getTime() ||
      row.grant.clientId !== client.id ||
      row.grant.revokedAt !== null ||
      client.disabledAt !== null ||
      row.redirectUri !== redirectUri ||
      (resource !== undefined && resource !== '' && !this.sameResource(resource, row.resource))
    ) {
      throw this.invalidGrant('code check');
    }
    // 4. PKCE, constant time.
    if (!verifyPkce(verifier, row.codeChallenge)) throw this.invalidGrant('pkce');

    // 5. One transaction: consume the code; insert the access token and, when allowed, the refresh token.
    const scopes = row.scope.split(' ').filter((scope) => scope !== '');
    const settings = await this.settings.read();
    const issueRefresh = scopes.includes(OFFLINE_ACCESS_SCOPE) || settings.alwaysIssueRefreshToken;
    const access = this.mintToken(OAUTH_ACCESS_TOKEN_PREFIX);
    const refresh = issueRefresh ? this.mintToken(OAUTH_REFRESH_TOKEN_PREFIX) : null;
    const accessExpiresAt = new Date(now.getTime() + settings.accessTokenTtlMinutes * 60_000);

    try {
      await this.prisma.$transaction(async (tx) => {
        const consumed = await tx.oAuthAuthorizationCode.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: now } });
        if (consumed.count === 0) throw new CodeRaceSignal();
        await tx.oAuthToken.createMany({
          data: [
            this.tokenRow(access, 'access', row.grant.id, scopes, accessExpiresAt, now),
            ...(refresh ? [this.tokenRow(refresh, 'refresh', row.grant.id, scopes, this.refreshExpiry(settings, row.grant.createdAt, now), now)] : []),
          ],
        });
      });
    } catch (error) {
      if (error instanceof CodeRaceSignal) {
        // Two exchanges of one code raced: the loser is a replay.
        await this.reuse(row.grant, 'authorization_code');
        throw this.invalidGrant('code race');
      }
      throw error;
    }

    this.logger.log(`oauth token: authorization_code issued, grant ${row.grant.id} client ${client.id}`);
    return this.response(access.raw, accessExpiresAt, now, refresh?.raw, scopes);
  }

  private async refresh(client: OAuthClientRecord, body: OAuthFormBody): Promise<OAuthTokenResponse> {
    const presented = body.refresh_token;
    if (!presented) throw oauthError('invalid_request', 'The refresh_token is required.');
    const requestedScope = body.scope;

    // 1. The token with its grant. Everything wrong is the same `invalid_grant`.
    const token = await this.prisma.oAuthToken.findUnique<TokenWithGrant>({
      where: { tokenHash: sha256(presented) },
      include: { grant: true },
    });
    const now = new Date();
    if (
      !token ||
      token.kind !== 'refresh' ||
      token.grant.clientId !== client.id ||
      token.grant.revokedAt !== null ||
      client.disabledAt !== null ||
      token.revokedAt !== null ||
      token.expiresAt.getTime() <= now.getTime()
    ) {
      throw this.invalidGrant('refresh check');
    }

    // 2. A rotated token coming back: the grace window, or reuse.
    let graceOf: { successorId: string; rotatedAt: Date } | null = null;
    if (token.rotatedAt !== null) {
      if (now.getTime() - token.rotatedAt.getTime() <= OAUTH_REFRESH_GRACE_MS && (await this.successorUnused(token))) {
        graceOf = { successorId: token.replacedById!, rotatedAt: token.rotatedAt };
      } else {
        await this.reuse(token.grant, 'refresh_token');
        throw this.invalidGrant('refresh reuse');
      }
    }

    // 3. `scope` may only narrow.
    const held = token.scopes;
    let scopes = held;
    if (requestedScope !== undefined && requestedScope !== '') {
      const asked = [...new Set(requestedScope.split(' ').filter((scope) => scope !== ''))];
      if (asked.some((scope) => !held.includes(scope))) throw oauthError('invalid_scope', 'The requested scope exceeds the granted scope.');
      scopes = asked;
    }

    // 4. Rotate: one transaction.
    const settings = await this.settings.read();
    const access = this.mintToken(OAUTH_ACCESS_TOKEN_PREFIX);
    const next = this.mintToken(OAUTH_REFRESH_TOKEN_PREFIX);
    const accessExpiresAt = new Date(now.getTime() + settings.accessTokenTtlMinutes * 60_000);
    const refreshExpiresAt = this.refreshExpiry(settings, token.grant.createdAt, now);
    if (refreshExpiresAt.getTime() <= now.getTime()) throw this.invalidGrant('refresh chain age');

    await this.prisma.$transaction(async (tx) => {
      if (graceOf) {
        // The retry of a lost response: the first successor pair was never delivered, so it dies.
        await tx.oAuthToken.updateMany({ where: { id: graceOf.successorId, revokedAt: null }, data: { revokedAt: now } });
        await tx.oAuthToken.updateMany({
          where: { grantId: token.grant.id, kind: 'access', revokedAt: null, createdAt: { gte: graceOf.rotatedAt } },
          data: { revokedAt: now },
        });
        await tx.oAuthToken.update({ where: { id: token.id }, data: { replacedById: next.id } });
      } else {
        const rotated = await tx.oAuthToken.updateMany({
          where: { id: token.id, rotatedAt: null, revokedAt: null },
          data: { rotatedAt: now, replacedById: next.id },
        });
        if (rotated.count === 0) throw new RotationRaceSignal();
      }
      await tx.oAuthToken.createMany({
        data: [
          // The access token may be narrower; the refresh token keeps everything the client was granted.
          this.tokenRow(access, 'access', token.grant.id, scopes, accessExpiresAt, now),
          this.tokenRow(next, 'refresh', token.grant.id, held, refreshExpiresAt, now),
        ],
      });
    }).catch(async (error: unknown) => {
      if (error instanceof RotationRaceSignal) {
        // Two rotations of one token raced: the second is a replay of a rotated token.
        const fresh = await this.prisma.oAuthToken.findUnique<{ rotatedAt: Date | null }>({ where: { id: token.id }, select: { rotatedAt: true } });
        if (fresh?.rotatedAt && Date.now() - fresh.rotatedAt.getTime() <= OAUTH_REFRESH_GRACE_MS) throw oauthError('invalid_grant', 'The refresh token is invalid or expired.');
        await this.reuse(token.grant, 'refresh_token');
        throw this.invalidGrant('refresh race');
      }
      throw error;
    });

    this.logger.log(`oauth token: refresh ${graceOf ? 'retry' : 'rotated'}, grant ${token.grant.id} client ${client.id}`);
    return this.response(access.raw, accessExpiresAt, now, next.raw, scopes);
  }

  /** Whether the successor of a rotated refresh token was never presented (and is still live). */
  private async successorUnused(token: TokenWithGrant): Promise<boolean> {
    if (!token.replacedById) return false;
    const successor = await this.prisma.oAuthToken.findUnique<Pick<IdentityOAuthTokenRow, 'rotatedAt' | 'revokedAt' | 'grantId'>>({
      where: { id: token.replacedById },
      select: { rotatedAt: true, revokedAt: true, grantId: true },
    });
    return successor !== null && successor.grantId === token.grantId && successor.rotatedAt === null && successor.revokedAt === null;
  }

  /** The refresh token's expiry: a window from now, capped at the grant's age limit (0 = no cap). */
  private refreshExpiry(settings: { refreshTokenTtlDays: number; refreshTokenMaxAgeDays: number }, grantCreatedAt: Date, now: Date): Date {
    const window = now.getTime() + settings.refreshTokenTtlDays * DAY_MS;
    if (settings.refreshTokenMaxAgeDays === 0) return new Date(window);
    return new Date(Math.min(window, grantCreatedAt.getTime() + settings.refreshTokenMaxAgeDays * DAY_MS));
  }

  /** A fresh token: its id (so a row can reference it before it is inserted), the secret and its hash. */
  private mintToken(prefix: string): { id: string; raw: string; hash: string; displayPrefix: string } {
    const raw = `${prefix}${randomBytes(32).toString('base64url')}`;
    return { id: randomUUID(), raw, hash: sha256(raw), displayPrefix: raw.slice(prefix.length, prefix.length + 8) };
  }

  private tokenRow(
    token: { id: string; hash: string; displayPrefix: string },
    kind: 'access' | 'refresh',
    grantId: string,
    scopes: string[],
    expiresAt: Date,
    createdAt: Date,
  ) {
    return { id: token.id, kind, tokenHash: token.hash, tokenPrefix: token.displayPrefix, grantId, scopes, expiresAt, createdAt };
  }

  private response(access: string, accessExpiresAt: Date, now: Date, refresh: string | undefined, scopes: string[]): OAuthTokenResponse {
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: Math.max(1, Math.round((accessExpiresAt.getTime() - now.getTime()) / 1000)),
      ...(refresh ? { refresh_token: refresh } : {}),
      scope: scopes.join(' '),
    };
  }

  /** `resource` of a token request equals the authorization request's, compared after normalisation. */
  private sameResource(sent: string, stored: string): boolean {
    if (sent === stored) return true;
    try {
      const a = new URL(sent);
      const b = new URL(stored);
      return a.origin === b.origin && a.pathname.replace(/\/+$/, '') === b.pathname.replace(/\/+$/, '') && a.search === b.search;
    } catch {
      return false;
    }
  }

  private invalidGrant(why: string) {
    // `why` is for the server log only; the client gets one answer for every reason.
    this.logger.debug(`oauth token: invalid_grant (${why})`);
    return oauthError('invalid_grant', 'The authorization grant is invalid, expired or revoked.');
  }

  /** Reuse of a code or a rotated refresh token: the grant and every token of it are revoked. */
  private async reuse(grant: IdentityOAuthGrantRow, kind: 'authorization_code' | 'refresh_token'): Promise<void> {
    const ref: OAuthGrantRef = { id: grant.id, userId: grant.userId, orgId: grant.orgId, clientId: grant.clientId, resource: grant.resource };
    await this.grants.revokeGrant(ref, 'reuse_detected', {
      audit: { action: OAUTH_AUDIT_ACTIONS.TOKEN_REUSE_DETECTED, actorUserId: null, meta: { clientId: grant.clientId, kind } },
    });
    this.logger.warn(`oauth token: reuse detected (${kind}), grant ${grant.id} revoked`);
  }

  // ---- POST /revoke ----------------------------------------------------------------------------

  /**
   * RFC 7009. Revoking a refresh token revokes its grant; revoking an access
   * token revokes that token. Unknown tokens are not an error (the caller always
   * answers `200`); only a client that fails authentication is.
   *
   * @param body - the parsed form.
   * @param authorization - the `Authorization` header, if any.
   * @throws OAuthProtocolError `invalid_client` or `temporarily_unavailable`.
   */
  async revoke(body: OAuthFormBody, authorization: string | undefined): Promise<void> {
    const client = await this.authenticate(body, authorization, 'revoke');
    const presented = body.token;
    if (!presented) throw oauthError('invalid_request', 'The token is required.');

    const token = await this.prisma.oAuthToken.findUnique<TokenWithGrant>({
      where: { tokenHash: sha256(presented) },
      include: { grant: true },
    });
    // Only the client the token was issued to may revoke it; anything else is silently ignored.
    if (!token || token.grant.clientId !== client.id) return;

    if (token.kind === 'refresh') {
      const grant = token.grant;
      await this.grants.revokeGrant({ id: grant.id, userId: grant.userId, orgId: grant.orgId, clientId: grant.clientId, resource: grant.resource }, 'user', {
        audit: { action: OAUTH_AUDIT_ACTIONS.GRANT_REVOKE, actorUserId: null, meta: { clientId: grant.clientId, by: 'client' } },
      });
    } else {
      await this.prisma.oAuthToken.updateMany({ where: { id: token.id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
  }
}

/** Thrown inside a transaction to roll it back when a code was consumed concurrently. */
class CodeRaceSignal extends Error {}

/** Thrown inside a transaction to roll it back when a refresh token was rotated concurrently. */
class RotationRaceSignal extends Error {}
