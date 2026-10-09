/**
 * Where the API lives.
 *
 * EXPORTED as of #127. The notification SSE client (`services/sse.ts`) opens a
 * raw `fetch` outside `ApiService.request` — it has to, because that method
 * buffers a JSON body and an event stream never ends — and it must resolve its
 * URL against exactly the same base. A second literal `'/api'` there would be
 * a same-origin assumption that silently breaks the day `VITE_API_BASE_URL` is
 * set, in the one code path that fails by going quiet rather than by erroring.
 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

import { APP_SLUG } from '@app/shared';

// Issue #258, epic #254. The maintenance recogniser is imported here — and
// nowhere near a page — because the interception is CENTRAL: see `toError`.
import { readMaintenanceBlock, reportMaintenanceBlock } from './maintenance';

import {
  ApiError,
  PlatformHttpClient,
  type PlatformHttpBlobWithHeaders,
  type SessionExpiredListener as PlatformSessionExpiredListener,
} from '@marinoscar/platform-web/core';

/** What `responseType: 'blobWithHeaders'` resolves with. */
export type BlobWithHeaders = PlatformHttpBlobWithHeaders;

/**
 * The Web Lock every page of this app on one origin takes around
 * `POST /auth/refresh`. Derived from the shared identity so two
 * apps built from this template never contend for each other's lock.
 */
export const AUTH_REFRESH_LOCK_NAME = `${APP_SLUG}-auth-refresh`;

/** Called when the server definitively refused to refresh a live session. */
export type SessionExpiredListener = PlatformSessionExpiredListener;

/**
 * The app's transport: `@marinoscar/platform-web/core`'s `PlatformHttpClient`
 * (the token holder, the one-shot 401 -> refresh -> retry and the cross-page
 * refresh lock, moved there by #727) bound to this app's API base, its refresh
 * lock name and its maintenance recogniser.
 *
 * THE MAINTENANCE INTERCEPTION IS CENTRAL (#258, epic #254): every request in
 * this application goes through the client's single error path, which hands
 * each error response to `onErrorResponse` before throwing, so every caller
 * inherits maintenance handling without a line of change. AN ORDINARY 503 IS
 * UNTOUCHED: `readMaintenanceBlock` returns `null` unless the status is 503 AND
 * `details.reason` is the marker (see `services/maintenance.ts`). The error is
 * still THROWN in both cases.
 */
export class ApiService extends PlatformHttpClient {
  constructor() {
    super({
      baseUrl: API_BASE_URL,
      refreshLockName: AUTH_REFRESH_LOCK_NAME,
      onErrorResponse: (status, body) => {
        const block = readMaintenanceBlock(status, body);
        if (block) {
          reportMaintenanceBlock(block);
        }
      },
    });
  }
}

export { ApiError };

export const api = new ApiService();

// Import types
import type {
  NotificationEventDef,
  NotificationConfigResponse,
  PushSubscriptionPayload,
  PushSubscriptionResponse,
  AppNotification,
  NotificationListResponse,
  UnreadCountResponse,
  ProfileImageMutationResponse,
} from '../types';

// Profile picture API — issue #367.

/**
 * Upload the caller's profile picture (one multipart `file` part).
 *
 * The server validates the bytes (JPEG/PNG/GIF/WebP, max 5 MB) and answers 400
 * or 413 with a message otherwise. On success it stores the image, switches
 * `profile.imageSource` to `'upload'` and deletes any previous upload, so the
 * caller must adopt the returned `settings` (new `version`).
 */
export async function uploadProfileImage(file: File): Promise<ProfileImageMutationResponse> {
  const formData = new FormData();
  formData.append('file', file);
  return api.postFormData<ProfileImageMutationResponse>(
    '/user-settings/profile-image',
    formData,
  );
}

/**
 * Remove the caller's uploaded picture. A source of `'upload'` falls back to
 * `'provider'` server-side; the returned `settings` must be adopted.
 */
export async function deleteProfileImage(): Promise<ProfileImageMutationResponse> {
  return api.delete<ProfileImageMutationResponse>('/user-settings/profile-image');
}

/**
 * Fetch the caller's stored uploaded picture, whatever `profile.imageSource`
 * currently selects, for previewing it in settings. Authenticated on purpose:
 * the public `/users/:id/avatar/:objectId` route only serves a picture while
 * it is the selected source. Rejects with a 404 `ApiError` when none exists.
 */
export async function fetchProfileImagePreview(): Promise<Blob> {
  return api.getBlob('/user-settings/profile-image');
}

// Email settings API (issue #124): in `@marinoscar/platform-web/email/headless`
// since #737, through the platform host's transport.

/**
 * The notification event registry — `GET /api/notifications/events` (#124).
 *
 * AUTHENTICATED, NOT ADMIN-GATED. Every signed-in user reads this; it is what
 * `/settings/notifications` renders its matrix against, and that page belongs
 * to every role. A `system_settings:read` reflex here would leave a Viewer with
 * a preferences page and no rows in it.
 *
 * THE WEB APP DOES NOT KEEP A COPY OF THIS LIST, deliberately. `mandatory` is a
 * security flag, and a second declaration of a security flag is a second place
 * for it to be wrong; a duplicated registry would also break epic #109's
 * headline promise that adding a notification costs ONE registry entry. The
 * consequence is that the preferences page renders whatever the server serves,
 * including events added after this build shipped.
 *
 * The response is ORDERED and the order is meaningful — it is the order the
 * preferences UI should render. Do not sort it.
 */
export async function getNotificationEvents(): Promise<NotificationEventDef[]> {
  return api.get<NotificationEventDef[]>('/notifications/events');
}

/**
 * This deployment's client-facing notification capabilities —
 * `GET /api/notifications/config` (#226, epic #215).
 *
 * AUTHENTICATED, NOT ADMIN-GATED — like `getNotificationEvents` above, and for
 * an analogous reason. `GET /api/system-settings` requires `system_settings:read`,
 * which the seeded `viewer` and `contributor` roles do not hold, so it cannot be
 * the source for a toggle those very roles need to render correctly. This
 * endpoint is a narrow, purpose-built projection — three booleans-worth of
 * capability, no policy detail (`disabledEvents` in particular never appears
 * here; the per-event answer arrives with the event, as the stream's `toast`
 * flag) — readable by any authenticated user. See the DTO's own header
 * (`apps/api/src/notifications/dto/notification-config.dto.ts`) for the full
 * argument, including why widening `system_settings:read` instead was rejected.
 *
 * Consumed by `useNotificationCapability`'s `adminDisabled` option (#227), as
 * `!browserEnabled`, so a client can withhold the "Allow notifications" prompt
 * on a deployment that has turned browser notifications off entirely rather
 * than spend a user's one-shot permission decision on a feature this
 * deployment does not offer.
 */
export async function getNotificationConfig(): Promise<NotificationConfigResponse> {
  return api.get<NotificationConfigResponse>('/notifications/config');
}

/**
 * Register (or refresh) this browser's push subscription for the caller (#365).
 *
 * Upserted by `endpoint` server-side, so calling this on every boot is the
 * self-heal, not a duplicate. `409` when the deployment has push disabled.
 */
export async function subscribePushNotifications(
  subscription: PushSubscriptionPayload,
): Promise<PushSubscriptionResponse> {
  return api.post<PushSubscriptionResponse>('/notifications/push/subscriptions', subscription);
}

/**
 * Remove this browser's push subscription for the caller (#365). A `DELETE`
 * with a JSON body: the endpoint URL is the only handle on the row. `404` when
 * the caller has no such subscription.
 */
export async function unsubscribePushNotifications(endpoint: string): Promise<void> {
  return api.delete<void>('/notifications/push/subscriptions', {
    body: JSON.stringify({ endpoint }),
  });
}

// Notification centre API — issue #127, epic #109.
//
// The four REST calls behind the bell. The fifth endpoint of this controller —
// `GET /api/notifications/stream` — is deliberately NOT here: it is an
// unbounded `text/event-stream` and `ApiService.request` awaits `response.json()`,
// which on a stream that never ends never resolves. It lives in
// `services/notificationStream.ts` on top of the fetch-based SSE client.
//
// NOT ONE OF THESE CALLS NAMES A USER, in a path, a query or a body. Every one
// operates on the authenticated caller's own rows, resolved server-side from
// the JWT (`@CurrentUser('id')`). There is no `?userId=` to add here, and
// adding one would not work: the API has no parameter for it, by design — see
// the header of `apps/api/src/notifications/notifications.controller.ts`.

/**
 * A page of the caller's notifications, newest first.
 *
 * THE DURABLE SURFACE. This is correct whether or not the user ever granted
 * browser-notification permission and whether or not the SSE stream was
 * connected when a notification was raised, which is why the centre is built on
 * it and the native toast is decoration on top.
 *
 * `unreadOnly` is sent as the STRING `'true'`/`'false'`, matching the API's
 * schema exactly. It is an explicit enum there rather than a coerced boolean
 * because `z.coerce.boolean()` follows JS truthiness and would turn the string
 * `'false'` into `true`, inverting the filter — so the spelling here is
 * load-bearing rather than stylistic.
 */
export async function getNotifications(params?: {
  page?: number;
  pageSize?: number;
  unreadOnly?: boolean;
}): Promise<NotificationListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  // `!== undefined`, not truthiness: `false` is a meaningful value to send.
  if (params?.unreadOnly !== undefined) {
    searchParams.set('unreadOnly', params.unreadOnly ? 'true' : 'false');
  }

  return api.get<NotificationListResponse>(`/notifications?${searchParams}`);
}

/**
 * The badge number.
 *
 * A DEDICATED ENDPOINT, not something counted out of a page of
 * `getNotifications`: a count taken from a page silently caps at `pageSize`, so
 * a user with 30 unread would see "20" and never learn otherwise. Call it on
 * mount and again on every SSE (re)connect.
 */
export async function getUnreadNotificationCount(): Promise<UnreadCountResponse> {
  return api.get<UnreadCountResponse>('/notifications/unread-count');
}

/**
 * Mark one notification read.
 *
 * RETURNS THE NEW UNREAD COUNT, which is the whole reason this is worth a round
 * trip: the caller already holds the row it just marked, so the count is the
 * only thing it cannot compute for itself. DO NOT follow this with a call to
 * `getUnreadNotificationCount` — that is the two-round-trip shape the API was
 * built to avoid.
 *
 * Idempotent server-side; marking an already-read notification succeeds and
 * leaves the original `readAt` alone. A 404 means "no such notification FOR
 * THIS USER" — an id belonging to somebody else is indistinguishable from one
 * that does not exist, deliberately, so the endpoint cannot be used to probe
 * for valid ids.
 */
export async function markNotificationRead(id: string): Promise<UnreadCountResponse> {
  return api.post<UnreadCountResponse>(`/notifications/${id}/read`);
}

/**
 * Clear the badge in one call, returning the resulting count.
 *
 * The count is REPORTED, not assumed to be zero: a notification arriving
 * between the update and the count is reflected honestly rather than hidden
 * behind a hardcoded `0`. Callers must use the returned number and never
 * `setUnreadCount(0)`.
 */
export async function markAllNotificationsRead(): Promise<UnreadCountResponse> {
  return api.post<UnreadCountResponse>('/notifications/read-all');
}

/** Re-exported for consumers that only import from this module. */
export type { AppNotification };

// The maintenance (`GET`/`PUT /admin/maintenance`) and about (`GET /admin/about`)
// calls moved to `@marinoscar/platform-web/host/headless` (`createHostApi`, #891).

