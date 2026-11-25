// =============================================================================
// Refused client hosts as audit rows (PP-15.5, epic #1178 Amendment 1)
// =============================================================================
//
// A client the trust policy turns away leaves ONE audit row, `oauth:client.refused`,
// with the host as its target and the closed refusal reason as its meta, at most
// one per host per hour. No extra table: the admin page (PP-15.7) lists refused
// hosts from these rows and offers "Allow this host". Nothing a client sent is
// stored beyond the host.
// =============================================================================

import { Inject, Injectable, Logger } from '@nestjs/common';

import { PLATFORM_PRISMA } from '../../../core/index';
import type { IdentityPrisma } from '../../data/identity-db';
import { OAUTH_AUDIT_ACTIONS, OAUTH_CLIENT_AUDIT_TARGET_TYPE, OAuthGrantService } from '../oauth-grant.service';
import type { TrustRefusalReason } from './client-trust.policy';

/** One hour, the throttle of a host's refusal rows. */
export const CLIENT_REFUSAL_WINDOW_MS = 60 * 60_000;

/** Most hosts remembered in memory. */
const MEMORY_MAX = 5_000;

/**
 * Records that a host was refused, throttled to one row per host per hour.
 *
 * @stability experimental
 */
@Injectable()
export class ClientRefusalRecorder {
  private readonly logger = new Logger(ClientRefusalRecorder.name);
  private readonly recent = new Map<string, number>();

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: IdentityPrisma,
    private readonly grants: OAuthGrantService,
  ) {}

  /**
   * Writes the refusal row unless one exists for `host` in the last hour.
   * Never throws: a failure is logged.
   *
   * @param host - the refused host (lower-case).
   * @param reason - the closed refusal reason.
   * @param at - the clock, for tests.
   * @returns whether a row was written.
   */
  async record(host: string, reason: TrustRefusalReason, at: number = Date.now()): Promise<boolean> {
    try {
      const last = this.recent.get(host);
      if (last !== undefined && at - last < CLIENT_REFUSAL_WINDOW_MS) return false;
      if (this.recent.size >= MEMORY_MAX) {
        for (const [key, when] of this.recent) if (at - when >= CLIENT_REFUSAL_WINDOW_MS) this.recent.delete(key);
      }
      // Claim the slot before the awaits: a concurrent refusal of the same host sees it.
      this.recent.set(host, at);
      const existing = await this.prisma.auditEvent.findFirst({
        where: {
          action: OAUTH_AUDIT_ACTIONS.CLIENT_REFUSED,
          targetType: OAUTH_CLIENT_AUDIT_TARGET_TYPE,
          targetId: host,
          createdAt: { gte: new Date(at - CLIENT_REFUSAL_WINDOW_MS) },
        },
        select: { id: true },
      });
      if (existing) return false;
      await this.grants.audit({
        action: OAUTH_AUDIT_ACTIONS.CLIENT_REFUSED,
        actorUserId: null,
        targetId: host,
        targetType: OAUTH_CLIENT_AUDIT_TARGET_TYPE,
        meta: { reason },
      });
      return true;
    } catch (error) {
      this.logger.warn(`Could not record the refusal of a client host: ${error instanceof Error ? error.message : 'unknown error'}`);
      return false;
    }
  }
}
