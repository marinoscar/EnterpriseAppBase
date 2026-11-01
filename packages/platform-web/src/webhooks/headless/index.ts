// `@marinoscar/platform-web/webhooks/headless`: the webhooks client, hooks and
// pure helpers (issue #1046): endpoints, deliveries and the event catalog of
// one scope (`user`, `org`, `system`), the event picker's model and status in
// words. No UI. Documented in ../README.md.

export {
  WEBHOOK_SCOPE_BASE_PATHS,
  WEBHOOK_SCOPE_PERMISSIONS,
  createWebhooksApi,
  webhooksBasePath,
} from './client.js';
export type { WebhookDeliveriesQuery, WebhooksApi } from './client.js';
export {
  WEBHOOK_ALL_EVENTS,
  groupWebhookEventCatalog,
  isWebhookEventSelected,
  searchWebhookEventGroups,
  toggleAllWebhookEvents,
  toggleWebhookEvent,
  toggleWebhookGroup,
  unknownWebhookSubscriptions,
  webhookEntryCovers,
  webhookGroupSelectionState,
} from './event-selection.js';
export type { WebhookEventGroup } from './event-selection.js';
export {
  WEBHOOK_DISABLED_REASON_LABELS,
  formatWebhookDuration,
  isHttpsWebhookUrl,
  webhookDeliveryStatusLabel,
  webhookDeliveryStatusTone,
  webhookEndpointStatus,
  webhookUrlHost,
} from './format.js';
export type { WebhookEndpointStatus, WebhookStatusTone } from './format.js';
export {
  useWebhookDeliveries,
  useWebhookDelivery,
  useWebhookEndpoint,
  useWebhookEndpoints,
  useWebhookEventCatalog,
  useWebhookMutations,
  useWebhooksApi,
  webhookErrorMessage,
} from './hooks.js';
export type {
  WebhookDeliveriesState,
  WebhookDeliveryState,
  WebhookEndpointState,
  WebhookEndpointsState,
  WebhookEventCatalogState,
  WebhookMutations,
} from './hooks.js';
