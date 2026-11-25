// =============================================================================
// OAuthTokenResolver: from a raw `oat_` string to a narrowed user (PP-15.3)
// =============================================================================
//
// Modelled on `PatService.resolveToken`. It answers "is this string a live
// access token, and for whom"; it makes NO decision about routes (the guard
// did that before calling it: route confinement needs no I/O and must precede
// every lookup, see `JwtAuthGuard`).
//
// EVERY refusal reason returns the same `null`: unknown, revoked, expired,
// grant revoked, client disabled, user inactive, membership lost, a grant whose
// resource is no longer registered. The caller answers one message, so the
// response is no oracle for which of them held.
// =============================================================================

import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

import { PLATFORM_PRISMA } from '../../core/index';
import { Inject } from '@nestjs/common';
import type { IdentityPrisma } from '../ports';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { PRINCIPAL_USER_INCLUDE } from '../auth/principal.factory';
import { hasActiveMembership, stampCredential, stampOAuthNarrowing } from '../auth/credential-binding';
import { currentTenancyMode } from '../auth/tenancy-mode';
import { oauthResourceRegistry, type OAuthProtectedResourceDefinition } from './oauth-resource.registry';
import { availableScopes, permissionsOfScopes } from './oauth-scope.registry';

/**
 * `last_used_at` is written at most this often per token, in milliseconds.
 *
 * @stability experimental
 */
export const OAUTH_LAST_USED_INTERVAL_MS = 60_000;

/** Most tokens the in-memory last-used map remembers before it sweeps expired entries. */
const LAST_USED_MAP_SWEEP_AT = 5000;

/**
 * What the resolver returns for a live token.
 *
 * @stability experimental
 */
export interface ResolvedOAuthToken {
  /** The user graph bound to the grant's org, carrying the scope narrowing (non-enumerable). */
  user: AuthenticatedUser;
  /** The `oauth_tokens.id`. */
  tokenId: string;
  /** The `oauth_grants.id`. */
  grantId: string;
  /** The `oauth_clients.id`. */
  clientId: string;
  /** The protected resource the grant was made for. */
  resource: OAuthProtectedResourceDefinition;
  /** The scope ids the token carries (those its grant still holds). */
  scopes: string[];
}

interface LoadedToken {
  id: string;
  kind: string;
  grantId: string;
  scopes: string[];
  expiresAt: Date;
  revokedAt: Date | null;
  grant: {
    id: string;
    orgId: string | null;
    clientId: string;
    resource: string;
    scopes: string[];
    revokedAt: Date | null;
    client: { id: string; disabledAt: Date | null };
    user: AuthenticatedUser;
  };
}

/**
 * The resource identifier (audience) of a registered resource: the deployment's
 * `APP_URL` origin plus the resource's path.
 *
 * @param appUrl - the application root (`appUrl` configuration), or `undefined`.
 * @param resource - the resource.
 * @returns the identifier, or `undefined` when no `APP_URL` is configured.
 *
 * @stability experimental
 */
export function oauthResourceIdentifier(appUrl: string | undefined, resource: Pick<OAuthProtectedResourceDefinition, 'path'>): string | undefined {
  if (!appUrl) return undefined;
  return `${appUrl.replace(/\/+$/, '')}${resource.path}`;
}

/**
 * Resolves an `oat_` access token. Exported for the reference app's wiring and
 * tests; reach it through the guard.
 *
 * @stability experimental
 */
@Injectable()
export class OAuthTokenResolver {
  private readonly lastUsed = new Map<string, number>();

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: IdentityPrisma,
    @Optional() private readonly config?: ConfigService,
  ) {}

  /**
   * @param rawToken - the full `oat_…` string.
   * @returns the narrowed user and the token's identity, or `null` for any
   *   token that is not live (one answer for every reason).
   */
  async resolve(rawToken: string): Promise<ResolvedOAuthToken | null> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const token = await this.prisma.oAuthToken.findUnique<LoadedToken>({
      where: { tokenHash },
      include: {
        grant: { include: { client: true, user: { include: PRINCIPAL_USER_INCLUDE } } },
      },
    });

    if (!token || token.kind !== 'access') return null;
    if (token.revokedAt !== null || token.expiresAt.getTime() <= Date.now()) return null;
    const { grant } = token;
    if (grant.revokedAt !== null) return null;
    if (grant.client.disabledAt !== null) return null;
    if (!grant.user.isActive) return null;

    // The org binding, the rule a PAT applies: a bound org must still be an
    // ACTIVE membership; an unbound grant (pre-org row) only in single mode.
    const orgId = grant.orgId ?? null;
    if (orgId !== null ? !hasActiveMembership(grant.user, orgId) : currentTenancyMode() !== 'single') return null;

    // The resource the grant was made for must still be registered.
    const appUrl = this.config?.get<string>('appUrl');
    const resource = oauthResourceRegistry.list().find((candidate) => oauthResourceIdentifier(appUrl, candidate) === grant.resource);
    if (!resource) return null;

    // The token's scopes, limited to what its grant still holds.
    const held = new Set(grant.scopes);
    // A scope that is unavailable now confers nothing (the grant keeps it, so it returns with the predicate).
    const scopes = await availableScopes(
      token.scopes.filter((scope) => held.has(scope)),
      { userId: grant.user.id, orgId },
    );

    const user = stampCredential(grant.user, { activeOrgId: orgId ?? undefined, tokenKind: 'oauth' });
    stampOAuthNarrowing(user, {
      permissions: permissionsOfScopes(scopes),
      info: { clientId: grant.clientId, grantId: grant.id, resourceId: resource.id, scopes },
    });

    this.touch(token.id, grant.id);

    return { user, tokenId: token.id, grantId: grant.id, clientId: grant.clientId, resource, scopes };
  }

  /** Stamps `last_used_at` on the token and its grant: at most once a minute per token, never awaited. */
  private touch(tokenId: string, grantId: string): void {
    const now = Date.now();
    const previous = this.lastUsed.get(tokenId);
    if (previous !== undefined && now - previous < OAUTH_LAST_USED_INTERVAL_MS) return;
    if (this.lastUsed.size >= LAST_USED_MAP_SWEEP_AT) {
      for (const [id, at] of this.lastUsed) if (now - at >= OAUTH_LAST_USED_INTERVAL_MS) this.lastUsed.delete(id);
    }
    this.lastUsed.set(tokenId, now);
    const at = new Date(now);
    this.prisma.oAuthToken.update({ where: { id: tokenId }, data: { lastUsedAt: at } }).catch(() => {});
    this.prisma.oAuthGrant.update({ where: { id: grantId }, data: { lastUsedAt: at } }).catch(() => {});
  }
}
