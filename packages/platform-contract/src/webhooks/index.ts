// `@marinoscar/platform-contract/webhooks`: the webhooks slice's wire shapes
// (issue #1046): endpoints, deliveries, the event catalog, the envelope, the
// header names, error codes and the signing helpers. Documented in
// ./README.md. Explicit named exports only.

export {
  WEBHOOK_API_VERSION,
  WEBHOOK_DEFAULT_TOLERANCE_SECONDS,
  WEBHOOK_DELIVERIES_PAGE_SIZE_DEFAULT,
  WEBHOOK_DELIVERIES_PAGE_SIZE_MAX,
  WEBHOOK_DELIVERY_STATUSES,
  WEBHOOK_DESCRIPTION_MAX,
  WEBHOOK_ERROR_CODES,
  WEBHOOK_EVENT_KEY_MAX,
  WEBHOOK_EVENT_KEY_PATTERN,
  WEBHOOK_EVENT_KEY_REGEX_SOURCE,
  WEBHOOK_EVENT_KEYS_MAX,
  WEBHOOK_HEADERS,
  WEBHOOK_NAME_MAX,
  WEBHOOK_PERMISSIONS,
  WEBHOOK_SCOPES,
  WEBHOOK_SECRET_PREFIX,
  WEBHOOK_SIGNATURE_VERSION,
  WEBHOOK_URL_MAX,
} from './constants.js';
export type { WebhookDeliveryStatus, WebhookErrorCode, WebhookScope } from './constants.js';
export {
  createWebhookEndpointSchema,
  rotateWebhookSecretResponseSchema,
  updateWebhookEndpointSchema,
  webhookDeliveryDetailSchema,
  webhookDeliveryListQuerySchema,
  webhookDeliveryListSchema,
  webhookDeliverySchema,
  webhookDeliveryStatusSchema,
  webhookEndpointCreatedSchema,
  webhookEndpointListSchema,
  webhookEndpointSchema,
  webhookEnvelopeSchema,
  webhookEventCatalogEntrySchema,
  webhookEventCatalogSchema,
  webhookEventKeySchema,
  webhookScopeSchema,
  webhookTestResponseSchema,
} from './schemas.js';
export type {
  CreateWebhookEndpoint,
  CreateWebhookEndpointInput,
  RotateWebhookSecretResponse,
  UpdateWebhookEndpoint,
  WebhookDelivery,
  WebhookDeliveryDetail,
  WebhookDeliveryList,
  WebhookDeliveryListQuery,
  WebhookEndpoint,
  WebhookEndpointCreated,
  WebhookEndpointList,
  WebhookEnvelope,
  WebhookEventCatalog,
  WebhookEventCatalogEntry,
  WebhookTestResponse,
} from './schemas.js';
export { signWebhookPayload, verifyWebhookSignature } from './signature.js';
export type { SignWebhookPayloadInput, VerifyWebhookSignatureInput } from './signature.js';
