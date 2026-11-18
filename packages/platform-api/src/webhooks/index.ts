// `@marinoscar/platform-api/webhooks`: outbound, signed webhooks (issue #1046,
// epic #1044). Endpoints for a member, an organization or the deployment; the
// event registry and catalog; the egress (SSRF) guard; signing with the
// credentials store; the `webhooks.deliver`, `webhooks.fanout` and
// `webhooks.deliveries_purge` jobs; the domain-event bridges; the `webhook`
// notification channel; and `/api/webhooks`, `/api/org/webhooks` and
// `/api/admin/webhooks`. Documented in ./README.md. Explicit named exports only.

// ---- the module and its options (rung 1) ---------------------------------------------------
export { WebhooksModule } from './webhooks.module';
export { WEBHOOKS_OPTIONS, resolveWebhooksModuleOptions, userAgentToken } from './webhooks.options';
export type { ResolvedWebhooksModuleOptions, WebhooksModuleOptions } from './webhooks.options';
export {
  WEBHOOK_AUDIT_TARGET,
  WEBHOOK_DELIVER_JOB_TYPE,
  WEBHOOK_DELIVERY_SUBJECT_TYPE,
  WEBHOOK_ENDPOINT_DISABLED_EMAIL_TEMPLATE,
  WEBHOOK_ENDPOINT_DISABLED_EVENT_KEY,
  WEBHOOK_FANOUT_JOB_TYPE,
  WEBHOOK_NOTIFICATION_CHANNEL_ID,
  WEBHOOK_NOTIFICATION_EVENT_PREFIX,
  WEBHOOK_PURGE_JOB_TYPE,
  WEBHOOK_RETRY_SCHEDULE_MS,
  WEBHOOK_SIGNING_PURPOSE,
  WEBHOOKS_SYSTEM_ACCESS_REASON,
  registerWebhooksSystemAccessReason,
} from './webhooks.constants';

// ---- events (rung 2) ------------------------------------------------------------------------
export {
  findWebhookEvent,
  isSubscribed,
  patternHasEventsForScope,
  registerWebhookEvent,
  subscriptionMatches,
  webhookEventRegistry,
  webhookEventsForScope,
} from './registry/webhook-event.registry';
export type { WebhookEventDef } from './registry/webhook-event.registry';
export { allWebhookEvents, catalogFor, resolveWebhookEvent, subscribableEvents } from './registry/webhook-catalog';
export {
  BUILTIN_WEBHOOK_EVENTS,
  JOB_FAILED_WEBHOOK_EVENT_KEY,
  NODE_EVENT_WEBHOOK_EVENT_KEY,
  NODE_OFFLINE_WEBHOOK_EVENT_KEY,
  WEBHOOK_PING_EVENT_KEY,
  registerBuiltinWebhookEvents,
} from './registry/builtin-events';

// ---- emitting ---------------------------------------------------------------------------------
export { WebhooksService } from './webhooks.service';
export type { WebhookEmitContext, WebhookEmitResult, WebhookFanoutPayload } from './webhooks.service';
export { buildEnvelope, eventGroupOf } from './webhook-envelope';
export type { EnvelopeInput } from './webhook-envelope';
export { WebhookEndpointsService } from './webhook-endpoints.service';
export type { WebhookScopeContext } from './webhook-endpoints.service';

// ---- egress, transport and signing ------------------------------------------------------------
export { WebhookEgressError, hostForLog, parseWebhookUrl, resolveWebhookTarget, systemHostResolver } from './egress/egress-guard';
export type { HostResolver, ResolvedAddress, ResolvedWebhookTarget, WebhookEgressErrorCode, WebhookEgressPolicy } from './egress/egress-guard';
export { WEBHOOKS_RESOLVER, WEBHOOKS_TRANSPORT, WebhookTransportError, nodeWebhookTransport } from './egress/transport';
export type { WebhookTransport, WebhookTransportRequest, WebhookTransportResponse } from './egress/transport';
export { generateWebhookSecret, signedHeaders } from './signing';
export type { SignedHeadersInput } from './signing';
export { WebhookDeliverHandler, parseRetryAfter, retryDelayMs } from './handlers/webhook-deliver.handler';
export { WebhookFanoutHandler } from './handlers/webhook-fanout.handler';
export { WebhookPurgeHandler } from './handlers/webhook-purge.handler';

// ---- data and secrets ports ------------------------------------------------------------------
export { WEBHOOKS_SYSTEM_PRISMA } from './ports';
export type { WebhooksPrisma, WebhooksSystemPrisma } from './ports';
export { PrismaWebhooksRepository, WebhooksRepository } from './webhooks.repository';
export type { AttemptOutcome, DeliveryPage, DeliveryQuery, LoadedDelivery, EndpointFilter, EndpointPatch, NewDelivery, NewEndpoint, SettledAttempt } from './webhooks.repository';
export { CredentialsWebhookSecrets, WebhookSecrets, secretName } from './webhook-secrets.service';
export type { SecretAddress } from './webhook-secrets.service';
export type {
  WebhookDeliveryRow,
  WebhookEndpointRow,
  WebhookPermissionRef,
  WebhookRolePermission,
  WebhookUserRoleGrant,
  WebhookUserMembership,
  WebhookUserOrg,
  WebhookUserRole,
  WebhookUserRow,
  WebhooksBatchResult,
  WebhooksDelegate,
  WebhooksQueryArgs,
  WebhooksTx,
  WebhooksUserDelegate,
} from './data/webhooks-db';
export { WEBHOOK_SIGNING_CREDENTIAL_PURPOSE_DEF, WEBHOOK_SIGNING_USER_CREDENTIAL_PURPOSE_DEF } from './webhooks.credentials';
export { basePermissionFor, ownerIdOf, ownerMayReceive } from './webhooks.access';

// ---- permissions, errors, metrics -------------------------------------------------------------
export { ORG_WEBHOOKS_PERMISSIONS, SYSTEM_WEBHOOKS_PERMISSIONS, WEBHOOKS_PERMISSIONS } from './webhooks.permissions';
export type { WebhooksPermissionDeclaration } from './webhooks.permissions';
export { WebhookDeliveryNotFoundError, WebhookDisabledError, WebhookNotFoundError, WebhookRequestError, registerWebhookErrorCodes } from './webhooks.errors';
export {
  WEBHOOKS_APP_METRICS,
  WEBHOOK_DELIVERIES_METRIC,
  WEBHOOK_DELIVERY_DURATION_METRIC,
  WEBHOOK_DELIVERY_OUTCOMES,
  WEBHOOK_EMIT_OUTCOMES,
  WEBHOOK_EVENTS_METRIC,
} from './webhooks.metrics';

// ---- notifications -----------------------------------------------------------------------------
export {
  WEBHOOKS_NOTIFICATIONS,
  WEBHOOK_NOTIFICATION_CHANNEL,
  registerWebhooksEmailTemplates,
  webhookEndpointDisabledBrowserTemplate,
  webhookEndpointDisabledEmail,
  withWebhookChannel,
} from './notifications/webhook-notifications';
export type { WebhookBrowserContent, WebhookEndpointDisabledData } from './notifications/webhook-notifications';

// ---- routes (for the app's route discovery and tests) ---------------------------------------
export {
  CreateWebhookEndpointDto,
  RotateWebhookSecretResponseDto,
  UpdateWebhookEndpointDto,
  WebhookDeliveryDetailDto,
  WebhookDeliveryListDto,
  WebhookDeliveryListQueryDto,
  WebhookEndpointCreatedDto,
  WebhookEndpointDto,
  WebhookEndpointListDto,
  WebhookEventCatalogDto,
  WebhookTestResponseDto,
} from './http/webhook.dto';
export { AdminWebhooksController } from './http/admin-webhooks.controller';
export { OrgWebhooksController } from './http/org-webhooks.controller';
export { WebhooksController } from './http/webhooks.controller';
