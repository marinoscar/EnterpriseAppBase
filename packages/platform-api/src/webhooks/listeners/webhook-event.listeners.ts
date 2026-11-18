// =============================================================================
// Domain-event bridges (issue #1046)
// =============================================================================
//
// The platform raises plain in-process events (`nodes.node.offline`,
// `nodes.node.event`, `job.settled`); these listeners turn them into webhook
// events. A listener body does NO fan-out and NO I/O of its own: it validates
// nothing, loads nothing and sends nothing; it hands the event to
// `WebhooksService.enqueueFanout`, one bounded insert into the queue, and the
// `webhooks.fanout` job does the rest (the `on-event-no-io` rule).
//
// A failure of the enqueue is logged and swallowed: an event bridge must never
// break the code that raised the event.
//
// `job.settled` is bridged only for a job that FAILED FOR GOOD, and never for
// the slice's own `webhooks.*` jobs (a webhook about a failed webhook would
// loop).
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { JOB_SETTLED_EVENT, type JobSettledEvent } from '../../jobs/index';
import { NODE_EVENT_REPORTED, NODE_OFFLINE_EVENT, type NodeEventReportedEvent, type NodeOfflineEvent } from '../../nodes/index';
import {
  JOB_FAILED_WEBHOOK_EVENT_KEY,
  NODE_EVENT_WEBHOOK_EVENT_KEY,
  NODE_OFFLINE_WEBHOOK_EVENT_KEY,
} from '../registry/builtin-events';
import { WebhooksService } from '../webhooks.service';

const LAST_ERROR_MAX = 500;

/**
 * The bridges. See the file header.
 *
 * @internal
 *
 * @stability experimental
 */
@Injectable()
export class WebhookEventListeners {
  private readonly logger = new Logger(WebhookEventListeners.name);

  constructor(private readonly webhooks: WebhooksService) {}

  /** `nodes.node.offline` to the `nodes.node.offline` webhook event. */
  @OnEvent(NODE_OFFLINE_EVENT)
  onNodeOffline(event: NodeOfflineEvent): void {
    void this.queue(NODE_OFFLINE_WEBHOOK_EVENT_KEY, {
      nodeId: event.nodeId,
      nodeName: event.nodeName,
      lastHeartbeatAt: event.lastHeartbeatAt ? event.lastHeartbeatAt.toISOString() : null,
      markedOfflineAt: event.markedOfflineAt.toISOString(),
      staleAfterMinutes: event.staleAfterMinutes,
    });
  }

  /** `nodes.node.event` to the `nodes.node.event` webhook event. */
  @OnEvent(NODE_EVENT_REPORTED)
  onNodeEvent(event: NodeEventReportedEvent): void {
    void this.queue(NODE_EVENT_WEBHOOK_EVENT_KEY, {
      nodeId: event.nodeId,
      nodeName: event.nodeName,
      type: event.type,
      severity: event.severity,
      attrs: { ...event.attrs },
      occurredAt: event.occurredAt.toISOString(),
    });
  }

  /** `job.settled` (failed for good) to the `jobs.job.failed` webhook event. */
  @OnEvent(JOB_SETTLED_EVENT)
  onJobSettled(event: JobSettledEvent): void {
    if (event.succeeded || event.type.startsWith('webhooks.')) return;
    void this.queue(JOB_FAILED_WEBHOOK_EVENT_KEY, {
      jobId: event.jobId,
      type: event.type,
      subjectType: event.subjectType,
      subjectId: event.subjectId,
      orgId: event.job.orgId ?? null,
      attempts: event.job.attempts,
      lastError: event.lastError ? event.lastError.slice(0, LAST_ERROR_MAX) : null,
      finishedAt: event.job.finishedAt ? event.job.finishedAt.toISOString() : null,
    });
  }

  private async queue(eventKey: string, data: unknown): Promise<void> {
    try {
      await this.webhooks.enqueueFanout(eventKey, data, { orgId: null });
    } catch (error) {
      this.logger.warn(`Could not queue the "${eventKey}" webhook fan-out: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
