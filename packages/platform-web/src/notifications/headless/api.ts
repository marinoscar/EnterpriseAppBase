// =============================================================================
// The notifications web slice's API client and its configuration (issue #738)
// =============================================================================
//
// The slice's services are plain module functions (the logout path and the
// push diagnostics call them outside React), so they reach the API through a
// client the APP configures once at startup, with
// {@link configureNotificationsWeb}: the reference app passes its
// `PlatformHttpClient` (`services/api.ts`, the same bearer token and refresh
// as every other call), the API base URL and its SSE connector. A service
// called before configuration throws, naming the fix.
//
// The functions below are the inbox, events, config and push-subscription
// calls the reference app's `services/api.ts` used to hold, unchanged.
// =============================================================================

import { ApiError } from '../../core/index.js';
import type {
  NotificationConfigResponse,
  NotificationEventDef,
  NotificationListResponse,
  PushSubscriptionPayload,
  PushSubscriptionResponse,
  UnreadCountResponse,
} from './types.js';
import type { SseConnection, SseOptions } from './sse.js';

export { ApiError };

/**
 * Per-request options the slice passes: `headers` (an `If-Match`) and, for a
 * `DELETE` with a JSON body, `body`. A `RequestInit` subset, so the reference
 * app's `PlatformHttpClient` is assignable as it is.
 *
 * @stability experimental
 */
export interface NotificationsRequestOptions {
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** A pre-serialised JSON body (`DELETE` only). */
  body?: string;
  /** Cancels the request. */
  signal?: AbortSignal;
}

/**
 * The HTTP client the slice calls: JSON in, the unwrapped `data` envelope
 * out, an `ApiError` (of `@marinoscar/platform-web/core`) thrown for a non-2xx
 * answer.
 *
 * @stability experimental
 */
export interface NotificationsApiClient {
  /** `GET path`. */
  get<T>(path: string, options?: NotificationsRequestOptions): Promise<T>;
  /** `POST path` with an optional JSON body. */
  post<T>(path: string, body?: unknown, options?: NotificationsRequestOptions): Promise<T>;
  /** `PUT path` with a JSON body. */
  put<T>(path: string, body?: unknown, options?: NotificationsRequestOptions): Promise<T>;
  /** `DELETE path`, optionally with a JSON body in `options.body`. */
  delete<T>(path: string, options?: NotificationsRequestOptions): Promise<T>;
  /** The current access token, for the SSE stream's `Authorization` header. */
  getAccessToken?(): string | null;
  /** Refreshes the session after a 401; resolves whether it worked. */
  refreshToken?(): Promise<boolean>;
}

/**
 * What an app hands {@link configureNotificationsWeb}.
 *
 * @stability experimental
 */
export interface NotificationsWebConfig {
  /** The API client (the reference app's `api`). */
  api: NotificationsApiClient;
  /** The API's base URL, for the SSE stream (`/api` by default). */
  apiBaseUrl?: string;
  /**
   * Opens a GET Server-Sent Events connection with the bearer token and
   * reconnects (the reference app's `services/sse.ts` `connectSse`). Without
   * it the inbox still loads, but no live stream opens.
   */
  connectSse?: (options: SseOptions) => SseConnection;
}

let config: NotificationsWebConfig | null = null;

/**
 * Configures the slice once, at app startup, before anything renders: the
 * API client, the base URL and the SSE connector.
 *
 * @param next - the configuration.
 *
 * @example
 * ```ts
 * configureNotificationsWeb({ api, apiBaseUrl: API_BASE_URL, connectSse });
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export function configureNotificationsWeb(next: NotificationsWebConfig): void {
  config = { ...next };
}

/**
 * The configuration in force.
 *
 * @returns it.
 * @throws Error when {@link configureNotificationsWeb} never ran.
 *
 * @stability experimental
 */
export function notificationsWebConfig(): NotificationsWebConfig {
  if (!config) {
    throw new Error(
      '@marinoscar/platform-web/notifications: call configureNotificationsWeb({ api, apiBaseUrl, connectSse }) at startup.',
    );
  }
  return config;
}

/** The API's base URL (`/api` until configured otherwise). */
export function apiBaseUrl(): string {
  return config?.apiBaseUrl ?? '/api';
}

/**
 * The configured client, as the slice's services call it.
 *
 * @stability experimental
 */
export const api: NotificationsApiClient = {
  get: (path, options) => notificationsWebConfig().api.get(path, options),
  post: (path, body, options) => notificationsWebConfig().api.post(path, body, options),
  put: (path, body, options) => notificationsWebConfig().api.put(path, body, options),
  delete: (path, options) => notificationsWebConfig().api.delete(path, options),
  getAccessToken: () => notificationsWebConfig().api.getAccessToken?.() ?? null,
  refreshToken: () => notificationsWebConfig().api.refreshToken?.() ?? Promise.resolve(false),
};

/**
 * `GET /api/notifications/events`: the registry, narrowed by the caller's policy.
 *
 * @returns the events.
 *
 * @stability experimental
 */
export async function getNotificationEvents(): Promise<NotificationEventDef[]> {
  return api.get<NotificationEventDef[]>('/notifications/events');
}

/**
 * `GET /api/notifications/config`.
 *
 * @returns the capabilities for the caller.
 *
 * @stability experimental
 */
export async function getNotificationConfig(): Promise<NotificationConfigResponse> {
  return api.get<NotificationConfigResponse>('/notifications/config');
}

/**
 * `POST /api/notifications/push/subscriptions`.
 *
 * @param subscription - the browser's subscription.
 * @returns the stored row.
 *
 * @stability experimental
 */
export async function subscribePushNotifications(subscription: PushSubscriptionPayload): Promise<PushSubscriptionResponse> {
  return api.post<PushSubscriptionResponse>('/notifications/push/subscriptions', subscription);
}

/**
 * `DELETE /api/notifications/push/subscriptions`.
 *
 * @param endpoint - the subscription's endpoint.
 *
 * @stability experimental
 */
export async function unsubscribePushNotifications(endpoint: string): Promise<void> {
  return api.delete<void>('/notifications/push/subscriptions', { body: JSON.stringify({ endpoint }) });
}

/**
 * `GET /api/notifications`: one page of the caller's inbox.
 *
 * @param params - page, page size, unread only.
 * @returns the page.
 *
 * @stability experimental
 */
export async function getNotifications(params?: {
  page?: number;
  pageSize?: number;
  unreadOnly?: boolean;
}): Promise<NotificationListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  if (params?.unreadOnly !== undefined) searchParams.set('unreadOnly', params.unreadOnly ? 'true' : 'false');
  return api.get<NotificationListResponse>(`/notifications?${searchParams}`);
}

/**
 * `GET /api/notifications/unread-count`.
 *
 * @returns the count.
 *
 * @stability experimental
 */
export async function getUnreadNotificationCount(): Promise<UnreadCountResponse> {
  return api.get<UnreadCountResponse>('/notifications/unread-count');
}

/**
 * `POST /api/notifications/:id/read`.
 *
 * @param id - the notification.
 * @returns the new unread count.
 *
 * @stability experimental
 */
export async function markNotificationRead(id: string): Promise<UnreadCountResponse> {
  return api.post<UnreadCountResponse>(`/notifications/${id}/read`);
}

/**
 * `POST /api/notifications/read-all`.
 *
 * @returns the new unread count (zero).
 *
 * @stability experimental
 */
export async function markAllNotificationsRead(): Promise<UnreadCountResponse> {
  return api.post<UnreadCountResponse>('/notifications/read-all');
}
