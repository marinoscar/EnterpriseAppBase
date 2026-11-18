// =============================================================================
// `oauth.token.cleanup`: the OAuth server's token housekeeping, as a queue job
// (PP-15.8, #1186; epic #1178, Amendment 1: hourly)
// =============================================================================
//
// The authorization server writes a row for every authorization request, code
// and token. Nothing in the request path removes them, so this job does, in
// the order that keeps every reference valid:
//
//   1. authorization requests that expired or were decided,
//   2. authorization codes that were consumed or expired, older than 1 hour,
//   3. access tokens that expired more than 24 hours ago,
//   4. refresh tokens that expired, or were rotated, more than 7 days ago,
//   5. the tokens of grants revoked more than 30 days ago (the grant row stays,
//      it is the audit trail of "who connected what"),
//   6. grants revoked more than 90 days ago (their remaining rows cascade).
//
// Every delete is BATCHED (select ids, delete by id, repeat): one hourly run
// never holds a long lock on `oauth_tokens`, which sits on the authentication
// path. A run is bounded (`MAX_BATCHES` per table); what it leaves, the next
// hour takes.
//
// SERVER-ONLY by derivation: no `nodeResultSchema` and no `persistNodeResult`
// (a worker node has no database access and the job is a handful of indexed
// deletes). No profile: the deployment default is right. Retries are safe: a
// row deleted twice is a row deleted once. Global (`orgId: null`): the OAuth
// tables carry no row-level security.
//
// The type string is permanent once jobs of it exist.
// =============================================================================

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { PLATFORM_PRISMA } from '../../core/index';
import type { IdentityPrisma } from '../data/identity-db';
import { IDENTITY_JOBS, type IdentityJobHandler, type IdentityJobRecord as Job, type IdentityJobsPort } from '../ports';

/**
 * The job type of every OAuth token-cleanup row. Dotted, lowercase, PERMANENT.
 *
 * @stability stable
 */
export const OAUTH_TOKEN_CLEANUP_TYPE = 'oauth.token.cleanup';

/**
 * The retention thresholds, in milliseconds. Exported so the tests, the Doctor
 * check `oauth.token_cleanup` and the documentation name one set of numbers.
 *
 * @stability experimental
 */
export const OAUTH_TOKEN_RETENTION = Object.freeze({
  /** Authorization codes are kept this long after creation (consumed or expired ones). */
  codeMs: 60 * 60_000,
  /** Access tokens are kept this long after they expired. */
  accessTokenMs: 24 * 60 * 60_000,
  /** Refresh tokens are kept this long after they expired or were rotated. */
  refreshTokenMs: 7 * 24 * 60 * 60_000,
  /** The tokens of a revoked grant are kept this long after the revocation. */
  revokedGrantTokensMs: 30 * 24 * 60 * 60_000,
  /** A revoked grant row is kept this long after the revocation (the audit trail). */
  revokedGrantMs: 90 * 24 * 60 * 60_000,
});

/** Rows per delete. */
const BATCH_SIZE = 500;
/** Batches per table per run, so one run is bounded. */
const MAX_BATCHES = 200;

/**
 * What one run removed, per table.
 *
 * @stability experimental
 */
export interface OAuthTokenCleanupResult {
  /** `oauth_authorization_requests`. */
  readonly requests: number;
  /** `oauth_authorization_codes`. */
  readonly codes: number;
  /** Access tokens. */
  readonly accessTokens: number;
  /** Refresh tokens. */
  readonly refreshTokens: number;
  /** Tokens of long-revoked grants. */
  readonly revokedGrantTokens: number;
  /** Long-revoked grants. */
  readonly grants: number;
}

/** The delegate surface a batched delete needs. */
interface BatchTable {
  findMany(args: { where: unknown; select: { id: true }; take: number }): Promise<Array<{ id: string }>>;
  deleteMany(args: { where: { id: { in: string[] } } }): Promise<{ count: number }>;
}

/**
 * Deletes the rows of `table` matching `where`, in batches.
 *
 * @param table - a Prisma delegate.
 * @param where - the filter.
 * @returns how many rows were deleted.
 */
async function deleteInBatches(table: BatchTable, where: unknown): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const rows = await table.findMany({ where, select: { id: true }, take: BATCH_SIZE });
    if (rows.length === 0) break;
    const { count } = await table.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
    total += count;
    if (rows.length < BATCH_SIZE) break;
  }
  return total;
}

/**
 * The cleanup. Registered with the queue on module init.
 *
 * @stability experimental
 */
@Injectable()
export class OAuthTokenCleanupHandler implements IdentityJobHandler, OnModuleInit {
  private readonly logger = new Logger(OAuthTokenCleanupHandler.name);

  readonly type = OAUTH_TOKEN_CLEANUP_TYPE;

  readonly label = 'OAuth token cleanup';

  constructor(
    @Inject(IDENTITY_JOBS) private readonly jobs: IdentityJobsPort,
    @Inject(PLATFORM_PRISMA) private readonly prisma: IdentityPrisma,
  ) {}

  /** Self-registration: the only wiring a handler needs. */
  onModuleInit(): void {
    this.jobs.registerHandler(this);
  }

  /** Runs the cleanup. Throws to fail (the queue retries). */
  async process(job: Job): Promise<void> {
    const result = await this.cleanup();
    this.logger.log(
      `OAuth token cleanup job ${job.id} removed ${result.requests} request(s), ${result.codes} code(s), ` +
        `${result.accessTokens} access token(s), ${result.refreshTokens} refresh token(s), ` +
        `${result.revokedGrantTokens} token(s) of revoked grants and ${result.grants} grant(s)`,
    );
  }

  /**
   * The deletes, in an order that keeps every reference valid.
   *
   * @param now - the clock (a test seam).
   * @returns what was removed.
   */
  async cleanup(now: Date = new Date()): Promise<OAuthTokenCleanupResult> {
    const before = (ms: number) => new Date(now.getTime() - ms);
    const db = this.prisma;

    const requests = await deleteInBatches(db.oAuthAuthorizationRequest as unknown as BatchTable, {
      OR: [{ expiresAt: { lt: now } }, { status: { in: ['approved', 'denied', 'expired'] } }],
    });
    const codes = await deleteInBatches(db.oAuthAuthorizationCode as unknown as BatchTable, {
      createdAt: { lt: before(OAUTH_TOKEN_RETENTION.codeMs) },
      OR: [{ consumedAt: { not: null } }, { expiresAt: { lt: now } }],
    });
    const accessTokens = await deleteInBatches(db.oAuthToken as unknown as BatchTable, {
      kind: 'access',
      expiresAt: { lt: before(OAUTH_TOKEN_RETENTION.accessTokenMs) },
    });
    const refreshTokens = await deleteInBatches(db.oAuthToken as unknown as BatchTable, {
      kind: 'refresh',
      OR: [{ expiresAt: { lt: before(OAUTH_TOKEN_RETENTION.refreshTokenMs) } }, { rotatedAt: { lt: before(OAUTH_TOKEN_RETENTION.refreshTokenMs) } }],
    });
    const revokedGrantTokens = await deleteInBatches(db.oAuthToken as unknown as BatchTable, {
      grant: { revokedAt: { lt: before(OAUTH_TOKEN_RETENTION.revokedGrantTokensMs) } },
    });
    const grants = await deleteInBatches(db.oAuthGrant as unknown as BatchTable, {
      revokedAt: { lt: before(OAUTH_TOKEN_RETENTION.revokedGrantMs) },
    });
    return { requests, codes, accessTokens, refreshTokens, revokedGrantTokens, grants };
  }
}
