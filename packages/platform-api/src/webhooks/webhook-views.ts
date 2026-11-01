// =============================================================================
// Row to wire shape (issue #1046)
// =============================================================================

import type {
  WebhookDelivery,
  WebhookDeliveryDetail,
  WebhookEndpoint,
} from '@marinoscar/platform-contract/webhooks';

import type { WebhookDeliveryRow, WebhookEndpointRow } from './data/webhooks-db';

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

/**
 * An endpoint row as the API serves it. There is no secret column to leak; the
 * view lists exactly the contract's fields.
 *
 * @param row - the row.
 * @returns the wire shape.
 *
 * @stability experimental
 */
export function toEndpointView(row: WebhookEndpointRow): WebhookEndpoint {
  return {
    id: row.id,
    scope: row.scope,
    orgId: row.orgId,
    ownerUserId: row.ownerUserId,
    name: row.name,
    description: row.description,
    url: row.url,
    eventKeys: [...row.eventKeys],
    enabled: row.enabled,
    disabledReason: row.disabledReason,
    consecutiveFailures: row.consecutiveFailures,
    secretVersion: row.secretVersion,
    previousSecretUntil: iso(row.previousSecretUntil),
    lastDeliveryAt: iso(row.lastDeliveryAt),
    lastSuccessAt: iso(row.lastSuccessAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * A delivery row as the list serves it (no payload).
 *
 * @param row - the row.
 * @returns the wire shape.
 *
 * @stability experimental
 */
export function toDeliveryView(row: WebhookDeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    endpointId: row.endpointId,
    eventKey: row.eventKey,
    eventId: row.eventId,
    status: row.status,
    attempt: row.attempt,
    responseStatus: row.responseStatus,
    responseSnippet: row.responseSnippet,
    errorCode: row.errorCode,
    durationMs: row.durationMs,
    nextAttemptAt: iso(row.nextAttemptAt),
    deliveredAt: iso(row.deliveredAt),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * One delivery with its payload and the request headers that are stable across
 * attempts. The signature and the timestamp are computed per attempt and never
 * stored, so neither is shown.
 *
 * @param row - the row.
 * @param userAgent - the `User-Agent` the slice sends.
 * @returns the wire shape.
 *
 * @stability experimental
 */
export function toDeliveryDetail(row: WebhookDeliveryRow, userAgent: string): WebhookDeliveryDetail {
  return {
    ...toDeliveryView(row),
    payload: row.payload,
    requestHeaders: { 'content-type': 'application/json', 'user-agent': userAgent, 'webhook-id': row.eventId },
  };
}
