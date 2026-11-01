// =============================================================================
// The webhooks slice's wire shapes (issue #1046)
// =============================================================================
//
// Endpoints, deliveries, the event catalog and the envelope a receiver gets.
// No schema here carries a signing secret except the two responses that show
// it once (`webhookEndpointCreatedSchema`, `rotateWebhookSecretResponseSchema`).
// Dates are ISO 8601 strings.
// =============================================================================

import { z } from 'zod';

import { wireEnum } from './enum.js';

import {
  WEBHOOK_DELIVERIES_PAGE_SIZE_DEFAULT,
  WEBHOOK_DELIVERIES_PAGE_SIZE_MAX,
  WEBHOOK_DELIVERY_STATUSES,
  WEBHOOK_DESCRIPTION_MAX,
  WEBHOOK_EVENT_KEY_MAX,
  WEBHOOK_EVENT_KEY_PATTERN,
  WEBHOOK_EVENT_KEYS_MAX,
  WEBHOOK_NAME_MAX,
  WEBHOOK_SCOPES,
  WEBHOOK_URL_MAX,
} from './constants.js';

const isoDate = z.string();

/**
 * One subscription entry: an exact key, `group.*` or `*`.
 *
 * @stability experimental
 */
export const webhookEventKeySchema = z.string().max(WEBHOOK_EVENT_KEY_MAX).regex(WEBHOOK_EVENT_KEY_PATTERN);

const eventKeysSchema = z.array(webhookEventKeySchema).min(1).max(WEBHOOK_EVENT_KEYS_MAX);

const httpUrlSchema = z
  .string()
  .max(WEBHOOK_URL_MAX)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Must be an http(s) URL');

/** One of `user`, `org`, `system`. @stability experimental */
export const webhookScopeSchema = wireEnum(WEBHOOK_SCOPES);

/** One delivery status. @stability experimental */
export const webhookDeliveryStatusSchema = wireEnum(WEBHOOK_DELIVERY_STATUSES);

/**
 * A webhook endpoint as the API returns it. Never carries the secret.
 *
 * @stability experimental
 */
export const webhookEndpointSchema = z.object({
  /** The id. */
  id: z.string(),
  /** Who owns it. */
  scope: webhookScopeSchema,
  /** The organization; `null` for a system endpoint. */
  orgId: z.string().nullable(),
  /** The owning user (user scope); `null` otherwise. */
  ownerUserId: z.string().nullable(),
  /** The display name. */
  name: z.string(),
  /** A free-text note, or `null`. */
  description: z.string().nullable(),
  /** The receiver URL. */
  url: z.string(),
  /** The subscription entries: exact keys, `group.*` or `*`. */
  eventKeys: z.array(z.string()),
  /** Whether deliveries are sent. */
  enabled: z.boolean(),
  /** Why the endpoint was switched off by the platform (`circuit_open`, `owner_lost_access`, `gone`), else `null`. */
  disabledReason: z.string().nullable(),
  /** Failed deliveries in a row; the circuit opens at the configured limit. */
  consecutiveFailures: z.number().int().min(0),
  /** Increments on every rotation. */
  secretVersion: z.number().int().min(1),
  /** While set and in the future, deliveries are signed with the previous secret too. */
  previousSecretUntil: isoDate.nullable(),
  /** When the last attempt finished, or `null`. */
  lastDeliveryAt: isoDate.nullable(),
  /** When the last 2xx answer arrived, or `null`. */
  lastSuccessAt: isoDate.nullable(),
  /** Creation time. */
  createdAt: isoDate,
  /** Last change. */
  updatedAt: isoDate,
});

/** A webhook endpoint. @stability experimental */
export type WebhookEndpoint = z.infer<typeof webhookEndpointSchema>;

/**
 * `POST` body to create an endpoint.
 *
 * @stability experimental
 */
export const createWebhookEndpointSchema = z.object({
  /** The display name. */
  name: z.string().min(1).max(WEBHOOK_NAME_MAX),
  /** A free-text note, or `null`. */
  description: z.string().max(WEBHOOK_DESCRIPTION_MAX).nullish(),
  /** The receiver URL. */
  url: httpUrlSchema,
  /** The subscription entries: exact keys, `group.*` or `*`. */
  eventKeys: eventKeysSchema,
  /** Whether deliveries are sent. */
  enabled: z.boolean().default(true),
});

/** Input of the create body (before defaults). @stability experimental */
export type CreateWebhookEndpointInput = z.input<typeof createWebhookEndpointSchema>;
/** The parsed create body. @stability experimental */
export type CreateWebhookEndpoint = z.output<typeof createWebhookEndpointSchema>;

/**
 * `PATCH` body: every create field is optional. `enabled: true` also clears a
 * platform-set `disabledReason` and the failure streak.
 *
 * @stability experimental
 */
export const updateWebhookEndpointSchema = z.object({
  /** The display name. */
  name: z.string().min(1).max(WEBHOOK_NAME_MAX).optional(),
  /** A free-text note, or `null`. */
  description: z.string().max(WEBHOOK_DESCRIPTION_MAX).nullish(),
  /** The receiver URL. */
  url: httpUrlSchema.optional(),
  /** The subscription entries: exact keys, `group.*` or `*`. */
  eventKeys: eventKeysSchema.optional(),
  /** Whether deliveries are sent. */
  enabled: z.boolean().optional(),
});

/** The update body. @stability experimental */
export type UpdateWebhookEndpoint = z.infer<typeof updateWebhookEndpointSchema>;

/**
 * The endpoint list.
 *
 * @stability experimental
 */
export const webhookEndpointListSchema = z.object({
  /** The page of entries. */
  items: z.array(webhookEndpointSchema),
});

/** The endpoint list. @stability experimental */
export type WebhookEndpointList = z.infer<typeof webhookEndpointListSchema>;

/**
 * The create response: the endpoint and its signing secret, shown once.
 *
 * @stability experimental
 */
export const webhookEndpointCreatedSchema = z.object({
  /** The endpoint. */
  endpoint: webhookEndpointSchema,
  /** `whsec_<base64>`. Never returned again. */
  secret: z.string(),
});

/** The create response. @stability experimental */
export type WebhookEndpointCreated = z.infer<typeof webhookEndpointCreatedSchema>;

/**
 * The rotate response: the new secret, shown once, and when the previous one
 * stops being accepted.
 *
 * @stability experimental
 */
export const rotateWebhookSecretResponseSchema = z.object({
  /** `whsec_<base64>`; shown once. */
  secret: z.string(),
  /** Increments on every rotation. */
  secretVersion: z.number().int().min(1),
  /** When the previous secret stops being accepted, or `null`. */
  previousSecretValidUntil: isoDate.nullable(),
});

/** The rotate response. @stability experimental */
export type RotateWebhookSecretResponse = z.infer<typeof rotateWebhookSecretResponseSchema>;

/**
 * One delivery row (no body).
 *
 * @stability experimental
 */
export const webhookDeliverySchema = z.object({
  /** The id. */
  id: z.string(),
  /** The endpoint. */
  endpointId: z.string(),
  /** The event key. */
  eventKey: z.string(),
  /** The event id; identical across retries. */
  eventId: z.string(),
  /** The lifecycle state. */
  status: webhookDeliveryStatusSchema,
  /** How many attempts were made. */
  attempt: z.number().int().min(0),
  /** The receiver's HTTP status, or `null`. */
  responseStatus: z.number().int().nullable(),
  /** The start of the receiver's answer, or `null`. */
  responseSnippet: z.string().nullable(),
  /** A short failure code, or `null`. */
  errorCode: z.string().nullable(),
  /** How long the last attempt took, or `null`. */
  durationMs: z.number().int().nullable(),
  /** When the next retry is due, or `null`. */
  nextAttemptAt: isoDate.nullable(),
  /** When the delivery succeeded, or `null`. */
  deliveredAt: isoDate.nullable(),
  /** Creation time. */
  createdAt: isoDate,
});

/** One delivery. @stability experimental */
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;

/**
 * One delivery with the body sent and the request headers (the signature is
 * never included).
 *
 * @stability experimental
 */
export const webhookDeliveryDetailSchema = webhookDeliverySchema.extend({
  /** The envelope that was sent. */
  payload: z.unknown(),
  /** The headers sent, without the signature. */
  requestHeaders: z.record(z.string(), z.string()),
});

/** A delivery with its payload. @stability experimental */
export type WebhookDeliveryDetail = z.infer<typeof webhookDeliveryDetailSchema>;

/**
 * A page of deliveries.
 *
 * @stability experimental
 */
export const webhookDeliveryListSchema = z.object({
  /** The page of entries. */
  items: z.array(webhookDeliverySchema),
  /** All matching entries. */
  total: z.number().int().min(0),
  /** The 1-based page. */
  page: z.number().int().min(1),
  /** Entries per page. */
  pageSize: z.number().int().min(1),
  /** How many pages there are. */
  totalPages: z.number().int().min(0),
});

/** A page of deliveries. @stability experimental */
export type WebhookDeliveryList = z.infer<typeof webhookDeliveryListSchema>;

/**
 * `GET .../deliveries` query.
 *
 * @stability experimental
 */
export const webhookDeliveryListQuerySchema = z.object({
  /** The 1-based page. */
  page: z.coerce.number().int().min(1).default(1),
  /** Entries per page. */
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(WEBHOOK_DELIVERIES_PAGE_SIZE_MAX)
    .default(WEBHOOK_DELIVERIES_PAGE_SIZE_DEFAULT),
  /** The lifecycle state. */
  status: webhookDeliveryStatusSchema.optional(),
  /** The event key. */
  eventKey: z.string().max(WEBHOOK_EVENT_KEY_MAX).optional(),
});

/** The parsed delivery list query. @stability experimental */
export type WebhookDeliveryListQuery = z.infer<typeof webhookDeliveryListQuerySchema>;

/**
 * `POST .../test` response: the id of the queued ping delivery.
 *
 * @stability experimental
 */
export const webhookTestResponseSchema = z.object({
  /** The queued ping delivery. */
  deliveryId: z.string(),
});

/** The test response. @stability experimental */
export type WebhookTestResponse = z.infer<typeof webhookTestResponseSchema>;

/**
 * One event a caller may subscribe to.
 *
 * @stability experimental
 */
export const webhookEventCatalogEntrySchema = z.object({
  /** The event key. */
  key: z.string(),
  /** A short name. */
  label: z.string(),
  /** A free-text note, or `null`. */
  description: z.string(),
  /** The picker group heading. */
  group: z.string(),
  /** Who may subscribe. */
  audience: webhookScopeSchema,
  /** JSON Schema of the envelope's `data`. */
  jsonSchema: z.record(z.string(), z.unknown()),
  /** A sample `data`. */
  example: z.unknown().optional(),
});

/** One catalog entry. @stability experimental */
export type WebhookEventCatalogEntry = z.infer<typeof webhookEventCatalogEntrySchema>;

/**
 * `GET .../events`: the catalog, filtered to what the caller may subscribe to.
 *
 * @stability experimental
 */
export const webhookEventCatalogSchema = z.object({
  /** The page of entries. */
  items: z.array(webhookEventCatalogEntrySchema),
});

/** The event catalog. @stability experimental */
export type WebhookEventCatalog = z.infer<typeof webhookEventCatalogSchema>;

/**
 * The JSON body a receiver gets.
 *
 * @stability experimental
 */
export const webhookEnvelopeSchema = z.object({
  /** The event id (also the `webhook-id` header). */
  id: z.string(),
  /** The event key. */
  type: z.string(),
  /** Creation time. */
  createdAt: isoDate,
  /** The envelope version. */
  apiVersion: z.string(),
  /** The organization, or `null` for a system event. */
  org: z
    .object({
      /** The organization id. */
      id: z.string(),
    })
    .nullable(),
  /** The event data. */
  data: z.unknown(),
});

/** The delivered body. @stability experimental */
export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;
