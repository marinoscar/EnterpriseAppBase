import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { JobsService } from '../jobs/index';
import { NODE_EVENT_REPORTED, type NodeEventReportedEvent } from '../nodes/index';
import { ALERTS_EVALUATE_EVENT_TYPE } from './alerts.constants';
import { HOUSEKEEPING_PRIORITY } from '../jobs/index';

/**
 * Turns a node event into an `alerts.evaluate_event` job. ENQUEUE ONLY: the
 * body does no I/O of its own and never evaluates a rule inline (the queue's
 * rule 1; the `on-event-no-io` suite scans it). Every event gets its own job
 * (`skipDedup`), because the job's payload says which event to look at.
 *
 * @stability experimental
 */
@Injectable()
export class AlertsEventListener {
  private readonly logger = new Logger(AlertsEventListener.name);

  constructor(private readonly jobs: JobsService) {}

  /**
   * Queues one `alerts.evaluate_event` job for a reported node event.
   *
   * @param event - the node event the nodes slice emitted after its write committed.
   */
  @OnEvent(NODE_EVENT_REPORTED)
  handleNodeEvent(event: NodeEventReportedEvent): void {
    void this.jobs
      .enqueue({
        type: ALERTS_EVALUATE_EVENT_TYPE,
        reason: 'backfill',
        orgId: null,
        priority: Math.min(HOUSEKEEPING_PRIORITY, 10),
        skipDedup: true,
        payload: {
          nodeId: event.nodeId,
          nodeName: event.nodeName,
          type: event.type,
          severity: event.severity,
          attrs: { ...event.attrs },
          occurredAt: event.occurredAt.toISOString(),
        },
      })
      .catch((error: unknown) => {
        this.logger.error(`Could not queue the alert evaluation for node event ${event.type}: ${error instanceof Error ? error.message : String(error)}`);
      });
  }
}
