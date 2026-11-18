// =============================================================================
// The webhooks slice's constants (issue #1046)
// =============================================================================
//
// PERMANENT strings: the three job types, the credential purpose, the
// notification channel and event ids, the audit actions. Rename none once rows
// or preferences name it.
// =============================================================================

import { WEBHOOK_API_VERSION } from '@marinoscar/platform-contract/webhooks';

import { registerSystemAccessReason, systemAccessReasonRegistry } from '../core/index';

/** The delivery job: one attempt of one delivery. PERMANENT once jobs of this type exist. @stability experimental */
export const WEBHOOK_DELIVER_JOB_TYPE = 'webhooks.deliver';
/** The fan-out job: one emitted event to every matching endpoint. PERMANENT once jobs of this type exist. @stability experimental */
export const WEBHOOK_FANOUT_JOB_TYPE = 'webhooks.fanout';
/** The daily retention job. PERMANENT once jobs of this type exist. @stability experimental */
export const WEBHOOK_PURGE_JOB_TYPE = 'webhooks.deliveries_purge';

/** `subjectType` of a delivery job. @stability experimental */
export const WEBHOOK_DELIVERY_SUBJECT_TYPE = 'webhook_delivery';

/** The credential purpose of an endpoint's signing secret, in all three tiers. @stability experimental */
export const WEBHOOK_SIGNING_PURPOSE = 'webhook_signing';

/** The notification channel that carries user notifications to a user's webhook endpoints. @stability experimental */
export const WEBHOOK_NOTIFICATION_CHANNEL_ID = 'webhook';

/** The notification event raised when an endpoint is disabled. @stability experimental */
export const WEBHOOK_ENDPOINT_DISABLED_EVENT_KEY = 'webhooks.endpoint_disabled';

/** The email template of that event. @stability experimental */
export const WEBHOOK_ENDPOINT_DISABLED_EMAIL_TEMPLATE = 'webhook-endpoint-disabled';

/** Prefix of the webhook event key a notification is exposed under (`notification.<eventKey>`). @stability experimental */
export const WEBHOOK_NOTIFICATION_EVENT_PREFIX = 'notification.';

/** The system access reason every cross-organization (system-scope) webhook query names. @stability experimental */
export const WEBHOOKS_SYSTEM_ACCESS_REASON = 'webhooks';

/**
 * Registers the `webhooks` system access reason with core's registry, once.
 * `WebhooksModule.forRoot()` calls it, and so does the repository's constructor,
 * so code that builds the repository by hand (a database test) is covered too.
 *
 * @stability experimental
 */
export function registerWebhooksSystemAccessReason(): void {
  if (systemAccessReasonRegistry.has(WEBHOOKS_SYSTEM_ACCESS_REASON)) return;
  registerSystemAccessReason({
    id: WEBHOOKS_SYSTEM_ACCESS_REASON,
    description: 'The webhooks slice: system-scope endpoints and their deliveries, which belong to no organization.',
  });
}

/** The `apiVersion` of the envelope. @stability experimental */
export const WEBHOOK_ENVELOPE_API_VERSION = WEBHOOK_API_VERSION;

/** The audit actions the slice writes. @stability experimental */
export const WEBHOOK_AUDIT_ACTIONS = {
  CREATE: 'webhook.endpoint.create',
  UPDATE: 'webhook.endpoint.update',
  DELETE: 'webhook.endpoint.delete',
  ROTATE: 'webhook.endpoint.rotate_secret',
  REDELIVER: 'webhook.delivery.redeliver',
  DISABLE: 'webhook.endpoint.disable',
} as const;

/** The audit `targetType` of an endpoint. @stability experimental */
export const WEBHOOK_AUDIT_TARGET = 'webhook_endpoint';

/** Why an endpoint was switched off by the platform. @stability experimental */
export const WEBHOOK_DISABLED_REASONS = {
  CIRCUIT_OPEN: 'circuit_open',
  OWNER_LOST_ACCESS: 'owner_lost_access',
  GONE: 'gone',
} as const;

/** Defaults of {@link WebhooksModuleOptions}. @stability experimental */
export const WEBHOOK_DEFAULTS = Object.freeze({
  circuitBreakerThreshold: 20,
  rotationOverlapHours: 24,
  deliveryRetentionDays: 30,
  requestTimeoutMs: 10_000,
  maxDeliveryAttempts: 10,
  limits: Object.freeze({ user: 20, org: 50, system: 50 }),
} as const);

/** The response body kept on a delivery row, in characters. @stability experimental */
export const WEBHOOK_SNIPPET_MAX = 1024;

/** Rows per batch of the retention purge. @stability experimental */
export const WEBHOOK_PURGE_BATCH = 2000;

/** Safety stop on the purge loop. @stability experimental */
export const WEBHOOK_PURGE_MAX_BATCHES = 500;

/** The retry schedule, in milliseconds, indexed by the attempt that just failed (1-based). The last entry repeats. @stability experimental */
export const WEBHOOK_RETRY_SCHEDULE_MS: readonly number[] = Object.freeze([
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 3_600_000,
  4 * 3_600_000,
  6 * 3_600_000,
  6 * 3_600_000,
]);

/** A server's `Retry-After` never delays a retry beyond this. @stability experimental */
export const WEBHOOK_RETRY_AFTER_CAP_MS = 24 * 3_600_000;

/** The headers a stored delivery detail never shows (the signature is derived, not stored). @stability experimental */
export const WEBHOOK_REDACTED_HEADERS = ['webhook-signature'] as const;
