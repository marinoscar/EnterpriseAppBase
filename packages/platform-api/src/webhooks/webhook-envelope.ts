// =============================================================================
// The body a receiver gets, and the metric label of an event (issue #1046)
// =============================================================================

import { WEBHOOK_API_VERSION, type WebhookEnvelope } from '@marinoscar/platform-contract/webhooks';

import { webhookEventRegistry } from './registry/webhook-event.registry';

/** The `apiVersion` of every envelope. @stability experimental */
export const WEBHOOK_ENVELOPE_API_VERSION_VALUE = WEBHOOK_API_VERSION;

/** What {@link buildEnvelope} takes. @stability experimental */
export interface EnvelopeInput {
  /** Event id. */
  readonly eventId: string;
  /** Event key. */
  readonly eventKey: string;
  /** Org id. */
  readonly orgId: string | null;
  /** Data. */
  readonly data: unknown;
  /** Occurred at. */
  readonly occurredAt: Date;
}

/**
 * The envelope: `{ id, type, createdAt, apiVersion, org, data }`.
 *
 * @param input - see {@link EnvelopeInput}.
 * @returns the envelope, stored on the delivery row as the body sent.
 *
 * @stability experimental
 */
export function buildEnvelope(input: EnvelopeInput): WebhookEnvelope {
  return {
    id: input.eventId,
    type: input.eventKey,
    createdAt: input.occurredAt.toISOString(),
    apiVersion: WEBHOOK_ENVELOPE_API_VERSION_VALUE,
    org: input.orgId ? { id: input.orgId } : null,
    data: input.data,
  };
}

/**
 * The bounded `event_group` metric label of an event key: its first segment
 * when that is a registered group (or `notification`), else `other`.
 *
 * @param eventKey - an event key.
 * @returns the label.
 *
 * @stability experimental
 */
export function eventGroupOf(eventKey: string): string {
  const first = eventKey.split('.')[0] ?? '';
  if (first === 'notification') return first;
  return webhookEventRegistry.list().some((event) => event.key.split('.')[0] === first) ? first : 'other';
}
