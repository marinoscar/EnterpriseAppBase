// =============================================================================
// The authorization endpoint and the consent API (PP-15.4)
// =============================================================================
//
// `authorize` validates in the order of docs/specs/oauth-server.md §2.10: a bad
// client or redirect URI is an error PAGE and never a redirect to the client's
// own URI (that is how an open redirect starts); from the `response_type` check
// on, an error is a redirect to the (now trusted) redirect URI with `error`,
// `error_description`, `state` and `iss`.
//
// The consent API binds a request to the first user who opens it; another user
// gets `404`. `decide` runs ONE transaction: mark the request decided, upsert the
// active grant (union of scopes), insert the authorization code. Audit rows and
// the event follow the commit.
// =============================================================================

import { randomBytes, createHash } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import type {
  OAuthConsentRequest,
  OAuthDecisionRequest,
  OAuthDecisionResponse,
  OAuthErrorCode,
  OAuthErrorPageCode,
} from '@marinoscar/platform-contract/identity';

import { PLATFORM_PRISMA, type Principal } from '../../core/index';
import { Trace } from '../../otel-core/index';
import { IDENTITY_METRICS, NOOP_IDENTITY_METRICS, type IdentityMetrics } from '../ports';
import { PRINCIPAL_USER_INCLUDE, resolveEffectiveAccess } from '../auth/principal.factory';
import { currentTenancyMode } from '../auth/tenancy-mode';
import { isPrismaErrorCode, type IdentityOAuthAuthorizationRequestRow, type IdentityOAuthClientRow, type IdentityPrisma } from '../data/identity-db';
import { OAUTH_CLIENT_RESOLVER, type ClientResolver } from './client-resolver';
import {
  OAUTH_CODE_PREFIX,
  OAUTH_CODE_TTL_MS,
  OAUTH_PARAM_MAX_LENGTH,
  OAUTH_REQUEST_TTL_MS,
  OAUTH_SCOPES_MAX,
  OAUTH_STATE_MAX_LENGTH,
} from './oauth-server.constants';
import { OAUTH_AUDIT_ACTIONS, OAuthGrantService, type OAuthGrantRef } from './oauth-grant.service';
import { oauthScopeRegistry, OFFLINE_ACCESS_SCOPE, type OAuthScopeDefinition } from './oauth-scope.registry';
import type { OAuthProtectedResourceDefinition } from './oauth-resource.registry';
import { OAuthServerContext } from './oauth-server-context';
import { OAuthServerSettingsReader } from './oauth-server-settings.reader';
import { isWellFormedChallenge } from './pkce';
import { isLoopbackRedirectUri, matchesRedirectUri, redirectHostOf } from './redirect-uri';

/** A request row with its client. */
type RequestWithClient = IdentityOAuthAuthorizationRequestRow & { client: IdentityOAuthClientRow };

/** A query-string value: one string, or absent. Anything else (a repeated parameter) is invalid. */
function single(query: Record<string, unknown>, name: string): string | undefined | null {
  const value = query[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  return value;
}

/**
 * The authorize endpoint and the consent API.
 *
 * @stability experimental
 */
@Injectable()
export class OAuthAuthorizationService {
  private readonly logger = new Logger(OAuthAuthorizationService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: IdentityPrisma,
    @Inject(OAUTH_CLIENT_RESOLVER) private readonly clients: ClientResolver,
    private readonly settings: OAuthServerSettingsReader,
    private readonly context: OAuthServerContext,
    private readonly grants: OAuthGrantService,
    @Optional() @Inject(IDENTITY_METRICS) private readonly metrics: IdentityMetrics = NOOP_IDENTITY_METRICS,
  ) {}

  /** The URL of the web error page (shown to the person, never to a client). */
  errorPageUrl(code: OAuthErrorPageCode, host?: string): string {
    const base = `${this.context.appUrl()}/oauth/error?code=${code}`;
    // `client_not_allowed` names the host so an administrator knows what to allow; a host is a DNS name, never markup.
    return host ? `${base}&host=${encodeURIComponent(host)}` : base;
  }

  /**
   * Validates an authorization request (§2.10) and stores it.
   *
   * @param query - the parsed query string.
   * @returns the absolute URL to answer `302` with: the consent page, the web
   *   error page, or the client's redirect URI carrying an error.
   */
  @Trace('oauth.authorize')
  async authorize(query: Record<string, unknown>): Promise<string> {
    const location = await this.validateAuthorization(query);
    // A redirect to the consent page is a request taken; anything else is an error page or an error redirect.
    if (!location.startsWith(`${this.context.appUrl()}/oauth/consent?`)) this.metrics.add('oauthAuthorizations', 1, { outcome: 'error' });
    return location;
  }

  private async validateAuthorization(query: Record<string, unknown>): Promise<string> {
    // 1. The server is switched on. (A person is looking at this route: a page, not a 404.)
    if (!(await this.settings.isEnabled())) return this.errorPageUrl('server_disabled');

    // 2. The client. Never a redirect to `redirect_uri` for a bad client.
    const clientId = single(query, 'client_id');
    if (!clientId || clientId.length > OAUTH_PARAM_MAX_LENGTH) return this.errorPageUrl('unknown_client');
    const resolution = await this.clients.resolveForAuthorization(clientId);
    if (!resolution.ok) return this.errorPageUrl(resolution.code, resolution.host);
    const client = resolution.client;
    trace.getActiveSpan()?.setAttribute('oauth.client.kind', client.kind);

    // 3. The redirect URI. Never a redirect to it for a bad one.
    const redirectUri = single(query, 'redirect_uri');
    if (!redirectUri || redirectUri.length > OAUTH_PARAM_MAX_LENGTH || !matchesRedirectUri(client.redirectUris, redirectUri)) {
      return this.errorPageUrl('invalid_redirect_uri');
    }

    // From here the redirect URI is trusted: errors go to it, with `state` and `iss`.
    const rawState = single(query, 'state');
    const state = typeof rawState === 'string' ? rawState : undefined;
    const fail = (error: OAuthErrorCode, description: string, withState = true) =>
      this.errorRedirect(redirectUri, error, description, withState ? state : undefined);
    if (rawState === null || (state !== undefined && state.length > OAUTH_STATE_MAX_LENGTH)) {
      return fail('invalid_request', 'The state parameter is invalid.', false);
    }

    // 4. response_type
    if (single(query, 'response_type') !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported.');

    // 5. PKCE: S256 only.
    const challenge = single(query, 'code_challenge');
    const method = single(query, 'code_challenge_method');
    if (!challenge || method !== 'S256' || !isWellFormedChallenge(challenge)) {
      return fail('invalid_request', 'PKCE is required: send code_challenge and code_challenge_method=S256.');
    }

    // 6. The resource (RFC 8707): required, and a registered protected resource.
    const resourceParam = single(query, 'resource');
    const resource = resourceParam && resourceParam.length <= OAUTH_PARAM_MAX_LENGTH ? this.context.resourceForParameter(resourceParam) : undefined;
    if (!resource) return fail('invalid_target', 'The resource parameter must name a protected resource of this server.');
    trace.getActiveSpan()?.setAttribute('oauth.resource.id', resource.id);

    // 7. The scopes.
    const scopes = this.resolveScopes(single(query, 'scope'), resource);
    if (!scopes) return fail('invalid_scope', 'One or more requested scopes are not supported by this resource.');

    const now = Date.now();
    const created = await this.prisma.oAuthAuthorizationRequest.create({
      data: {
        clientId: client.id,
        redirectUri,
        scope: scopes.join(' '),
        state: state ?? null,
        resource: this.context.identifierOf(resource),
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
        status: 'pending',
        expiresAt: new Date(now + OAUTH_REQUEST_TTL_MS),
      },
      select: { id: true },
    });
    this.logger.log(`oauth authorize: request ${created.id} client ${client.id} resource ${resource.id}`);
    // Nothing but the opaque id goes into the URL.
    return `${this.context.appUrl()}/oauth/consent?request=${created.id}`;
  }

  /**
   * The scope ids a request asks for, or `null` when one is not registered or
   * not accepted by the resource. None requested: the resource's default scopes.
   */
  private resolveScopes(raw: string | undefined | null, resource: OAuthProtectedResourceDefinition): string[] | null {
    if (raw === null) return null;
    const requested = [...new Set((raw ?? '').split(/[ ]+/).filter((scope) => scope !== ''))];
    if (requested.length > OAUTH_SCOPES_MAX) return null;
    if (requested.length === 0) {
      const defaults = resource.scopes.filter((id) => oauthScopeRegistry.get(id)?.default === true);
      return defaults.length > 0 ? [...defaults] : null;
    }
    for (const scope of requested) {
      if (!oauthScopeRegistry.has(scope)) return null;
      if (scope !== OFFLINE_ACCESS_SCOPE && !resource.scopes.includes(scope)) return null;
    }
    return requested;
  }

  /** The client's redirect URI carrying an error, `state` (when sent) and `iss`. */
  private errorRedirect(redirectUri: string, error: OAuthErrorCode, description: string, state: string | undefined): string {
    return this.redirectWith(redirectUri, { error, error_description: description, ...(state !== undefined ? { state } : {}) });
  }

  /** Appends `params` and `iss` to the client's redirect URI, keeping any existing query. */
  private redirectWith(redirectUri: string, params: Record<string, string>): string {
    const url = new URL(redirectUri);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    url.searchParams.set('iss', this.context.issuer());
    return url.toString();
  }

  // ---- the consent API ---------------------------------------------------------------------

  /**
   * `GET /api/oauth/requests/:id`: what the consent page shows. Binds the
   * request to the caller on first read.
   *
   * @param id - the request id.
   * @param principal - the signed-in user (session credential).
   * @throws NotFoundException unknown, another user's, or the server is disabled.
   * @throws GoneException expired or already decided.
   */
  async readRequest(id: string, principal: Principal): Promise<OAuthConsentRequest> {
    await this.requireEnabled();
    const row = await this.loadAndBind(id, principal.userId);
    const resource = this.context.resourceForIdentifier(row.resource);
    if (!resource) throw new GoneException('This authorization request is no longer available');

    const permissions = new Set<string>(principal.permissions);
    const existing = await this.prisma.oAuthGrant.findFirst<{ scopes: string[] }>({
      where: { userId: principal.userId, clientId: row.clientId, resource: row.resource, revokedAt: null },
      select: { scopes: true },
    });
    const held = new Set(existing?.scopes ?? []);

    const requested = row.scope.split(' ').filter((scope) => scope !== '');
    const scopes = requested
      .filter((scope) => scope !== OFFLINE_ACCESS_SCOPE)
      .flatMap((scope) => {
        const def = oauthScopeRegistry.get(scope);
        if (!def) return [];
        const grantable = isGrantable(def, permissions);
        return [
          {
            id: def.id,
            title: def.title,
            description: def.description,
            risk: def.risk,
            grantable,
            required: grantable && def.default === true,
            alreadyGranted: held.has(def.id),
          },
        ];
      });

    return {
      id: row.id,
      client: {
        name: row.client.name,
        host: row.client.host,
        logoUri: row.client.logoUri,
        kind: row.client.kind,
        firstSeenAt: row.client.createdAt.toISOString(),
      },
      redirectHost: redirectHostOf(row.redirectUri),
      isLoopbackRedirect: isLoopbackRedirectUri(row.redirectUri),
      resource: { id: resource.id, name: resource.name },
      scopes,
      offlineAccess: requested.includes(OFFLINE_ACCESS_SCOPE),
      organizations: await this.organizationsOf(principal),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  /** The active memberships the grant may act in; empty in single mode. */
  private async organizationsOf(principal: Principal): Promise<OAuthConsentRequest['organizations']> {
    if (currentTenancyMode() !== 'multi') return [];
    const ids = (principal.memberships ?? []).filter((m) => (m.status ?? 'active') === 'active').map((m) => m.orgId);
    if (ids.length === 0) return [];
    const orgs = await this.prisma.organization.findMany<{ id: string; name: string }>({ where: { id: { in: ids } }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    return orgs.map((org) => ({ id: org.id, name: org.name, isCurrent: org.id === principal.activeOrgId }));
  }

  /**
   * `POST /api/oauth/requests/:id/decision`.
   *
   * @param id - the request id.
   * @param body - the decision.
   * @param principal - the signed-in user (session credential).
   * @returns where the page navigates next.
   * @throws NotFoundException unknown, another user's, or the server is disabled.
   * @throws GoneException expired or already decided.
   * @throws BadRequestException a scope outside the requested set, a missing required scope, or nothing grantable.
   * @throws ForbiddenException an `orgId` that is not an active membership of the caller.
   */
  @Trace('oauth.decision')
  async decide(id: string, body: OAuthDecisionRequest, principal: Principal): Promise<OAuthDecisionResponse> {
    await this.requireEnabled();
    const row = await this.loadAndBind(id, principal.userId);
    const resource = this.context.resourceForIdentifier(row.resource);
    if (!resource) throw new GoneException('This authorization request is no longer available');
    if (row.client.disabledAt !== null) throw new GoneException('This authorization request is no longer available');
    trace.getActiveSpan()?.setAttributes({ 'oauth.client.kind': row.client.kind, 'oauth.resource.id': resource.id });

    if (body.decision === 'deny') {
      const { count } = await this.prisma.oAuthAuthorizationRequest.updateMany({
        where: { id: row.id, status: 'pending', userId: principal.userId, expiresAt: { gt: new Date() } },
        data: { status: 'denied' },
      });
      if (count === 0) throw new GoneException('This authorization request has already been decided');
      await this.grants.audit({
        action: OAUTH_AUDIT_ACTIONS.CONSENT_DENY,
        actorUserId: principal.userId,
        targetId: row.id,
        meta: { clientId: row.clientId, resourceId: resource.id, requestId: row.id },
      });
      this.metrics.add('oauthAuthorizations', 1, { outcome: 'denied' });
      return { redirectTo: this.redirectWith(row.redirectUri, { error: 'access_denied', ...(row.state !== null ? { state: row.state } : {}) }) };
    }

    const requested = row.scope.split(' ').filter((scope) => scope !== '');
    const requestedTickable = requested.filter((scope) => scope !== OFFLINE_ACCESS_SCOPE);
    const offline = requested.includes(OFFLINE_ACCESS_SCOPE);

    // The ticked scopes must be a subset of what the client asked for.
    const ticked = body.scopes ? [...new Set(body.scopes.filter((scope) => scope !== OFFLINE_ACCESS_SCOPE))] : requestedTickable;
    if (ticked.some((scope) => !requestedTickable.includes(scope))) {
      throw new BadRequestException('A scope that was not requested cannot be granted');
    }

    // The organization the grant acts in: an ACTIVE membership of the caller.
    const orgId = body.orgId ?? principal.activeOrgId ?? null;
    if (orgId === null) {
      if (currentTenancyMode() === 'multi') throw new ForbiddenException('Choose an organization the grant may act in');
    } else if (!(principal.memberships ?? []).some((m) => m.orgId === orgId && (m.status ?? 'active') === 'active')) {
      throw new ForbiddenException('You are not an active member of that organization');
    }

    // What the user may grant IN THAT ORGANIZATION: a scope never grants a permission.
    const permissions = await this.permissionsIn(orgId, principal);
    const grantable = ticked.filter((scope) => {
      const def = oauthScopeRegistry.get(scope);
      return def !== undefined && isGrantable(def, permissions);
    });
    const required = requestedTickable.filter((scope) => {
      const def = oauthScopeRegistry.get(scope);
      return def !== undefined && def.default === true && isGrantable(def, permissions);
    });
    if (required.some((scope) => !grantable.includes(scope))) throw new BadRequestException('A required scope cannot be unticked');
    if (grantable.length === 0) throw new BadRequestException('None of the requested scopes can be granted');
    const granted = [...grantable, ...(offline ? [OFFLINE_ACCESS_SCOPE] : [])];

    const rawCode = `${OAUTH_CODE_PREFIX}${randomBytes(32).toString('base64url')}`;
    const codeHash = createHash('sha256').update(rawCode).digest('hex');
    const now = new Date();
    const resourceIdentifier = row.resource;

    let outcome: { grant: OAuthGrantRef; created: boolean } | undefined;
    for (let attempt = 0; attempt < 2 && !outcome; attempt += 1) {
      try {
        outcome = await this.prisma.$transaction(async (tx) => {
          const decided = await tx.oAuthAuthorizationRequest.updateMany({
            where: { id: row.id, status: 'pending', userId: principal.userId, expiresAt: { gt: now } },
            data: { status: 'approved' },
          });
          if (decided.count === 0) throw new GoneException('This authorization request has already been decided');

          // One ACTIVE grant per (user, client, resource): widen it, or create it.
          const existing = await tx.oAuthGrant.findFirst<{ id: string; scopes: string[] }>({
            where: { userId: principal.userId, clientId: row.clientId, resource: resourceIdentifier, revokedAt: null },
            select: { id: true, scopes: true },
          });
          const union = [...new Set([...(existing?.scopes ?? []), ...granted])];
          const grant = existing
            ? await tx.oAuthGrant.update({ where: { id: existing.id }, data: { scopes: union, orgId } })
            : await tx.oAuthGrant.create({ data: { userId: principal.userId, orgId, clientId: row.clientId, resource: resourceIdentifier, scopes: union } });

          await tx.oAuthAuthorizationCode.create({
            data: {
              codeHash,
              grantId: grant.id,
              redirectUri: row.redirectUri,
              codeChallenge: row.codeChallenge,
              scope: granted.join(' '),
              resource: resourceIdentifier,
              expiresAt: new Date(now.getTime() + OAUTH_CODE_TTL_MS),
            },
          });
          // The client was used to complete an authorization: a dynamic client is kept (PP-15.5 cleanup).
          await tx.oAuthClient.update({ where: { id: row.clientId }, data: { lastUsedAt: now } });
          return {
            grant: { id: grant.id, userId: principal.userId, orgId, clientId: row.clientId, resource: resourceIdentifier },
            created: existing === null,
          };
        });
      } catch (error) {
        // A concurrent approval created the active grant first (the partial unique index): retry once, now widening it.
        if (attempt === 0 && isPrismaErrorCode(error, 'P2002')) continue;
        throw error;
      }
    }
    if (!outcome) throw new GoneException('This authorization request could not be completed');

    // AFTER the commit: audit, then the event.
    await this.grants.audit({
      action: outcome.created ? OAUTH_AUDIT_ACTIONS.GRANT_CREATE : OAUTH_AUDIT_ACTIONS.GRANT_UPDATE,
      actorUserId: principal.userId,
      targetId: outcome.grant.id,
      orgId,
      meta: { clientId: row.clientId, resourceId: resource.id, scopes: granted.join(' ') },
    });
    this.grants.emitCreated(outcome.grant, outcome.created ? 'created' : 'updated');
    this.metrics.add('oauthAuthorizations', 1, { outcome: 'approved' });
    this.logger.log(`oauth consent: approved grant ${outcome.grant.id} client ${row.clientId}`);

    return { redirectTo: this.redirectWith(row.redirectUri, { code: rawCode, ...(row.state !== null ? { state: row.state } : {}) }) };
  }

  /** The permissions the caller holds in `orgId` (the session's own set when it is the active org). */
  private async permissionsIn(orgId: string | null, principal: Principal): Promise<Set<string>> {
    if (orgId === (principal.activeOrgId ?? null)) return new Set(principal.permissions);
    const user = await this.prisma.user.findUnique<{ userRoles: never[] }>({ where: { id: principal.userId }, include: PRINCIPAL_USER_INCLUDE });
    if (!user) return new Set();
    const access = resolveEffectiveAccess({ ...(user as object), activeOrgId: orgId } as Parameters<typeof resolveEffectiveAccess>[0], currentTenancyMode());
    return new Set(access.permissions);
  }

  private async requireEnabled(): Promise<void> {
    if (!(await this.settings.isEnabled())) throw new NotFoundException();
  }

  /**
   * Loads a request with its client and binds it to `userId`. `404` for an
   * unknown id or another user's request, `410` for an expired or decided one.
   */
  private async loadAndBind(id: string, userId: string): Promise<RequestWithClient> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new NotFoundException();
    const row = await this.prisma.oAuthAuthorizationRequest.findUnique<RequestWithClient>({
      where: { id },
      include: { client: true },
    });
    if (!row || (row.userId !== null && row.userId !== userId)) throw new NotFoundException();
    if (row.status !== 'pending' || row.expiresAt.getTime() <= Date.now()) throw new GoneException('This authorization request has expired or was already decided');
    if (row.userId === null) {
      // First touch binds; a concurrent first touch by another user loses.
      const { count } = await this.prisma.oAuthAuthorizationRequest.updateMany({
        where: { id, OR: [{ userId: null }, { userId }] },
        data: { userId },
      });
      if (count === 0) throw new NotFoundException();
    }
    return row;
  }
}

/** A scope is grantable when it names no permission, or the user holds at least one of them. */
function isGrantable(def: OAuthScopeDefinition, permissions: ReadonlySet<string>): boolean {
  return def.permissions.length === 0 || def.permissions.some((permission) => permissions.has(permission));
}

