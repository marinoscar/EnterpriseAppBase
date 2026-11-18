// =============================================================================
// `oauth.client.cleanup` — unused dynamic clients, as a queue job (PP-15.5)
// =============================================================================
//
// Hosted clients register on every connection, so a deployment accumulates
// dynamic clients nobody ever finished an authorization with. This job deletes a
// `dynamic` client that has NO grant (active or revoked) and was not used to
// complete an authorization (and did not appear) within `dynamicClientUnusedDays`.
// It never touches a `cimd` or `registered` client.
//
// SERVER-ONLY by derivation: no `nodeResultSchema` and no `persistNodeResult`
// (it is one `deleteMany`, and a worker node has no database access). No profile:
// the deployment default is right for one indexed delete. Retries are safe: a
// row deleted twice is a row deleted once.
//
// The type string is permanent once jobs of it exist.
// =============================================================================

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { PLATFORM_PRISMA } from '../../../core/index';
import type { IdentityPrisma } from '../../data/identity-db';
import { IDENTITY_JOBS, type IdentityJobHandler, type IdentityJobRecord as Job, type IdentityJobsPort } from '../../ports';
import { OAuthServerSettingsReader } from '../oauth-server-settings.reader';

/**
 * The job type of every client-cleanup row. Dotted, lowercase, PERMANENT.
 *
 * @stability stable
 */
export const OAUTH_CLIENT_CLEANUP_TYPE = 'oauth.client.cleanup';

/** One day in milliseconds. */
const DAY_MS = 24 * 60 * 60_000;

@Injectable()
export class OAuthClientCleanupHandler implements IdentityJobHandler, OnModuleInit {
  private readonly logger = new Logger(OAuthClientCleanupHandler.name);

  readonly type = OAUTH_CLIENT_CLEANUP_TYPE;

  readonly label = 'OAuth client cleanup';

  constructor(
    @Inject(IDENTITY_JOBS) private readonly jobs: IdentityJobsPort,
    @Inject(PLATFORM_PRISMA) private readonly prisma: IdentityPrisma,
    private readonly settings: OAuthServerSettingsReader,
  ) {}

  /** Self-registration: the only wiring a handler needs. */
  onModuleInit(): void {
    this.jobs.registerHandler(this);
  }

  /**
   * Deletes dynamic clients with no grant and no use for `dynamicClientUnusedDays`.
   * Throws to fail (the queue retries).
   */
  async process(job: Job): Promise<void> {
    const { dynamicClientUnusedDays } = await this.settings.read();
    const cutoff = new Date(Date.now() - dynamicClientUnusedDays * DAY_MS);
    const { count } = await this.prisma.oAuthClient.deleteMany({
      where: {
        kind: 'dynamic',
        createdAt: { lt: cutoff },
        grants: { none: {} },
        OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: cutoff } }],
      },
    });
    this.logger.log(`OAuth client cleanup job ${job.id} removed ${count} unused dynamic client(s)`);
  }
}
