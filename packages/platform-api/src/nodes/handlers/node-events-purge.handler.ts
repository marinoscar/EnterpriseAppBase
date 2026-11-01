// =============================================================================
// `nodes.node_events_purge`: the node event log's retention as a queue job (issue #1045)
// =============================================================================
//
// `worker_node_events` grows by at most 120 rows per node per hour (the
// ingestion cap), but a log nobody trims is a table that only grows. A daily
// cron (`NodeEventsPurgeTask`) enqueues this job; a worker slot deletes every
// row whose `receivedAt` is older than the retention (default 30 days,
// `NodesModule.forRoot({ nodeEventsRetentionDays })`).
//
// IDEMPOTENT, SO NO OVERLAP GUARD AND NO PROFILE: one `deleteMany` on an
// indexed column; two workers racing produce one delete and one no-op.
//
// SERVER-ONLY BY DERIVATION: neither `nodeResultSchema` nor `persistNodeResult`.
// A node must never be able to delete the log that describes it.
// =============================================================================

import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';

import { PLATFORM_PRISMA } from '../../core/index';
import { type Job, JobHandler, JobHandlerRegistry, type JobsPrisma } from '../../jobs/index';
import { DEFAULT_NODE_EVENTS_RETENTION_DAYS, NODES_OPTIONS, type ResolvedNodesModuleOptions } from '../nodes.options';

/**
 * The handler key, and therefore the `Job.type` every purge row carries.
 * PERMANENT: rows outlive handlers.
 *
 * @stability experimental
 */
export const NODE_EVENTS_PURGE_TYPE = 'nodes.node_events_purge';

/**
 * The `nodes.node_events_purge` handler: deletes node events older than the retention. Server-only.
 *
 * @stability experimental
 */
@Injectable()
export class NodeEventsPurgeHandler implements JobHandler, OnModuleInit {
  private readonly logger = new Logger(NodeEventsPurgeHandler.name);

  readonly type = NODE_EVENTS_PURGE_TYPE;

  readonly label = 'Node events purge';

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
      this.logger.log(`Node events purge ${job.id}: ${deleted} event(s) past retention deleted`);
    } else {
      this.logger.debug(`Node events purge ${job.id}: nothing past retention`);
    }
  }

  /** Deletes every event received before the retention cutoff; returns the count. */
  async purge(now: Date = new Date()): Promise<number> {
    const days = this.options?.nodeEventsRetentionDays ?? DEFAULT_NODE_EVENTS_RETENTION_DAYS;
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const { count } = await this.prisma.workerNodeEvent.deleteMany({ where: { receivedAt: { lt: cutoff } } });

    return count;
  }
}
