// =============================================================================
// The daily node-event retention scheduler (issue #1045)
// =============================================================================
//
// ⚠ THIS TASK DELETES NOTHING. It enqueues `nodes.node_events_purge`, and
// `nodes/handlers/node-events-purge.handler.ts` does the work on a worker slot
// (the cron-enqueue-only rule). Daily, because retention is measured in days.
// =============================================================================

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PLATFORM_PRISMA } from '../../core/index';
import { enqueueHousekeepingJob, JobsService, type JobsPrisma } from '../../jobs/index';
import { NODE_EVENTS_PURGE_TYPE } from '../handlers/node-events-purge.handler';
import { NODES_OPTIONS, type ResolvedNodesModuleOptions } from '../nodes.options';

@Injectable()
export class NodeEventsPurgeTask {
  private readonly logger = new Logger(NodeEventsPurgeTask.name);

  constructor(
    private readonly jobs: JobsService,
    @Inject(PLATFORM_PRISMA) private readonly prisma: JobsPrisma,
    // `NodesModule.forRoot({ tasks })`: a per-process switch. There is no
    // environment variable for it; absent, the purge is on.
    @Optional() @Inject(NODES_OPTIONS) private readonly options?: ResolvedNodesModuleOptions
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async handleCron(): Promise<void> {
    if (!this.enabled()) {
      this.logger.debug('The node-events purge is disabled (NodesModule.forRoot tasks.nodeEventsPurge); skipping');

      return;
    }

    await enqueueHousekeepingJob({
      jobs: this.jobs,
      prisma: this.prisma,
      logger: this.logger,
      type: NODE_EVENTS_PURGE_TYPE,
      what: 'node events purge',
    });
  }

  /** On unless the app set `tasks.nodeEventsPurge` to `false`. */
  private enabled(): boolean {
    return this.options?.tasks.nodeEventsPurge !== false;
  }
}
