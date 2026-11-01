// =============================================================================
// `webhooks.fanout`: the fan-out of one emitted event (issue #1046)
// =============================================================================
//
// The domain-event listeners (node offline, node event, permanent job failure)
// only ENQUEUE this job, so no listener body does fan-out work inline
// (`on-event-no-io`). The handler replays the event through
// `WebhooksService.emit` under the event id the listener chose, so a retried
// job inserts no second delivery (`(endpointId, eventId)` is unique).
// Server-only: it reads other people's endpoints and their owners' roles.
// =============================================================================

import { Injectable, OnModuleInit } from '@nestjs/common';

import { JobHandlerRegistry, type Job, type JobExecutionProfile, type JobHandler } from '../../jobs/index';
import { WEBHOOK_FANOUT_JOB_TYPE } from '../webhooks.constants';
import { WebhooksService, type WebhookFanoutPayload } from '../webhooks.service';

/**
 * The `webhooks.fanout` job. See the file header.
 *
 * @stability experimental
 */
@Injectable()
export class WebhookFanoutHandler implements JobHandler, OnModuleInit {
  /** PERMANENT once jobs of this type exist. */
  readonly type = WEBHOOK_FANOUT_JOB_TYPE;

  /** Its name in the jobs console. */
  readonly label = 'Webhook fan-out';

  /** Reads a few rows and inserts a few; a minute and three attempts. */
  readonly profile: JobExecutionProfile = { maxRuntimeMs: 60_000, maxAttempts: 3 };

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly webhooks: WebhooksService,
  ) {}

  /** Registers the handler with the job registry. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * Emits the event the job carries.
   *
   * @param job - the claimed job; its payload is a {@link WebhookFanoutPayload}.
   */
  async process(job: Job): Promise<void> {
    const payload = job.payload as unknown as WebhookFanoutPayload | null;
    if (!payload || typeof payload.eventKey !== 'string') throw new Error(`Job ${job.id} carries no webhook event`);
    await this.webhooks.emit(payload.eventKey, payload.data, {
      orgId: payload.orgId ?? job.orgId ?? null,
      ...(payload.userId ? { userId: payload.userId } : {}),
      eventId: payload.eventId,
      occurredAt: new Date(payload.occurredAt),
    });
  }
}
