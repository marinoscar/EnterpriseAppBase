// =============================================================================
// LinkGrantsService: link shares as a grant kind (issue #730, PP-7.3)
// =============================================================================
//
// A link grant shares ONE record with anyone holding its token, with one of
// the roles the resource type lists under `grantable.link` (links are off for
// a type that lists none), an expiry and soft revocation like every grant.
//
// MINTING (`POST /api/grants/links`). The caller passes the type's
// `share_link` action when it declares one (MemoriaHub lets a collaborator
// create links), `share` otherwise. The token (`lnk_` + 32 random bytes) is
// returned ONCE in the response body; the row stores only its SHA-256 hash
// (the lookup key) and its ciphertext under the cipher domain
// `sharing.link:<grantId>`, the id chosen before the insert so the domain
// binds the row. Without `SECRETS_ENCRYPTION_KEY` creation fails closed with
// 503: a token is never stored in clear.
//
// RESOLUTION (`resolve`, used by `LinkGrantGuard`). The token arrives in the
// `X-Link-Token` header only. The ONE cross-organization read of the slice
// looks up `link_token_hash` on the system bypass client (reason
// `link-resolution`: one row, by a unique hash); everything after it runs in
// the grant's organization scope: the type's `loadOwners` confirms the
// record still exists there.
//
// `withLinkScope(link, fn)` then runs an app's reads in ONE transaction
// scoped to the link's organization with NO user id, so row-level security
// still confines them to that organization even when the app forgets its
// own `where`.
//
// Resolutions are counted (`app.sharing.link_resolutions`), never audited:
// a public link can be opened thousands of times a day, and the audit trail
// records who CHANGED access, not every read. Creation, update and
// revocation are audited (`grant:link:create|update|revoke`).
// =============================================================================

import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  buildLinkUrl,
  LINK_TOKEN_PREFIX,
  type GrantListQuery,
  type IssuedLinkGrant,
  type LinkGrantCreate,
  type LinkGrantList,
  type LinkGrantView,
} from '@marinoscar/platform-contract/sharing';

import { assertEncryptionKeyConfigured, decryptSecret, encryptSecret, type Principal } from '../../core/index';
import { Trace } from '../../otel-core/index';
import { AccessPolicy } from '../access/access-policy.service';
import { findResourceType, type ResolvedResourceType } from '../access/resource-types';
import { asSharingTx, type GrantRow, type SharingTx } from '../data/sharing-tx';
import { SHARING_ERROR_REASONS, conflict, expiryInPast, linksUnavailable, resourceNotFound, roleNotGrantable } from '../errors';
import { SHARING_EVENTS, type GrantEventPayload } from '../events';
import { iso, paged, requireActiveOrg } from '../groups/group-common';
import { SharingEffects } from '../groups/sharing-effects';
import type { SharingLinkResolutionOutcome } from '../metrics';
import { SHARING_DATA, type SharingDataPort } from '../ports';
import { SHARING_OPTIONS, type ResolvedSharingModuleOptions } from '../sharing.options';
import { hashLinkToken, isLinkToken, linkTokenPurpose, mintLinkToken } from './link-token';

/**
 * Optional injection token of the link service's clock (ms since epoch).
 *
 * @stability experimental
 */
export const LINK_GRANTS_CLOCK: unique symbol = Symbol.for('@marinoscar/platform/sharing/LINK_GRANTS_CLOCK');

/** One day, in milliseconds. */
const DAY_MS = 86_400_000;

/**
 * The resource type a guarded route accepts any link for: the platform's own
 * resolution route (`GET /api/public/links/current`). An app route always
 * names its type.
 *
 * @stability experimental
 */
export const ANY_LINK_RESOURCE_TYPE = '*';

/**
 * A link grant that resolved: what an app's public route works with. It never
 * carries the token, its hash or its ciphertext.
 *
 * @stability experimental
 */
export interface ResolvedLinkGrant {
  /** The grant. */
  readonly grantId: string;
  /** The record's organization: the scope of {@link LinkGrantsService.withLinkScope}. */
  readonly orgId: string;
  /** The record's resource type. */
  readonly resourceType: string;
  /** The record. */
  readonly resourceId: string;
  /** The role the link grants. */
  readonly role: string;
  /** When the link stops working, or `null`. */
  readonly expiresAt: Date | null;
}

/**
 * Why a resolution failed: for the log line and the counter, NEVER for the
 * response, which is the same 404 for every one of them.
 *
 * @stability experimental
 */
export type LinkResolutionFailure =
  | 'missing'
  | 'malformed'
  | 'unknown'
  | 'revoked'
  | 'expired'
  | 'wrong_type'
  | 'links_off'
  | 'insufficient_role'
  | 'resource_gone';

/** The counter outcome of each failure. */
const FAILURE_OUTCOME: Readonly<Record<LinkResolutionFailure, SharingLinkResolutionOutcome>> = Object.freeze({
  missing: 'not_found',
  malformed: 'not_found',
  unknown: 'not_found',
  revoked: 'revoked',
  expired: 'expired',
  wrong_type: 'wrong_type',
  links_off: 'not_found',
  insufficient_role: 'not_found',
  resource_gone: 'not_found',
});

/**
 * The `outcome` label of a failure.
 *
 * @param failure - why it failed.
 * @returns the counter's outcome.
 *
 * @stability experimental
 */
export function linkFailureOutcome(failure: LinkResolutionFailure): SharingLinkResolutionOutcome {
  return FAILURE_OUTCOME[failure];
}

/**
 * The result of {@link LinkGrantsService.resolve}.
 *
 * @stability experimental
 */
export type LinkResolution =
  | { readonly ok: true; readonly link: ResolvedLinkGrant }
  | {
      readonly ok: false;
      readonly failure: LinkResolutionFailure;
      /** The grant's resource type when a grant was found, else `null`. */
      readonly resourceType: string | null;
    };

/**
 * What a guarded route accepts.
 *
 * @stability experimental
 */
export interface LinkResolutionExpectation {
  /** The route's resource type, or {@link ANY_LINK_RESOURCE_TYPE}. */
  readonly resourceType: string;
  /** The action the route performs (`read`); its minimum role must be at most the link's. Absent: no action check. */
  readonly action?: string;
}

/**
 * The action that manages a type's links: `share_link` when the type declares
 * it (MemoriaHub lets a collaborator create links), `share` otherwise.
 *
 * @param rt - the resolved type.
 * @returns the action name.
 */
export function linkShareAction(rt: ResolvedResourceType): 'share' | 'share_link' {
  return rt.required('share_link') !== undefined ? 'share_link' : 'share';
}

/**
 * A link's expiry from the request, defaulted and capped by the `links`
 * options: absent means `defaultTtlDays` (on creation; `undefined` is kept
 * on an update), `null` means none; a date must be in the future; the result
 * never lies beyond `maxTtlDays` from now (a later or absent expiry is
 * brought back to it).
 *
 * @param value - the request's `expiresAt`.
 * @param links - the resolved link options.
 * @param now - the current time, ms since epoch.
 * @param mode - `create` (absent: the default lifetime) or `update` (absent: unchanged).
 * @returns the expiry, `null` for none, `undefined` for unchanged.
 * @throws BadRequestException 400 `EXPIRY_IN_PAST`.
 *
 * @stability experimental
 */
export function resolveLinkExpiry(
  value: string | null | undefined,
  links: Pick<ResolvedSharingModuleOptions['links'], 'maxTtlDays' | 'defaultTtlDays'>,
  now: number,
  mode: 'create' | 'update',
): Date | null | undefined {
  let at: Date | null;
  if (value === undefined) {
    if (mode === 'update') return undefined;
    at = links.defaultTtlDays === null ? null : new Date(now + links.defaultTtlDays * DAY_MS);
  } else if (value === null) {
    at = null;
  } else {
    at = new Date(value);
    if (!(at.getTime() > now)) throw expiryInPast();
  }
  if (links.maxTtlDays !== null) {
    const max = now + links.maxTtlDays * DAY_MS;
    if (at === null || at.getTime() > max) at = new Date(max);
  }
  return at;
}

/**
 * The share URL of a stored link grant, re-derived from its ciphertext, or
 * `null` when it cannot be shown (revoked, or the key changed).
 *
 * @param row - the link grant row.
 * @param appUrl - the public origin, or `undefined` for a root-relative URL.
 * @returns the URL or `null`.
 */
function storedLinkUrl(row: GrantRow, appUrl: string | undefined): string | null {
  if (row.revokedAt || !row.linkTokenCiphertext) return null;
  try {
    return buildLinkUrl(appUrl ?? '', decryptSecret(row.linkTokenCiphertext, linkTokenPurpose(row.id)));
  } catch {
    return null;
  }
}

/**
 * One link grant as its record's sharer sees it.
 *
 * @param row - the link grant row.
 * @param appUrl - the public origin.
 * @returns the wire shape; `url` re-derived (or `null`).
 *
 * @stability experimental
 */
export function toLinkGrantView(row: GrantRow, appUrl: string | undefined): LinkGrantView {
  return {
    id: row.id,
    orgId: row.orgId,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    role: row.role,
    label: row.linkLabel,
    url: storedLinkUrl(row, appUrl),
    expiresAt: iso(row.expiresAt),
    revokedAt: iso(row.revokedAt),
    grantedById: row.grantedById,
    createdAt: iso(row.createdAt)!,
  };
}

/**
 * An existing clear-text link token to import as a link grant (a data
 * migration from an app's own share table).
 *
 * @stability experimental
 */
export interface LegacyLinkImport {
  /** The record's organization. */
  orgId: string;
  /** A registered resource type that lists `role` under `grantable.link`. */
  resourceType: string;
  /** The record. */
  resourceId: string;
  /** The role the link grants. */
  role: string;
  /**
   * The existing token: 43 base64url characters (`randomBytes(32).toString('base64url')`,
   * MemoriaHub's format), or an already-prefixed `lnk_` token.
   */
  token: string;
  /** Who created it, or `null`. */
  grantedById?: string | null;
  /** When it stops working, or `null`. */
  expiresAt?: Date | null;
  /** When it was revoked, or `null`. */
  revokedAt?: Date | null;
  /** The owner's label, or `null`. */
  label?: string | null;
  /** When it was created (kept from the old row). */
  createdAt?: Date;
}

/**
 * Imports an existing clear-text share token as a link grant: hashes and
 * encrypts it exactly as a minted one, inside the caller's transaction. FOR
 * DATA MIGRATIONS ONLY (never a request path), and it needs
 * `SECRETS_ENCRYPTION_KEY`.
 *
 * MIGRATION RECIPE (MemoriaHub's `MediaShare`, #765). An old link is
 * `/s/<token>`, with the token in the PATH. The imported token is
 * `lnk_<token>`, so:
 *
 * 1. In the migration, call `importLegacyToken` once per `MediaShare` row,
 *    with its organization, resource type and id, `role: 'viewer'`, the old
 *    `token`, and its `expiresAt`, `revokedAt`, `createdById` (as
 *    `grantedById`) and `createdAt`; then drop the clear column.
 * 2. Optionally keep a web redirect from `/s/:token` to `/s#lnk_:token`, so
 *    links already handed out keep working. The FIRST request of an old link
 *    still carries the token in its path, so it is logged once (nginx
 *    `$request`, the server span's `url.path`); revoke and re-share a link
 *    that must never have been logged.
 *
 * @param tx - the migration's transaction client (the system bypass, or scoped to `input.orgId`).
 * @param input - the record, the role and the old token.
 * @returns the new grant's id and the token as it is now stored (`lnk_...`).
 * @throws Error when the token is not 43 base64url characters (or a well-formed `lnk_` token),
 *   or when `SECRETS_ENCRYPTION_KEY` is not configured.
 *
 * @example
 * ```ts
 * await prisma.runAsSystem('migration-tooling', async (tx) => {
 *   for (const share of shares) await importLegacyToken(tx, { orgId, resourceType: 'album', resourceId: share.albumId, role: 'viewer', token: share.token });
 * });
 * ```
 *
 * @stability experimental
 */
export async function importLegacyToken(tx: unknown, input: LegacyLinkImport): Promise<{ grantId: string; token: string }> {
  const token = input.token.startsWith(LINK_TOKEN_PREFIX) ? input.token : `${LINK_TOKEN_PREFIX}${input.token}`;
  if (!isLinkToken(token)) throw new Error('importLegacyToken: the token must be 43 base64url characters (32 random bytes), optionally prefixed with lnk_.');
  assertEncryptionKeyConfigured();
  const grantId = randomUUID();
  await asSharingTx(tx).grant.create({
    data: {
      id: grantId,
      orgId: input.orgId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      granteeKind: 'link',
      role: input.role,
      linkTokenHash: hashLinkToken(token),
      linkTokenCiphertext: encryptSecret(token, linkTokenPurpose(grantId)),
      linkLabel: input.label ?? null,
      expiresAt: input.expiresAt ?? null,
      revokedAt: input.revokedAt ?? null,
      grantedById: input.grantedById ?? null,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
    select: { id: true },
  });
  return { grantId, token };
}

/**
 * Mints, lists and resolves link grants, and runs an app's public reads in a
 * link's organization scope. Update and revocation go through the generic
 * `PATCH` / `DELETE /api/grants/:id` (`GrantsService`).
 *
 * @stability experimental
 */
@Injectable()
export class LinkGrantsService {
  constructor(
    @Inject(SHARING_DATA) private readonly data: SharingDataPort,
    private readonly policy: AccessPolicy,
    private readonly effects: SharingEffects,
    @Inject(SHARING_OPTIONS) private readonly options: ResolvedSharingModuleOptions,
    @Optional() @Inject(LINK_GRANTS_CLOCK) private readonly now: () => number = Date.now,
  ) {}

  private appUrl(): string | undefined {
    const value = this.options.links.appUrl();
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private registered(type: string): ResolvedResourceType {
    const rt = findResourceType(type);
    if (!rt) throw resourceNotFound();
    return rt;
  }

  /**
   * `POST /api/grants/links`: mints a link to one record, or with
   * `reuseActive` returns the caller's active link with the same role.
   *
   * @param principal - the caller (`sharing:write`).
   * @param input - the record, the role, the expiry, the label.
   * @returns the link, its URL and its token (the only time the token is returned).
   * @throws ServiceUnavailableException 503 `LINKS_UNAVAILABLE` without `SECRETS_ENCRYPTION_KEY`.
   * @throws NotFoundException 404 when the caller may not share the record (or the type is unknown).
   * @throws UnprocessableEntityException 422 `ROLE_NOT_GRANTABLE` (also for a type with no link roles).
   * @throws ConflictException 409 `LINK_LIMIT_REACHED` or `GRANT_LIMIT_REACHED`.
   * @throws BadRequestException 400 `EXPIRY_IN_PAST`.
   */
  @Trace('sharing.link.create')
  async create(principal: Principal, input: LinkGrantCreate): Promise<IssuedLinkGrant> {
    try {
      assertEncryptionKeyConfigured();
    } catch {
      throw linksUnavailable();
    }
    const orgId = requireActiveOrg(principal);
    const rt = this.registered(input.resourceType);
    const now = this.now();
    const expiresAt = resolveLinkExpiry(input.expiresAt, this.options.links, now, 'create') as Date | null;
    const ref = { type: rt.type, id: input.resourceId };
    const appUrl = this.appUrl();

    const outcome = await this.data.runInOrg({ orgId, userId: principal.userId }, async (raw) => {
      const tx = asSharingTx(raw);
      await this.policy.requireIn(raw, principal, linkShareAction(rt), ref);
      const grantable = rt.grantable('link');
      const role = input.role ?? grantable[0];
      if (role === undefined || !grantable.includes(role)) throw roleNotGrantable(input.role ?? rt.roles[0]!, 'link', grantable);

      const activeLinks = {
        orgId,
        resourceType: rt.type,
        resourceId: ref.id,
        granteeKind: 'link',
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(now) } }],
      };
      if (input.reuseActive) {
        const existing = await tx.grant.findFirst<GrantRow>({
          where: { ...activeLinks, role, grantedById: principal.userId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        const token = existing?.linkTokenCiphertext ? this.decryptOrNull(existing) : null;
        if (existing && token) return { row: existing, token, created: false };
      }

      if ((await tx.grant.count({ where: activeLinks })) >= this.options.links.maxActivePerResource) {
        throw conflict(SHARING_ERROR_REASONS.LINK_LIMIT_REACHED, 'This record has reached its limit of active links. Revoke one first.');
      }
      if ((await tx.grant.count({ where: { resourceType: rt.type, resourceId: ref.id, revokedAt: null } })) >= rt.maxGrantsPerResource) {
        throw conflict(SHARING_ERROR_REASONS.GRANT_LIMIT_REACHED, 'This record has reached its share limit');
      }

      // The id first, so the cipher domain binds THIS row.
      const id = randomUUID();
      const token = mintLinkToken();
      const row = await tx.grant.create<GrantRow>({
        data: {
          id,
          orgId,
          resourceType: rt.type,
          resourceId: ref.id,
          granteeKind: 'link',
          role,
          linkTokenHash: hashLinkToken(token),
          linkTokenCiphertext: encryptSecret(token, linkTokenPurpose(id)),
          linkLabel: input.label ?? null,
          expiresAt,
          grantedById: principal.userId,
        },
      });
      await writeLinkAudit(tx, { orgId, actorUserId: principal.userId, action: 'grant:link:create', row, previousRole: null });
      return { row, token, created: true };
    });

    if (outcome.created) {
      this.effects.grantCommitted([{ name: SHARING_EVENTS.GRANT_CREATED, payload: linkEventPayload(outcome.row, null, principal.userId) }]);
    }
    const url = buildLinkUrl(appUrl ?? '', outcome.token);
    return { grant: { ...toLinkGrantView(outcome.row, appUrl), url }, url, token: outcome.token };
  }

  private decryptOrNull(row: GrantRow): string | null {
    try {
      return decryptSecret(row.linkTokenCiphertext!, linkTokenPurpose(row.id));
    } catch {
      return null;
    }
  }

  /**
   * `GET /api/grants/links?resourceType&resourceId`: the record's links that
   * are not revoked (expired ones included, so the sharer sees them), newest
   * first, each with its re-derived URL.
   *
   * @param principal - the caller (`sharing:read`).
   * @param query - the record and the page.
   * @returns a page of links.
   * @throws NotFoundException 404 when the caller may not manage the record's links.
   */
  @Trace('sharing.link.list')
  async list(principal: Principal, query: GrantListQuery): Promise<LinkGrantList> {
    const orgId = requireActiveOrg(principal);
    const rt = this.registered(query.resourceType);
    const appUrl = this.appUrl();
    return this.data.runInOrg({ orgId, userId: principal.userId }, async (raw) => {
      const tx = asSharingTx(raw);
      await this.policy.requireIn(raw, principal, linkShareAction(rt), { type: rt.type, id: query.resourceId });
      const where = { orgId, resourceType: rt.type, resourceId: query.resourceId, granteeKind: 'link', revokedAt: null };
      const total = await tx.grant.count({ where });
      const rows = await tx.grant.findMany<GrantRow>({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      return paged(rows.map((row) => toLinkGrantView(row, appUrl)), total, query.page, query.pageSize);
    });
  }

  /**
   * Resolves a token for a route. Never throws for a bad token: the caller
   * (`LinkGrantGuard`) turns every failure into the same 404. The token is
   * hashed and looked up on the system bypass client (one row, by its unique
   * hash); the record check runs in the grant's organization.
   *
   * @param token - the `X-Link-Token` value (anything).
   * @param expect - the route's resource type and action.
   * @returns the resolved link, or why it failed.
   * @throws Error when `expect.action` is not an action of the grant's type (a programming error).
   */
  async resolve(token: unknown, expect: LinkResolutionExpectation): Promise<LinkResolution> {
    if (token === undefined || token === null || token === '') return { ok: false, failure: 'missing', resourceType: null };
    if (!isLinkToken(token)) return { ok: false, failure: 'malformed', resourceType: null };
    const hash = hashLinkToken(token);
    const row = await this.data.runAsSystem('link-resolution', (raw) =>
      asSharingTx(raw).grant.findUnique<Pick<GrantRow, 'id' | 'orgId' | 'resourceType' | 'resourceId' | 'granteeKind' | 'role' | 'expiresAt' | 'revokedAt'>>({
        where: { linkTokenHash: hash },
        select: { id: true, orgId: true, resourceType: true, resourceId: true, granteeKind: true, role: true, expiresAt: true, revokedAt: true },
      }),
    );
    if (!row || row.granteeKind !== 'link') return { ok: false, failure: 'unknown', resourceType: null };
    const type = row.resourceType;
    if (row.revokedAt) return { ok: false, failure: 'revoked', resourceType: type };
    if (row.expiresAt && row.expiresAt.getTime() <= this.now()) return { ok: false, failure: 'expired', resourceType: type };
    if (expect.resourceType !== ANY_LINK_RESOURCE_TYPE && expect.resourceType !== type) return { ok: false, failure: 'wrong_type', resourceType: type };
    const rt = findResourceType(type);
    // A type no longer registered, or no longer granting this role to links: links are off.
    if (!rt || !rt.grantable('link').includes(row.role)) return { ok: false, failure: 'links_off', resourceType: type };
    if (expect.action !== undefined) {
      const required = rt.required(expect.action);
      if (required === undefined) {
        throw new Error(`Resource type "${type}" declares no action "${expect.action}" (declared: ${Object.keys(rt.def.actions).join(', ')}).`);
      }
      if (rt.rank(required) > rt.rank(row.role)) return { ok: false, failure: 'insufficient_role', resourceType: type };
    }
    const owners = await this.data.runInOrg({ orgId: row.orgId }, (raw) => rt.def.loadOwners([row.resourceId], raw));
    if (owners.get(row.resourceId)?.orgId !== row.orgId) return { ok: false, failure: 'resource_gone', resourceType: type };
    return {
      ok: true,
      link: Object.freeze({
        grantId: row.id,
        orgId: row.orgId,
        resourceType: type,
        resourceId: row.resourceId,
        role: row.role,
        expiresAt: row.expiresAt,
      }),
    };
  }

  /**
   * Runs `fn` in ONE transaction scoped to the link's organization, with no
   * user id: row-level security confines every query of `fn` to that
   * organization; the app's own `where` limits it to the one record.
   *
   * FILE BYTES ARE NEVER STREAMED WITH THE TOKEN. An `<img src>` cannot send
   * the `X-Link-Token` header, so a public route returns PRESIGNED download
   * URLs minted by the app's storage provider (`StorageProvider` of the
   * reference app) instead of proxying the bytes; the presigned URL is short
   * lived and carries no link token.
   *
   * @param link - the resolved link (`@CurrentLinkGrant()`).
   * @param fn - the app's reads, given the app's transaction client.
   * @returns what `fn` returns.
   *
   * @example
   * ```ts
   * return this.links.withLinkScope(link, (tx) =>
   *   (tx as Prisma.TransactionClient).mediaItem.findUnique({ where: { id: link.resourceId } }),
   * );
   * ```
   *
   * @extensionPoint hook
   * @stability experimental
   */
  withLinkScope<R>(link: ResolvedLinkGrant, fn: (tx: unknown) => Promise<R>): Promise<R> {
    return this.data.runInOrg({ orgId: link.orgId }, fn);
  }

  /**
   * The record's title (the type's `describe()`), read in the link's scope.
   *
   * @param link - the resolved link.
   * @returns the title, or `null` when the type describes nothing.
   */
  async titleOf(link: ResolvedLinkGrant): Promise<string | null> {
    const rt = findResourceType(link.resourceType);
    if (!rt?.def.describe) return null;
    const describe = rt.def.describe.bind(rt.def);
    return this.withLinkScope(link, async (tx) => (await describe([link.resourceId], tx)).get(link.resourceId)?.title ?? null);
  }

  /**
   * {@link importLegacyToken} as a method, for a migration that injects the service.
   *
   * @param tx - the migration's transaction client.
   * @param input - the record, the role and the old token.
   * @returns the new grant's id and its stored token.
   */
  importLegacyToken(tx: unknown, input: LegacyLinkImport): Promise<{ grantId: string; token: string }> {
    return importLegacyToken(tx, input);
  }
}

/** The audit actions of link grants. */
export type LinkAuditAction = 'grant:link:create' | 'grant:link:update' | 'grant:link:revoke';

/**
 * Writes one link audit row INSIDE the caller's transaction: ids, the role
 * and the expiry only, never the token, its hash, its ciphertext or the label.
 */
export async function writeLinkAudit(
  tx: SharingTx,
  input: { orgId: string; actorUserId: string; action: LinkAuditAction; row: GrantRow; previousRole: string | null },
): Promise<void> {
  const { row } = input;
  await tx.auditEvent.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: 'grant',
      targetId: row.id,
      orgId: input.orgId,
      meta: {
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        granteeKind: 'link',
        granteeId: null,
        role: row.role,
        previousRole: input.previousRole,
        expiresAt: iso(row.expiresAt),
      },
    },
  });
}

/** The event payload of a link grant: ids and roles only. */
export function linkEventPayload(row: GrantRow, previousRole: string | null, actorUserId: string): GrantEventPayload {
  return {
    orgId: row.orgId,
    grantId: row.id,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    granteeKind: 'link',
    granteeId: null,
    role: row.role,
    previousRole,
    actorUserId,
  };
}
