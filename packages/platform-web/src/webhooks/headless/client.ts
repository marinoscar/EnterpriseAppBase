// =============================================================================
// The webhooks client (issue #1046): one route family per scope
// =============================================================================
//
// The three scopes share one route shape under three bases:
//   user   -> /api/webhooks        (`webhooks:read` / `webhooks:write`)
//   org    -> /api/org/webhooks    (`org_webhooks:read` / `org_webhooks:write`)
//   system -> /api/admin/webhooks  (`system_webhooks:read` / `system_webhooks:write`)
// The transport (`PlatformApiClient`) prefixes `/api`. The API decides who may
// see what (another owner's endpoint is a 404); the client only builds paths.
// =============================================================================

import { WEBHOOK_PERMISSIONS } from '@marinoscar/platform-contract/webhooks';
import type {
  CreateWebhookEndpointInput,
  RotateWebhookSecretResponse,
  UpdateWebhookEndpoint,
  WebhookDeliveryDetail,
  WebhookDeliveryList,
  WebhookDeliveryStatus,
  WebhookEndpoint,
  WebhookEndpointCreated,
  WebhookEndpointList,
  WebhookEventCatalog,
  WebhookScope,
  WebhookTestResponse,
} from '@marinoscar/platform-contract/webhooks';

import type { PlatformApiClient } from '../../core/index.js';

/**
 * The route base of each scope, relative to the API root (`/api`).
 *
 * @stability experimental
 */
export const WEBHOOK_SCOPE_BASE_PATHS: Readonly<Record<WebhookScope, string>> = Object.freeze({
  user: '/webhooks',
  org: '/org/webhooks',
  system: '/admin/webhooks',
});

/**
 * The read and write permission each scope's routes enforce: the exact
 * strings of `WEBHOOK_PERMISSIONS` (`@marinoscar/platform-contract/webhooks`).
 * The UI only hides controls with them; the API enforces them.
 *
 * @stability experimental
 */
export const WEBHOOK_SCOPE_PERMISSIONS: Readonly<
  Record<
    WebhookScope,
    {
      /** The permission the scope's reads enforce. */
      readonly read: string;
      /** The permission the scope's writes enforce. */
      readonly write: string;
    }
  >
> =
  Object.freeze({
    user: Object.freeze({ read: WEBHOOK_PERMISSIONS.READ, write: WEBHOOK_PERMISSIONS.WRITE }),
    org: Object.freeze({ read: WEBHOOK_PERMISSIONS.ORG_READ, write: WEBHOOK_PERMISSIONS.ORG_WRITE }),
    system: Object.freeze({ read: WEBHOOK_PERMISSIONS.SYSTEM_READ, write: WEBHOOK_PERMISSIONS.SYSTEM_WRITE }),
  });

/**
 * The filters and page of a delivery list request. `page` is one-based, as
 * on the wire.
 *
 * @stability experimental
 */
export interface WebhookDeliveriesQuery {
  /** One-based page; default 1. */
  page?: number;
  /** Rows per page; default the API's (20). */
  pageSize?: number;
  /** Only deliveries in this status. */
  status?: WebhookDeliveryStatus;
  /** Only deliveries of this event key. */
  eventKey?: string;
}

/**
 * The webhook API calls of one scope.
 *
 * @stability experimental
 */
export interface WebhooksApi {
  /** The scope these calls address. */
  readonly scope: WebhookScope;
  /** The route base, e.g. `/org/webhooks`. */
  readonly basePath: string;
  /** `GET <base>`: the endpoints the caller may see at this scope. */
  list(): Promise<WebhookEndpointList>;
  /** `GET <base>/:id`. */
  get(id: string): Promise<WebhookEndpoint>;
  /** `POST <base>`: resolves with the endpoint and its signing secret, shown once. */
  create(input: CreateWebhookEndpointInput): Promise<WebhookEndpointCreated>;
  /** `PATCH <base>/:id`. */
  update(id: string, patch: UpdateWebhookEndpoint): Promise<WebhookEndpoint>;
  /** `DELETE <base>/:id`. */
  remove(id: string): Promise<void>;
  /** `POST <base>/:id/rotate-secret`: the new secret, shown once, and the old one's overlap. */
  rotateSecret(id: string): Promise<RotateWebhookSecretResponse>;
  /** `POST <base>/:id/test`: queues a `webhooks.ping` delivery. */
  sendTest(id: string): Promise<WebhookTestResponse>;
  /** `GET <base>/:id/deliveries?page&pageSize&status&eventKey`. */
  listDeliveries(endpointId: string, query?: WebhookDeliveriesQuery): Promise<WebhookDeliveryList>;
  /** `GET <base>/deliveries/:deliveryId`: with the payload and the request headers (never the signature). */
  getDelivery(deliveryId: string): Promise<WebhookDeliveryDetail>;
  /** `POST <base>/deliveries/:deliveryId/redeliver`: queues the delivery again. */
  redeliver(deliveryId: string): Promise<void>;
  /** `GET <base>/events`: the events the caller may subscribe to at this scope. */
  eventCatalog(): Promise<WebhookEventCatalog>;
}

/**
 * The route base of a scope.
 *
 * @param scope - `user`, `org` or `system`.
 * @returns the path relative to `/api`.
 *
 * @stability experimental
 */
export function webhooksBasePath(scope: WebhookScope): string {
  return WEBHOOK_SCOPE_BASE_PATHS[scope];
}

function deliveriesQueryString(query: WebhookDeliveriesQuery | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize));
  if (query.status) params.set('status', query.status);
  if (query.eventKey) params.set('eventKey', query.eventKey);
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

/**
 * The webhooks client of one scope over the app's transport.
 *
 * @param api - the app's transport (`usePlatformApi()`).
 * @param scope - which route family to address.
 * @returns the client.
 *
 * @example
 * ```ts
 * const webhooks = createWebhooksApi(usePlatformApi(), 'org');
 * const { endpoint, secret } = await webhooks.create({
 *   name: 'Receiver',
 *   url: 'https://receiver.example.test/hook',
 *   eventKeys: ['nodes.*'],
 * });
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function createWebhooksApi(api: PlatformApiClient, scope: WebhookScope): WebhooksApi {
  const base = webhooksBasePath(scope);
  const one = (id: string) => `${base}/${encodeURIComponent(id)}`;
  const delivery = (id: string) => `${base}/deliveries/${encodeURIComponent(id)}`;
  return {
    scope,
    basePath: base,
    list: () => api.get<WebhookEndpointList>(base),
    get: (id) => api.get<WebhookEndpoint>(one(id)),
    create: (input) => api.post<WebhookEndpointCreated>(base, input),
    update: (id, patch) => api.patch<WebhookEndpoint>(one(id), patch),
    remove: async (id) => {
      await api.delete<unknown>(one(id));
    },
    rotateSecret: (id) => api.post<RotateWebhookSecretResponse>(`${one(id)}/rotate-secret`),
    sendTest: (id) => api.post<WebhookTestResponse>(`${one(id)}/test`),
    listDeliveries: (endpointId, query) =>
      api.get<WebhookDeliveryList>(`${one(endpointId)}/deliveries${deliveriesQueryString(query)}`),
    getDelivery: (deliveryId) => api.get<WebhookDeliveryDetail>(delivery(deliveryId)),
    redeliver: async (deliveryId) => {
      await api.post<unknown>(`${delivery(deliveryId)}/redeliver`);
    },
    eventCatalog: () => api.get<WebhookEventCatalog>(`${base}/events`),
  };
}
