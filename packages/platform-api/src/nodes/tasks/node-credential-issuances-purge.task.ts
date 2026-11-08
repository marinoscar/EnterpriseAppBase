// =============================================================================
// The nightly enqueue of `nodes.credential_issuances_purge` (#1083)
// =============================================================================
//
// Decides only whether the purge is due and enqueues it (queue rule 1): the
// work is the handler's. `enqueueHousekeepingJob` keeps one pending or running
// purge at a time.
// =============================================================================

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PLATFORM_PRISMA } from '../../core/index';
import { enqueueHousekeepingJob, JobsService, type JobsPrisma } from '../../jobs/index';
import { NODE_CREDENTIAL_ISSUANCES_PURGE_TYPE } from '../handlers/node-credential-issuances-purge.handler';
import { NODES_OPTIONS, type ResolvedNodesModuleOptions } from '../nodes.options';

/**
 * Enqueues the credential-delivery audit purge daily (04:00).
 *
 * @stability experimental
 */
@Injectable()
export class NodeCredentialIssuancesPurgeTask {
  private readonly logger = new Logger(NodeCredentialIssuancesPurgeTask.name);

  constructor(
    private readonly jobs: JobsService,
    @Inject(PLATFORM_PRISMA) private readonly prisma: JobsPrisma,
    @Optional() @Inject(NODES_OPTIONS) private readonly options?: ResolvedNodesModuleOptions
  ) {}

  /** Enqueues the purge unless one is already pending or running. */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async handleCron(): Promise<void> {
    if (this.options?.tasks.credentialIssuancesPurge === false) {
      this.logger.debug('The node credential issuances purge is disabled (NodesModule.forRoot tasks.credentialIssuancesPurge); skipping');

      return;
    }

    await enqueueHousekeepingJob({
      jobs: this.jobs,
      prisma: this.prisma,
      logger: this.logger,
      type: NODE_CREDENTIAL_ISSUANCES_PURGE_TYPE,
      what: 'node credential issuances purge',
    });
  }
}
