// =============================================================================
// `nodes.credential_issuances_purge`: retention of the delivery audit (#1083)
// =============================================================================
//
// Deletes `node_credential_issuances` rows issued before the retention cutoff
// (`NodesModule.forRoot({ credentialIssuancesRetentionDays })`, default 30).
// Enqueued nightly by `NodeCredentialIssuancesPurgeTask` through
// `enqueueHousekeepingJob`; server-only (no node members), like every purge.
// =============================================================================

import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';

import { PLATFORM_PRISMA } from '../../core/index';
import { type Job, JobHandler, JobHandlerRegistry, type JobsPrisma } from '../../jobs/index';
import { DEFAULT_CREDENTIAL_ISSUANCES_RETENTION_DAYS, NODES_OPTIONS, type ResolvedNodesModuleOptions } from '../nodes.options';

/**
 * The handler key, and therefore the `Job.type` every purge row carries.
 * PERMANENT: rows outlive handlers.
 *
 * @stability experimental
 */
export const NODE_CREDENTIAL_ISSUANCES_PURGE_TYPE = 'nodes.credential_issuances_purge';

/**
 * The `nodes.credential_issuances_purge` handler: deletes credential-delivery
 * audit rows older than the retention. Server-only.
 *
 * @stability experimental
 */
@Injectable()
export class NodeCredentialIssuancesPurgeHandler implements JobHandler, OnModuleInit {
  private readonly logger = new Logger(NodeCredentialIssuancesPurgeHandler.name);

  readonly type = NODE_CREDENTIAL_ISSUANCES_PURGE_TYPE;

  readonly label = 'Node credential issuances purge';

  constructor(
    private readonly registry: JobHandlerRegistry,
    @Inject(PLATFORM_PRISMA) private readonly prisma: JobsPrisma,
    @Optional() @Inject(NODES_OPTIONS) private readonly options?: ResolvedNodesModuleOptions
  ) {}

  /** Self-registration, the only wiring a handler needs. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /** Runs the purge. THROWS TO FAIL, like every handler. */
  async process(job: Job): Promise<void> {
    const deleted = await this.purge();

    if (deleted > 0) {
      this.logger.log(`Node credential issuances purge ${job.id}: ${deleted} row(s) past retention deleted`);
    } else {
      this.logger.debug(`Node credential issuances purge ${job.id}: nothing past retention`);
    }
  }

  /** Deletes every issuance recorded before the retention cutoff; returns the count. */
  async purge(now: Date = new Date()): Promise<number> {
    const days = this.options?.credentialIssuancesRetentionDays ?? DEFAULT_CREDENTIAL_ISSUANCES_RETENTION_DAYS;
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const { count } = await this.prisma.nodeCredentialIssuance.deleteMany({ where: { issuedAt: { lt: cutoff } } });

    return count;
  }
}
