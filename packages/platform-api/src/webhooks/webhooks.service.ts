// =============================================================================
// WebhooksService: emit an event to the endpoints subscribed to it (issue #1046)
// =============================================================================
//
// `emit(eventKey, data, { orgId, userId })` is the one entry point a slice or an
// app calls to raise a webhook event. It:
//
//   1. resolves the event (registered, or a bridged `notification.<key>`) and
//      validates `data` against its schema; an unknown key or invalid data is
//      logged and counted and NEVER thrown to the caller (an event must not
//      break the code that raised it);
//   2. finds the enabled endpoints the event's audience can reach (a user's own,
//      an organization's, or the deployment's) that subscribe to the key;
//   3. re-checks each endpoint's OWNER'S access now (`webhooks.access.ts`): an
//      owner who lost it has the endpoint switched off (`owner_lost_access`);
//   4. inserts one delivery row per endpoint and enqueues its `webhooks.deliver`
//      job in ONE transaction. The `(endpointId, eventId)` unique key makes the
//      whole thing idempotent: a replayed fan-out job inserts nothing twice.
//
// MUST be called after the triggering write commits and outside any
// `$transaction` (like `notify()`): it opens its own short transaction. It
// performs no outbound HTTP: deliveries are made only by the `webhooks.deliver`
// job.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { AUDIT_SINK, PLATFORM_PRISMA, type AuditSink } from '../core/index';
import { resolveOrgId } from '../identity/index';
import { JobsService } from '../jobs/index';
import { MetricsHostService } from '../otel-core/index';
import type { WebhookEndpointRow } from './data/webhooks-db';
import type { WebhooksPrisma } from './ports';
import { resolveWebhookEvent } from './registry/webhook-catalog';
import { isSubscribed } from './registry/webhook-event.registry';
import { buildEnvelope, eventGroupOf } from './webhook-envelope';
import { ownerIdOf, ownerMayReceive } from './webhooks.access';
import {
  WEBHOOK_AUDIT_ACTIONS,
  WEBHOOK_AUDIT_TARGET,
  WEBHOOK_DISABLED_REASONS,
  WEBHOOK_FANOUT_JOB_TYPE,
} from './webhooks.constants';
import { WEBHOOK_EVENTS_METRIC } from './webhooks.metrics';
import { WebhooksRepository } from './webhooks.repository';

/** Where an event happened. @stability experimental */
export interface WebhookEmitContext {
  /** The organization the event belongs to; `null` for a deployment-wide (system) event. A user event with none uses the single-mode default organization. */
  readonly orgId: string | null;
  /** The user the event is about (audience `user`). */
  readonly userId?: string;
  /** A fixed event id: a replayed fan-out passes the original, so the unique key dedupes it. Default: a new UUID. */
  readonly eventId?: string;
  /** When the event happened; default now. */
  readonly occurredAt?: Date;
}

/** What one emit did. @stability experimental */
export interface WebhookEmitResult {
  /** Endpoints that subscribe to the event and may receive it. */
  readonly matched: number;
  /** Delivery rows inserted (and jobs enqueued). */
  readonly queued: number;
  /** The event id. */
  readonly eventId: string;
}

/** The payload of a `webhooks.fanout` job. @stability experimental */
export interface WebhookFanoutPayload {
  /** Event key. */
  readonly eventKey: string;
  /** Data. */
  readonly data: unknown;
  /** Org id. */
  readonly orgId: string | null;
  /** User id. */
  readonly userId?: string;
  /** Event id. */
  readonly eventId: string;
  /** Occurred at. */
  readonly occurredAt: string;
}

/**
 * See the file header.
 *
 * @extensionPoint token
 * @stability experimental
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly repository: WebhooksRepository,
    private readonly jobs: JobsService,
    @Inject(PLATFORM_PRISMA) private readonly prisma: WebhooksPrisma,
    @Inject(AUDIT_SINK) private readonly audit: AuditSink,
    @Optional() private readonly metrics?: MetricsHostService,
  ) {}

  /**
   * Raises an event. Never throws for an unknown event, invalid data or a
   * missing organization; those are logged and counted.
   *
   * @param eventKey - a registered key, or `notification.<eventKey>`.
   * @param data - validated against the event's schema.
   * @param context - where it happened.
   * @returns how many endpoints matched and how many deliveries were queued.
   */
  async emit(eventKey: string, data: unknown, context: WebhookEmitContext): Promise<WebhookEmitResult> {
    const eventId = context.eventId ?? randomUUID();
    const none: WebhookEmitResult = { matched: 0, queued: 0, eventId };
    const group = eventGroupOf(eventKey);

    const event = resolveWebhookEvent(eventKey);
    if (!event) {
      this.logger.warn(`Webhook event "${eventKey}" is not registered; nothing was sent`);
      this.metrics?.add(WEBHOOK_EVENTS_METRIC, 1, { outcome: 'unknown', event_group: group });
      return none;
    }
    const parsed = event.payloadSchema.safeParse(data);
    if (!parsed.success) {
      this.logger.warn(`Webhook event "${eventKey}" has invalid data (${parsed.error.issues.length} issue(s)); nothing was sent`);
      this.metrics?.add(WEBHOOK_EVENTS_METRIC, 1, { outcome: 'invalid', event_group: group });
      return none;
    }

    let orgId: string | null;
    try {
      orgId = event.audience === 'system' ? null : await resolveOrgId(this.prisma, context.orgId, `Webhook event ${eventKey}`);
    } catch (error) {
      this.logger.debug(`Webhook event "${eventKey}" has no organization to deliver in: ${error instanceof Error ? error.message : String(error)}`);
      this.metrics?.add(WEBHOOK_EVENTS_METRIC, 1, { outcome: 'no_match', event_group: group });
      return none;
    }
    if (event.audience === 'user' && !context.userId) {
      this.logger.warn(`Webhook event "${eventKey}" is a user event and was emitted without a user`);
      this.metrics?.add(WEBHOOK_EVENTS_METRIC, 1, { outcome: 'invalid', event_group: group });
      return none;
    }

    const candidates = (
      await this.repository.enabledEndpoints(orgId, {
        scope: event.audience,
        ...(event.audience === 'user' ? { ownerUserId: context.userId } : {}),
      })
    ).filter((endpoint) => isSubscribed(endpoint.eventKeys, eventKey));

    const allowed: WebhookEndpointRow[] = [];
    const owners = new Map<string, Awaited<ReturnType<WebhooksRepository['loadOwner']>>>();
    for (const endpoint of candidates) {
      const ownerId = ownerIdOf(endpoint);
      if (ownerId === null) {
        allowed.push(endpoint);
        continue;
      }
      if (!owners.has(ownerId)) owners.set(ownerId, await this.repository.loadOwner(orgId, ownerId));
      if (ownerMayReceive(owners.get(ownerId) ?? null, endpoint, event)) allowed.push(endpoint);
      else await this.disableForLostAccess(endpoint);
    }

    if (allowed.length === 0) {
      this.metrics?.add(WEBHOOK_EVENTS_METRIC, 1, { outcome: 'no_match', event_group: group });
      return { ...none, matched: 0 };
    }

    const envelope = buildEnvelope({
      eventId,
      eventKey,
      orgId: event.audience === 'system' ? null : orgId,
      data: parsed.data,
      occurredAt: context.occurredAt ?? new Date(),
    });
    const inserted = await this.repository.insertDeliveries(
      orgId,
      allowed.map((endpoint) => ({ endpointId: endpoint.id, eventKey, eventId, payload: envelope })),
    );
    this.metrics?.add(WEBHOOK_EVENTS_METRIC, 1, { outcome: 'queued', event_group: group });
    return { matched: allowed.length, queued: inserted.length, eventId };
  }

  /**
   * Raises a user event (audience `user`) for one member.
   *
   * @param userId - the member.
   * @param eventKey - a `user`-audience key, typically `notification.<eventKey>`.
   * @param data - the event's data.
   * @param options - the member's organization, a fixed event id.
   * @returns what {@link WebhooksService.emit} returns.
   */
  emitForUser(
    userId: string,
    eventKey: string,
    data: unknown,
    options: { orgId?: string | null; eventId?: string; occurredAt?: Date } = {},
  ): Promise<WebhookEmitResult> {
    return this.emit(eventKey, data, { orgId: options.orgId ?? null, userId, ...(options.eventId ? { eventId: options.eventId } : {}), ...(options.occurredAt ? { occurredAt: options.occurredAt } : {}) });
  }

  /**
   * Queues the fan-out of an event to a `webhooks.fanout` job. The shape every
   * event listener uses: one bounded insert, no fan-out inline.
   *
   * @param eventKey - the event key.
   * @param data - the event's data (JSON).
   * @param context - where it happened.
   * @returns the event id the job will emit under.
   */
  async enqueueFanout(eventKey: string, data: unknown, context: WebhookEmitContext): Promise<string> {
    const eventId = context.eventId ?? randomUUID();
    const payload: WebhookFanoutPayload = {
      eventKey,
      data,
      orgId: context.orgId,
      ...(context.userId ? { userId: context.userId } : {}),
      eventId,
      occurredAt: (context.occurredAt ?? new Date()).toISOString(),
    };
    await this.jobs.enqueue({
      type: WEBHOOK_FANOUT_JOB_TYPE,
      reason: 'upload',
      subjectType: 'webhook_event',
      subjectId: eventId,
      orgId: context.orgId,
      payload: payload as never,
    });
    return eventId;
  }

  private async disableForLostAccess(endpoint: WebhookEndpointRow): Promise<void> {
    try {
      const switched = await this.repository.disableEndpoint(endpoint.orgId, endpoint.id, WEBHOOK_DISABLED_REASONS.OWNER_LOST_ACCESS);
      if (!switched) return;
      this.logger.warn(`Webhook endpoint ${endpoint.id} disabled: its owner no longer has access to the event`);
      await this.audit.record({
        action: WEBHOOK_AUDIT_ACTIONS.DISABLE,
        actorUserId: null,
        targetType: WEBHOOK_AUDIT_TARGET,
        targetId: endpoint.id,
        meta: { scope: endpoint.scope, reason: WEBHOOK_DISABLED_REASONS.OWNER_LOST_ACCESS },
      });
    } catch (error) {
      this.logger.error(`Could not disable webhook endpoint ${endpoint.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
