// =============================================================================
// Pre-registered clients: the admin API's service (PP-15.5)
// =============================================================================
//
// List, pre-register, change, disable and delete OAuth clients, and rotate a
// secret. Every write is audited AFTER it commits (`oauth:client.*`); the audit
// rows carry the actor, the client's row id and closed values, never a secret.
// A secret is returned ONCE (create, rotate) and stored hashed.
//
// Disabling revokes the client's active grants with reason `client_disabled`
// (the reason `admin` is reserved), so its tokens fail on the next call.
// =============================================================================

import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type {
  OAuthClientPatchRequest,
  OAuthClientCreateRequest,
  OAuthClientView,
  OAuthClientWithSecret,
  OAuthClientsQuery,
  OAuthPolicy,
  OAuthRefusedHost,
} from '@marinoscar/platform-contract/identity';

import { PLATFORM_PRISMA } from '../../../core/index';
import type { IdentityOAuthClientRow, IdentityOAuthGrantRow, IdentityPrisma } from '../../data/identity-db';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS, type ResolvedIdentityModuleOptions } from '../../identity.options';
import { IDENTITY_METRICS, NOOP_IDENTITY_METRICS, type IdentityMetrics } from '../../ports';
import { OAUTH_AUDIT_ACTIONS, OAUTH_CLIENT_AUDIT_TARGET_TYPE, OAuthGrantService } from '../oauth-grant.service';
import { registeredRedirectUris } from '../redirect-uri';
import { sharedRedirectHost, validateRedirectUris } from './client-redirects';
import { hashClientSecret, newClientId, newClientSecret } from './client-secret';

/** The window of the refused-hosts list. */
export const REFUSED_HOSTS_WINDOW_MS = 30 * 24 * 60 * 60_000;
/** Most hosts the refused-hosts list returns. */
export const REFUSED_HOSTS_MAX = 100;
/** Most audit rows one refused-hosts read scans (one row per host per hour at most). */
const REFUSED_ROWS_SCAN_MAX = 20_000;

type ClientWithCount = IdentityOAuthClientRow & { _count: { grants: number } };

/** `native` when a registered client uses a custom scheme or a loopback URI. */
function applicationTypeOf(uris: readonly string[]): 'web' | 'native' {
  return uris.some((uri) => !/^https:/i.test(uri)) ? 'native' : 'web';
}

/**
 * The admin side of OAuth clients.
 *
 * @stability experimental
 */
@Injectable()
export class OAuthClientsAdminService {
  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: IdentityPrisma,
    private readonly grants: OAuthGrantService,
    @Optional() @Inject(IDENTITY_METRICS) private readonly metrics: IdentityMetrics = NOOP_IDENTITY_METRICS,
    @Optional() @Inject(IDENTITY_OPTIONS) private readonly options: ResolvedIdentityModuleOptions = DEFAULT_IDENTITY_OPTIONS,
  ) {}

  /**
   * The hosts the trust policy refused in the last 30 days, from the
   * `oauth:client.refused` audit rows (target id = host), newest first.
   *
   * @param now - the clock, for tests.
   * @returns at most 100 hosts with their row count and latest time.
   */
  async listRefusedHosts(now: number = Date.now()): Promise<OAuthRefusedHost[]> {
    const rows = await this.prisma.auditEvent.findMany<{ targetId: string; createdAt: Date }>({
      where: {
        action: OAUTH_AUDIT_ACTIONS.CLIENT_REFUSED,
        targetType: OAUTH_CLIENT_AUDIT_TARGET_TYPE,
        createdAt: { gte: new Date(now - REFUSED_HOSTS_WINDOW_MS) },
      },
      select: { targetId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: REFUSED_ROWS_SCAN_MAX,
    });
    const byHost = new Map<string, OAuthRefusedHost>();
    for (const row of rows) {
      const entry = byHost.get(row.targetId);
      if (entry) entry.count += 1;
      else byHost.set(row.targetId, { host: row.targetId, count: 1, lastSeenAt: row.createdAt.toISOString() });
    }
    // Rows arrive newest first, so the map is already ordered by latest refusal.
    return [...byHost.values()].slice(0, REFUSED_HOSTS_MAX);
  }

  /**
   * What the app configured for the admin page: the suggested client hosts.
   *
   * @returns the policy hints.
   */
  getPolicy(): OAuthPolicy {
    return { suggestedHosts: [...(this.options.oauthServer?.defaultAllowedClientHosts ?? [])] };
  }

  /**
   * A page of clients, newest first.
   *
   * @param query - the page, kind and search.
   */
  async list(query: OAuthClientsQuery) {
    const { page, pageSize, kind, search } = query;
    const where: Record<string, unknown> = {};
    if (kind) where.kind = kind;
    if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { host: { contains: search, mode: 'insensitive' } }];
    const [rows, total] = await Promise.all([
      this.prisma.oAuthClient.findMany<ClientWithCount>({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        include: { _count: { select: { grants: { where: { revokedAt: null } } } } },
      }),
      this.prisma.oAuthClient.count({ where }),
    ]);
    return { items: rows.map((row) => this.view(row, row._count.grants)), total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /**
   * Pre-registers a client.
   *
   * @param dto - name, redirect URIs, auth method.
   * @param actorUserId - the administrator.
   * @returns the client and, for a confidential one, its secret (once).
   * @throws BadRequestException for a redirect URI rule violation.
   */
  async create(dto: OAuthClientCreateRequest, actorUserId: string): Promise<OAuthClientWithSecret> {
    const applicationType = applicationTypeOf(dto.redirectUris);
    const host = this.checkRedirects(dto.redirectUris, applicationType);
    const secret = dto.tokenEndpointAuthMethod === 'none' ? undefined : newClientSecret();
    const row = await this.prisma.oAuthClient.create<IdentityOAuthClientRow>({
      data: {
        clientId: newClientId(),
        kind: 'registered',
        name: dto.name,
        redirectUris: dto.redirectUris,
        tokenEndpointAuthMethod: dto.tokenEndpointAuthMethod,
        applicationType,
        host,
        createdByUserId: actorUserId,
        ...(secret ? { secretHash: hashClientSecret(secret) } : {}),
      },
    });
    await this.audit(OAUTH_AUDIT_ACTIONS.CLIENT_CREATE, actorUserId, row.id, { kind: 'registered', method: dto.tokenEndpointAuthMethod });
    this.metrics.add('oauthClientRegistrations', 1, { kind: 'registered' });
    return { ...this.view(row, 0), ...(secret ? { clientSecret: secret } : {}) };
  }

  /**
   * Changes a client: `disabled`, and name and redirect URIs for the `registered` kind.
   *
   * @param id - the row id.
   * @param dto - the change.
   * @param actorUserId - the administrator.
   * @throws NotFoundException for an unknown id; BadRequestException for a field this kind does not allow.
   */
  async update(id: string, dto: OAuthClientPatchRequest, actorUserId: string): Promise<OAuthClientView> {
    const row = await this.prisma.oAuthClient.findUnique<IdentityOAuthClientRow>({ where: { id } });
    if (!row) throw new NotFoundException('Client not found');
    const editsDetails = dto.name !== undefined || dto.redirectUris !== undefined;
    if (editsDetails && row.kind !== 'registered') throw new BadRequestException('Only the name and redirect URIs of a pre-registered client can be changed.');

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.redirectUris !== undefined) {
      const applicationType = applicationTypeOf(dto.redirectUris);
      data.host = this.checkRedirects(dto.redirectUris, applicationType);
      data.redirectUris = dto.redirectUris;
      data.applicationType = applicationType;
    }
    let disabling = false;
    let enabling = false;
    if (dto.disabled === true && row.disabledAt === null) {
      data.disabledAt = new Date();
      disabling = true;
    } else if (dto.disabled === false && row.disabledAt !== null) {
      data.disabledAt = null;
      enabling = true;
    }
    const updated = Object.keys(data).length === 0 ? row : await this.prisma.oAuthClient.update<IdentityOAuthClientRow>({ where: { id }, data });

    if (disabling) await this.revokeGrantsOf(id);
    if (editsDetails) await this.audit(OAUTH_AUDIT_ACTIONS.CLIENT_UPDATE, actorUserId, id, { fields: [dto.name !== undefined ? 'name' : null, dto.redirectUris !== undefined ? 'redirectUris' : null].filter(Boolean).join(',') });
    if (disabling) await this.audit(OAUTH_AUDIT_ACTIONS.CLIENT_DISABLE, actorUserId, id, {});
    if (enabling) await this.audit(OAUTH_AUDIT_ACTIONS.CLIENT_ENABLE, actorUserId, id, {});
    return this.withCount(updated);
  }

  /**
   * Issues a new secret for a confidential client.
   *
   * @param id - the row id.
   * @param actorUserId - the administrator.
   * @returns the client and the new secret (once).
   * @throws NotFoundException for an unknown id; BadRequestException for a public client.
   */
  async rotateSecret(id: string, actorUserId: string): Promise<OAuthClientWithSecret> {
    const row = await this.prisma.oAuthClient.findUnique<IdentityOAuthClientRow>({ where: { id } });
    if (!row) throw new NotFoundException('Client not found');
    if (row.tokenEndpointAuthMethod === 'none') throw new BadRequestException('A public client has no secret to rotate.');
    const secret = newClientSecret();
    const updated = await this.prisma.oAuthClient.update<IdentityOAuthClientRow>({ where: { id }, data: { secretHash: hashClientSecret(secret) } });
    await this.audit(OAUTH_AUDIT_ACTIONS.CLIENT_ROTATE_SECRET, actorUserId, id, {});
    return { ...(await this.withCount(updated)), clientSecret: secret };
  }

  /**
   * Deletes a client; its grants, codes, tokens and pending requests cascade.
   *
   * @param id - the row id.
   * @param actorUserId - the administrator.
   * @throws NotFoundException for an unknown id.
   */
  async remove(id: string, actorUserId: string): Promise<void> {
    const row = await this.prisma.oAuthClient.findUnique<IdentityOAuthClientRow>({ where: { id } });
    if (!row) throw new NotFoundException('Client not found');
    const { count } = await this.prisma.oAuthClient.deleteMany({ where: { id } });
    if (count === 0) throw new NotFoundException('Client not found');
    await this.audit(OAUTH_AUDIT_ACTIONS.CLIENT_DELETE, actorUserId, id, { kind: row.kind });
  }

  // ---- helpers ------------------------------------------------------------------------------

  private checkRedirects(uris: readonly string[], applicationType: 'web' | 'native'): string {
    const problem = validateRedirectUris(uris, applicationType);
    if (problem) throw new BadRequestException(problem.message);
    const host = sharedRedirectHost(uris);
    if (host === null) throw new BadRequestException('Every non-loopback redirect URI must be on the same host.');
    return host;
  }

  private async revokeGrantsOf(clientRowId: string): Promise<void> {
    const active = await this.prisma.oAuthGrant.findMany<IdentityOAuthGrantRow>({ where: { clientId: clientRowId, revokedAt: null } });
    for (const grant of active) {
      await this.grants.revokeGrant(
        { id: grant.id, userId: grant.userId, orgId: grant.orgId, clientId: grant.clientId, resource: grant.resource },
        'client_disabled',
      );
    }
  }

  private async withCount(row: IdentityOAuthClientRow): Promise<OAuthClientView> {
    const count = await this.prisma.oAuthGrant.count({ where: { clientId: row.id, revokedAt: null } });
    return this.view(row, count);
  }

  private view(row: IdentityOAuthClientRow, activeGrantCount: number): OAuthClientView {
    return {
      id: row.id,
      clientId: row.clientId,
      kind: row.kind,
      name: row.name,
      host: row.host,
      redirectUris: registeredRedirectUris(row.redirectUris),
      tokenEndpointAuthMethod: row.tokenEndpointAuthMethod as OAuthClientView['tokenEndpointAuthMethod'],
      activeGrantCount,
      lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
      disabledAt: row.disabledAt ? row.disabledAt.toISOString() : null,
      disabled: row.disabledAt !== null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private audit(action: string, actorUserId: string, targetId: string, meta: Record<string, string | number | boolean | null>): Promise<void> {
    return this.grants.audit({ action, actorUserId, targetId, targetType: OAUTH_CLIENT_AUDIT_TARGET_TYPE, meta });
  }
}
