// =============================================================================
// The webhooks slice's zod-free constants (issue #1046)
// =============================================================================
//
// Plain values and string-literal unions only (no zod), so a browser that needs
// a constant or a type never bundles zod (test/no-zod-in-constants.test.ts).
// =============================================================================

/**
 * Who owns an endpoint: a `user` (their own, inside the active organization),
 * an `org` (shared by the organization's administrators) or the `system`
 * (the deployment; administrators only).
 *
 * @stability experimental
 */
export const WEBHOOK_SCOPES = ['user', 'org', 'system'] as const;

/**
 * One webhook scope.
 *
 * @stability experimental
 */
export type WebhookScope = (typeof WEBHOOK_SCOPES)[number];

/**
 * The lifecycle of one delivery: `pending` (queued), `delivering` (an attempt
 * is running), `succeeded` (a 2xx answer), `failed` (an attempt failed and a
 * retry is scheduled) and `dead` (retries exhausted, or the endpoint is gone).
 *
 * @stability experimental
 */
export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'delivering', 'succeeded', 'failed', 'dead'] as const;

/**
 * One delivery status.
 *
 * @stability experimental
 */
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

/**
 * The permission strings the webhook routes enforce, per scope: user
 * (`webhooks:*`), organization (`org_webhooks:*`) and system
 * (`system_webhooks:*`).
 *
 * @stability experimental
 */
export const WEBHOOK_PERMISSIONS = {
  READ: 'webhooks:read',
  WRITE: 'webhooks:write',
  ORG_READ: 'org_webhooks:read',
  ORG_WRITE: 'org_webhooks:write',
  SYSTEM_READ: 'system_webhooks:read',
  SYSTEM_WRITE: 'system_webhooks:write',
} as const;

/**
 * The request headers of a delivery (the Standard Webhooks names).
 *
 * @stability experimental
 */
export const WEBHOOK_HEADERS = {
  /** The event id; identical across retries, so a receiver can dedupe. */
  ID: 'webhook-id',
  /** Unix seconds at signing time. */
  TIMESTAMP: 'webhook-timestamp',
  /** Space separated `v1,<base64>` signatures (two during a rotation overlap). */
  SIGNATURE: 'webhook-signature',
} as const;

/**
 * The `apiVersion` of the envelope.
 *
 * @stability experimental
 */
export const WEBHOOK_API_VERSION = '2026-11-01';

/**
 * The prefix of a signing secret (`whsec_<base64 key>`).
 *
 * @stability experimental
 */
export const WEBHOOK_SECRET_PREFIX = 'whsec_';

/**
 * The signature scheme tag of a `webhook-signature` entry.
 *
 * @stability experimental
 */
export const WEBHOOK_SIGNATURE_VERSION = 'v1';

/**
 * The default clock tolerance of {@link verifyWebhookSignature}, in seconds.
 *
 * @stability experimental
 */
export const WEBHOOK_DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * The stable error codes of the webhook routes.
 *
 * @stability experimental
 */
export const WEBHOOK_ERROR_CODES = {
  WEBHOOK_NOT_FOUND: 'WEBHOOK_NOT_FOUND',
  WEBHOOK_DELIVERY_NOT_FOUND: 'WEBHOOK_DELIVERY_NOT_FOUND',
  WEBHOOK_URL_INVALID: 'WEBHOOK_URL_INVALID',
  WEBHOOK_URL_FORBIDDEN: 'WEBHOOK_URL_FORBIDDEN',
  WEBHOOK_EVENT_UNKNOWN: 'WEBHOOK_EVENT_UNKNOWN',
  WEBHOOK_EVENT_NOT_PERMITTED: 'WEBHOOK_EVENT_NOT_PERMITTED',
  WEBHOOK_LIMIT_REACHED: 'WEBHOOK_LIMIT_REACHED',
} as const;

/**
 * One webhook error code.
 *
 * @stability experimental
 */
export type WebhookErrorCode = (typeof WEBHOOK_ERROR_CODES)[keyof typeof WEBHOOK_ERROR_CODES];

/**
 * What an event key looks like: dot separated lower-case segments
 * (`nodes.node.offline`), at least two. Event keys are an OPEN vocabulary
 * (an app registers its own).
 *
 * @stability experimental
 */
export const WEBHOOK_EVENT_KEY_REGEX_SOURCE = '[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+';

/**
 * What a subscription entry may be: an exact event key (`jobs.job.failed`), a
 * group wildcard (`nodes.*`, `notification.*`) or `*` for every event the
 * owner is permitted to receive.
 *
 * @stability experimental
 */
export const WEBHOOK_EVENT_KEY_PATTERN = new RegExp(
  `^(?:\\*|[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)*\\.\\*|${WEBHOOK_EVENT_KEY_REGEX_SOURCE})$`,
);

/** The longest event key or subscription entry. @stability experimental */
export const WEBHOOK_EVENT_KEY_MAX = 128;
/** The most subscription entries on one endpoint. @stability experimental */
export const WEBHOOK_EVENT_KEYS_MAX = 100;
/** The longest endpoint name. @stability experimental */
export const WEBHOOK_NAME_MAX = 120;
/** The longest endpoint description. @stability experimental */
export const WEBHOOK_DESCRIPTION_MAX = 500;
/** The longest endpoint URL. @stability experimental */
export const WEBHOOK_URL_MAX = 2048;
/** The largest delivery list page. @stability experimental */
export const WEBHOOK_DELIVERIES_PAGE_SIZE_MAX = 100;
/** The default delivery list page size. @stability experimental */
export const WEBHOOK_DELIVERIES_PAGE_SIZE_DEFAULT = 20;
