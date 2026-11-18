// =============================================================================
// Grant revocation, audit rows and events of the authorization server (PP-15.4)
// =============================================================================
//
// ONE place revokes a grant, whoever asks (the user in Connected apps, the
// client at `/revoke`, reuse detection, an offboarded organization): the grant
// and every token of it die in one transaction. Audit rows and events are written
// AFTER that transaction committed, never inside it (the notifications rule:
// a rolled-back write must leave no trace, and a listener must never run
// inside a transaction).
//
// Audit rows and events carry ids and closed values: never a token, code, secret,
// verifier or scope text.
// =============================================================================

import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { OAuthAdminGrantView, OAuthAdminGrantsQuery, OAuthGrantRevokedReason, OAuthGrantView } from '@marinoscar/platform-contract/identity';

import { PLATFORM_PRISMA } from '../../core/index';
import { IDENTITY_EVENTS, emitIdentityEvent } from '../identity.events';
import type { IdentityOAuthClientRow, IdentityOAuthGrantRow, IdentityPrisma } from '../data/identity-db';
import { oauthScopeRegistry } from './oauth-scope.registry';
import { OAuthServerContext } from './oauth-server-context';

/**
 * The audit actions of the authorization server (docs/specs/oauth-server.md §2.21).
 *
 * @stability experimental
 */
export const OAUTH_AUDIT_ACTIONS: Readonly<{
  /** A user approved a client for the first time. */
  GRANT_CREATE: 'oauth:grant.create';
  /** A user approved again and widened an existing grant. */
  GRANT_UPDATE: 'oauth:grant.update';
  /** A grant was revoked by the user or by its client. */
  GRANT_REVOKE: 'oauth:grant.revoke';
  /** A user denied a pending request. */
  CONSENT_DENY: 'oauth:consent.deny';
  /** A code or a rotated refresh token was replayed: the grant was revoked. */
  TOKEN_REUSE_DETECTED: 'oauth:token.reuse_detected';
  /** An administrator pre-registered a client. */
  CLIENT_CREATE: 'oauth:client.create';
  /** An administrator changed a client's name or redirect URIs. */
  CLIENT_UPDATE: 'oauth:client.update';
  /** An administrator disabled a client. */
  CLIENT_DISABLE: 'oauth:client.disable';
  /** An administrator re-enabled a client. */
  CLIENT_ENABLE: 'oauth:client.enable';
  /** An administrator deleted a client. */
  CLIENT_DELETE: 'oauth:client.delete';
  /** An administrator rotated a client's secret. */
  CLIENT_ROTATE_SECRET: 'oauth:client.rotate_secret';
  /** A client of a host the trust policy does not allow tried to connect (at most one row per host per hour). */
  CLIENT_REFUSED: 'oauth:client.refused';
  /** An administrator changed the `oauthServer` settings (the meta names the fields, never a value that is a secret: there is none). */
  SETTINGS_UPDATE: 'oauth:settings.update';
}> = Object.freeze({
  GRANT_CREATE: 'oauth:grant.create',
  GRANT_UPDATE: 'oauth:grant.update',
  GRANT_REVOKE: 'oauth:grant.revoke',
  CONSENT_DENY: 'oauth:consent.deny',
  TOKEN_REUSE_DETECTED: 'oauth:token.reuse_detected',
  CLIENT_CREATE: 'oauth:client.create',
  CLIENT_UPDATE: 'oauth:client.update',
  CLIENT_DISABLE: 'oauth:client.disable',
  CLIENT_ENABLE: 'oauth:client.enable',
  CLIENT_DELETE: 'oauth:client.delete',
  CLIENT_ROTATE_SECRET: 'oauth:client.rotate_secret',
  CLIENT_REFUSED: 'oauth:client.refused',
  SETTINGS_UPDATE: 'oauth:settings.update',
} as const);

/**
 * The target type of the authorization server's audit rows.
 *
 * @stability experimental
 */
export const OAUTH_AUDIT_TARGET_TYPE = 'oauth_grant';

/**
 * The target type of the client audit rows (`oauth:client.*`): the target id is
 * the client's row id, or the refused host for `oauth:client.refused`.
 *
 * @stability experimental
 */
export const OAUTH_CLIENT_AUDIT_TARGET_TYPE = 'oauth_client';

/**
 * The part of a grant revocation needs.
 *
 * @stability experimental
 */
export interface OAuthGrantRef {
  /** The `oauth_grants.id`. */
  readonly id: string;
  /** The owner. */
  readonly userId: string;
  /** The organization the grant acts in, or `null`. */
  readonly orgId: string | null;
  /** The `oauth_clients.id`. */
  readonly clientId: string;
  /** The resource identifier (audience). */
  readonly resource: string;
}

/**
 * One audit row of the authorization server.
 *
 * @stability experimental
 */
export interface OAuthAuditEntry {
  /** One of {@link OAUTH_AUDIT_ACTIONS}. */
  action: string;
  /** Who acted; `null` when the client or the system did. */
  actorUserId: string | null;
  /** The grant (or, with `targetType: 'oauth_client'`, the client or host) the row is about. */
  targetId: string;
  /** The target type; default {@link OAUTH_AUDIT_TARGET_TYPE}. */
  targetType?: string;
  /** The organization, when known. */
  orgId?: string | null;
  /** Ids and closed values only. */
  meta: Record<string, string | number | boolean | null>;
}

/**
 * One page of the admin grant list.
 *
 * @stability experimental
 */
export interface OAuthAdminGrantViewPage {
  /** The grants of this page, newest first. */
  items: OAuthAdminGrantView[];
  /** All grants matching the filter. */
  total: number;
  /** The 1-based page. */
  page: number;
  /** The page size. */
  pageSize: number;
  /** The number of pages. */
  totalPages: number;
}

/**
 * Revokes grants and records what happened.
 *
 * @stability experimental
 */
@Injectable()
export class OAuthGrantService {
  private readonly logger = new Logger(OAuthGrantService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: IdentityPrisma,
    private readonly context: OAuthServerContext,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  /**
   * Revokes a grant and every token of it, in one transaction. Idempotent: an
   * already-revoked grant is left as it is and `false` is returned.
   *
   * @param grant - the grant.
   * @param reason - why.
   * @param options - `onlyUserId` restricts the revocation to the grant's owner (the Connected apps route);
   *   `audit` is the audit row written after the commit (none when omitted);
   *   `emit` emits `identity.oauth.grant.revoked` (default true).
   * @returns whether this call revoked it.
   */
  async revokeGrant(
    grant: OAuthGrantRef,
    reason: OAuthGrantRevokedReason,
    options: { onlyUserId?: string; audit?: Omit<OAuthAuditEntry, 'targetId' | 'orgId'>; emit?: boolean } = {},
  ): Promise<boolean> {
    const now = new Date();
    const revoked = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.oAuthGrant.updateMany({
        where: { id: grant.id, revokedAt: null, ...(options.onlyUserId ? { userId: options.onlyUserId } : {}) },
        data: { revokedAt: now, revokedReason: reason },
      });
      if (count === 0) return false;
      await tx.oAuthToken.updateMany({ where: { grantId: grant.id, revokedAt: null }, data: { revokedAt: now } });
      return true;
    });
    if (!revoked) return false;
    if (options.audit) await this.audit({ ...options.audit, targetId: grant.id, orgId: grant.orgId });
    if (options.emit !== false) this.emitRevoked(grant, reason);
    return true;
  }

  /**
   * The caller's active grants for the Connected apps page. Never a token.
   *
   * @param userId - the caller.
   */
  async listForUser(userId: string): Promise<OAuthGrantView[]> {
    type Row = IdentityOAuthGrantRow & { client: IdentityOAuthClientRow; org: { id: string; name: string } | null };
    const rows = await this.prisma.oAuthGrant.findMany<Row>({
      where: { userId, revokedAt: null },
      include: { client: true, org: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => {
      return {
        id: row.id,
        client: { name: row.client.name, host: row.client.host, logoUri: row.client.logoUri },
        resource: this.resourceView(row.resource),
        scopes: row.scopes
          .filter((scope) => oauthScopeRegistry.has(scope))
          .map((scope) => ({ id: scope, title: oauthScopeRegistry.get(scope)!.title })),
        organization: row.org ? { id: row.org.id, name: row.org.name } : null,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
      };
    });
  }

  /**
   * A page of grants for the admin API (`GET /api/admin/oauth/grants`): active ones unless
   * `includeRevoked`, newest first. Never a token.
   *
   * @param query - page, filters and the revoked flag.
   */
  async listForAdmin(query: OAuthAdminGrantsQuery): Promise<OAuthAdminGrantViewPage> {
    type Row = IdentityOAuthGrantRow & {
      client: IdentityOAuthClientRow;
      user: { id: string; email: string };
      org: { id: string; name: string } | null;
    };
    const { page, pageSize, clientId, userId, includeRevoked } = query;
    const where: Record<string, unknown> = {};
    if (clientId) where.clientId = clientId;
    if (userId) where.userId = userId;
    if (!includeRevoked) where.revokedAt = null;
    const [rows, total] = await Promise.all([
      this.prisma.oAuthGrant.findMany<Row>({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        include: { client: true, user: { select: { id: true, email: true } }, org: { select: { id: true, name: true } } },
      }),
      this.prisma.oAuthGrant.count({ where }),
    ]);
    const items = rows.map(
      (row): OAuthAdminGrantView => ({
        id: row.id,
        user: { id: row.user.id, email: row.user.email },
        client: { id: row.client.id, name: row.client.name, host: row.client.host },
        resource: this.resourceView(row.resource),
        scopes: [...row.scopes],
        organization: row.org ? { id: row.org.id, name: row.org.name } : null,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
        revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
        revokedReason: (row.revokedReason as OAuthAdminGrantView['revokedReason']) ?? null,
      }),
    );
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /**
   * Revokes one user's grant on an administrator's behalf: the grant and every token of it die at
   * once (`revoked_reason: admin`), `oauth:grant.revoke` is audited with the administrator as the actor
   * and `identity.oauth.grant.revoked` is emitted. Stable for apps that call it in process.
   * Idempotent: a grant that is already revoked is left as it is.
   *
   * @param grantId - the `oauth_grants.id`.
   * @param adminUserId - the administrator, recorded as the audit actor.
   * @returns whether this call revoked it (`false` when it already was).
   * @throws NotFoundException for an unknown id.
   */
  async revokeGrantAsAdmin(grantId: string, adminUserId: string): Promise<boolean> {
    const grant = await this.prisma.oAuthGrant.findUnique<IdentityOAuthGrantRow>({ where: { id: grantId } });
    if (!grant) throw new NotFoundException('Grant not found');
    return this.revokeGrant(
      { id: grant.id, userId: grant.userId, orgId: grant.orgId, clientId: grant.clientId, resource: grant.resource },
      'admin',
      { audit: { action: OAUTH_AUDIT_ACTIONS.GRANT_REVOKE, actorUserId: adminUserId, meta: { clientId: grant.clientId, userId: grant.userId, by: 'admin' } } },
    );
  }

  /**
   * Revokes one of the caller's grants (Connected apps, "Disconnect").
   *
   * @param userId - the caller.
   * @param grantId - the grant.
   * @throws NotFoundException for an id that is not the caller's active grant.
   */
  async revokeForUser(userId: string, grantId: string): Promise<void> {
    const grant = await this.prisma.oAuthGrant.findFirst<IdentityOAuthGrantRow>({ where: { id: grantId, userId, revokedAt: null } });
    if (!grant) throw new NotFoundException('Grant not found');
    const revoked = await this.revokeGrant(
      { id: grant.id, userId: grant.userId, orgId: grant.orgId, clientId: grant.clientId, resource: grant.resource },
      'user',
      { onlyUserId: userId, audit: { action: OAUTH_AUDIT_ACTIONS.GRANT_REVOKE, actorUserId: userId, meta: { clientId: grant.clientId, by: 'user' } } },
    );
    if (!revoked) throw new NotFoundException('Grant not found');
  }

  /**
   * Writes one audit row. A failure is logged and swallowed: the action it
   * records already committed, and must not turn into an error for the caller.
   *
   * @param entry - the row.
   */
  async audit(entry: OAuthAuditEntry): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          actorUserId: entry.actorUserId,
          action: entry.action,
          targetType: entry.targetType ?? OAUTH_AUDIT_TARGET_TYPE,
          targetId: entry.targetId,
          meta: entry.meta,
          ...(entry.orgId ? { orgId: entry.orgId } : {}),
        },
      });
    } catch (error) {
      this.logger.error(`Could not write the ${entry.action} audit row: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  /** Emits `identity.oauth.grant.created` (after the commit). */
  emitCreated(grant: OAuthGrantRef, reason: 'created' | 'updated'): void {
    emitIdentityEvent(this.events, this.logger, IDENTITY_EVENTS.OAUTH_GRANT_CREATED, this.payload(grant, reason));
  }

  /** Emits `identity.oauth.grant.revoked` (after the commit). */
  emitRevoked(grant: OAuthGrantRef, reason: string): void {
    emitIdentityEvent(this.events, this.logger, IDENTITY_EVENTS.OAUTH_GRANT_REVOKED, this.payload(grant, reason));
  }

  private payload(grant: OAuthGrantRef, reason: string) {
    return {
      userId: grant.userId,
      grantId: grant.id,
      clientId: grant.clientId,
      resourceId: this.resourceIdOf(grant.resource),
      reason,
    };
  }

  private resourceView(identifier: string): { id: string | null; name: string } {
    try {
      const def = this.context.resourceForIdentifier(identifier);
      return { id: def?.id ?? null, name: def?.name ?? identifier };
    } catch {
      return { id: null, name: identifier };
    }
  }

  private resourceIdOf(identifier: string): string | null {
    try {
      return this.context.resourceForIdentifier(identifier)?.id ?? null;
    } catch {
      return null;
    }
  }
}
