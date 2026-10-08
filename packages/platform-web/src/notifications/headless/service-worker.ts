// =============================================================================
// The notifications half of an app's service worker (issue #738; behaviour
// from #222, #223, #230 and #618, moved from the reference app's `src/sw.ts`)
// =============================================================================
//
// The app keeps its own `sw.ts` (the precache manifest, the SPA fallback, the
// update handshake are the app's), and calls
// {@link registerNotificationServiceWorkerHandlers} once from it, which adds
// the `push`, `notificationclick` and `pushsubscriptionchange` listeners
// below. The handlers are also exported one by one for an app that composes
// its own listeners.
//
// -----------------------------------------------------------------------
// HARD CONSTRAINT: THESE HANDLERS NEVER CALL THE API
// -----------------------------------------------------------------------
//
// A worker has no way to authenticate: the access token is memory-only in the
// page, and the refresh cookie is rotated on every use, so a worker that
// refreshed on its own would spend the page's one-shot refresh token and log
// the user out. Anything a handler needs arrives in the push payload, and
// every API call a click implies (mark read) is handed to a page that holds a
// token (`postMessage`, or the `?n=` query param on a cold open, both read by
// `NotificationProvider`).
//
// THE SCOPE IS STRUCTURAL. This module is compiled with the DOM library, not
// the WebWorker one, so it names only the members it calls
// ({@link NotificationsServiceWorkerScope}); an app's
// `ServiceWorkerGlobalScope` (`self`) is assignable to it as it is.
// =============================================================================

import { isInternalLink } from './internalLink.js';

/**
 * The payload the API's push channel sends as the Web Push message body
 * (JSON, under the 4 KB push payload limit). `id` and `link` ride into
 * `notification.data` for the click handler.
 *
 * @stability experimental
 */
export interface NotificationPushPayload {
  /** The notification row's id (`''` for a test push). */
  id: string;
  /** The event key. */
  eventKey: string;
  /** The title. */
  title: string;
  /** The body. */
  body: string;
  /** A root-relative link (re-validated before any navigation). */
  link: string;
  /** Set only by the admin "Send test push" action (#618). */
  test?: boolean;
}

/**
 * The options `showNotification` takes, as the handlers pass them.
 *
 * @stability experimental
 */
export interface NotificationsShowOptions {
  /** The body text. */
  body?: string;
  /** The de-dup tag. */
  tag?: string;
  /** The icon URL. */
  icon?: string;
  /** The status-bar badge URL. */
  badge?: string;
  /** Data handed to the click handler. */
  data?: unknown;
}

/**
 * A window client, as the click handler and the test-push ack see it.
 *
 * @stability experimental
 */
export interface NotificationsServiceWorkerClient {
  /** The client's URL. */
  readonly url: string;
  /** Posts a message to the page. */
  postMessage(message: unknown): void;
}

/**
 * The members of a `ServiceWorkerGlobalScope` the handlers call.
 *
 * @stability experimental
 */
export interface NotificationsServiceWorkerScope {
  /** The worker's registration. */
  readonly registration: {
    /** Shows an OS notification. */
    showNotification(title: string, options?: NotificationsShowOptions): Promise<void>;
    /** The push manager (resubscription). */
    readonly pushManager: {
      /** Subscribes this browser to push. */
      subscribe(options: { applicationServerKey: BufferSource | string | null; userVisibleOnly: boolean }): Promise<unknown>;
    };
  };
  /** The worker's clients. */
  readonly clients: {
    /** The open window clients. */
    matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<ReadonlyArray<NotificationsServiceWorkerClient>>;
    /** Opens a new window at a URL. */
    openWindow(url: string): Promise<unknown>;
  };
  /**
   * Adds an event listener. The event is untyped here: the worker's own
   * overloads type it per event name, which a structural shape cannot repeat.
   */
  addEventListener(type: string, listener: (event: any) => void): void;
}

/**
 * An event the worker must keep alive until its work settles.
 *
 * @stability experimental
 */
export interface NotificationsExtendableEvent {
  /** Keeps the worker alive until the promise settles. */
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * A `push` event, as {@link handlePushEvent} reads it.
 *
 * @stability experimental
 */
export interface NotificationsPushEvent extends NotificationsExtendableEvent {
  /** The message data, or null for an empty push. */
  readonly data: {
    /** The payload, parsed as JSON (throws on malformed JSON). */
    json(): unknown;
  } | null;
}

/**
 * A `notificationclick` event, as {@link handleNotificationClick} reads it.
 *
 * @stability experimental
 */
export interface NotificationsClickEvent extends NotificationsExtendableEvent {
  /** The clicked notification. */
  readonly notification: {
    /** Dismisses it. */
    close(): void;
    /** The data it was shown with (`{ id, link }`). */
    readonly data: unknown;
  };
}

/**
 * A `pushsubscriptionchange` event. `oldSubscription` is in the Push API spec
 * and missing from TypeScript's own lib.
 *
 * @stability experimental
 */
export interface NotificationsPushSubscriptionChangeEvent extends NotificationsExtendableEvent {
  /** The subscription that changed, or null. */
  readonly oldSubscription?: {
    /** The options it was created with. */
    readonly options?: {
      /** The VAPID key it was created with. */
      readonly applicationServerKey?: ArrayBuffer | null;
    };
  } | null;
}

/**
 * The icons a push notification shows.
 *
 * @stability experimental
 */
export interface NotificationServiceWorkerOptions {
  /** The notification icon. Default `/icons/icon-192.png`. */
  icon?: string;
  /** The status-bar badge. Default `/icons/badge-96.png`. */
  badge?: string;
}

/** The message a page receives for a click on a worker-shown notification. */
const CLICK_MESSAGE = 'notification-click';
/** The message a page receives when a test push arrived. */
const TEST_ACK_MESSAGE = 'push-test-received';

function iconsOf(options: NotificationServiceWorkerOptions | undefined): { icon: string; badge: string } {
  return { icon: options?.icon ?? '/icons/icon-192.png', badge: options?.badge ?? '/icons/badge-96.png' };
}

/**
 * Handles a `notificationclick`: closes the notification, re-validates its
 * link (root-relative only, `//` rejected; anything else falls back to `/`),
 * then focuses an open window and posts it the click, or opens a new window
 * with the id in a `?n=` query param. Never calls the API.
 *
 * @param scope - the worker's global scope (`self`).
 * @param event - the click event.
 *
 * @example
 * ```ts
 * self.addEventListener('notificationclick', (event) => handleNotificationClick(self, event));
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function handleNotificationClick(scope: NotificationsServiceWorkerScope, event: NotificationsClickEvent): void {
  // Dismissed first: left open, the OS lets it be clicked again while this runs.
  event.notification.close();

  const data = (event.notification.data ?? {}) as { id?: unknown; link?: unknown };
  const id = typeof data.id === 'string' ? data.id : '';
  const rawLink = typeof data.link === 'string' ? data.link : null;
  const link = isInternalLink(rawLink) ? rawLink : '/';

  event.waitUntil(
    (async () => {
      // `includeUncontrolled`: a tab open before this worker activated is not
      // controlled by it, and would otherwise read as a cold open.
      const windowClients = (await scope.clients.matchAll({ type: 'window', includeUncontrolled: true })) as ReadonlyArray<
        NotificationsServiceWorkerClient & { focus(): Promise<unknown> }
      >;
      if (windowClients.length > 0) {
        const linkPath = link.split('?')[0];
        const target =
          windowClients.find((client) => {
            try {
              return new URL(client.url).pathname === linkPath;
            } catch {
              return false;
            }
          }) ?? windowClients[0]!;
        await target.focus();
        target.postMessage({ type: CLICK_MESSAGE, id, link });
        return;
      }
      const separator = link.includes('?') ? '&' : '?';
      await scope.clients.openWindow(`${link}${separator}n=${encodeURIComponent(id)}`);
    })(),
  );
}

async function showTestPush(
  scope: NotificationsServiceWorkerScope,
  payload: NotificationPushPayload,
  icons: { icon: string; badge: string },
): Promise<void> {
  const windowClients = (await scope.clients.matchAll({ type: 'window', includeUncontrolled: true })) as ReadonlyArray<
    NotificationsServiceWorkerClient & { visibilityState?: string; focused?: boolean }
  >;
  const hadFocusedClient = windowClients.some((client) => client.visibilityState === 'visible' && client.focused === true);

  let shown = false;
  let error: string | undefined;
  try {
    await scope.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.id,
      ...icons,
      // `id: ''`: a test names no notification row, so nothing is marked read.
      data: { id: '', link: payload.link, test: true },
    });
    shown = true;
  } catch (err) {
    error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  const ack = {
    type: TEST_ACK_MESSAGE,
    id: payload.id,
    receivedAt: Date.now(),
    shown,
    hadFocusedClient,
    ...(error ? { error } : {}),
  };
  for (const client of windowClients) {
    try {
      client.postMessage(ack);
    } catch {
      // One client refusing the message must not stop the others hearing it.
    }
  }
}

/**
 * Handles a `push`: shows the payload as an OS notification, ALWAYS (a
 * focused tab raises no toast of its own for a pushed event, so the worker
 * staying quiet would leave the user with nothing). A malformed payload shows
 * a generic notification: a push that shows nothing makes Chrome show its own
 * "updated in the background" notice instead. A test push (#618) is shown
 * and then acknowledged to every window client.
 *
 * @param scope - the worker's global scope (`self`).
 * @param event - the push event.
 * @param options - the icons.
 * @returns when the notification is shown; pass it to `event.waitUntil`.
 *
 * @example
 * ```ts
 * self.addEventListener('push', (event) => event.waitUntil(handlePushEvent(self, event)));
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export async function handlePushEvent(
  scope: NotificationsServiceWorkerScope,
  event: NotificationsPushEvent,
  options?: NotificationServiceWorkerOptions,
): Promise<void> {
  const icons = iconsOf(options);
  let payload: NotificationPushPayload;
  try {
    if (!event.data) throw new Error('push event carried no data');
    payload = event.data.json() as NotificationPushPayload;
  } catch {
    await scope.registration.showNotification('New notification', {
      body: 'You have a new notification',
      ...icons,
      tag: 'push-fallback',
    });
    return;
  }

  if (payload.test === true) {
    await showTestPush(scope, payload, icons);
    return;
  }

  await scope.registration.showNotification(payload.title, {
    body: payload.body,
    // Keyed by the notification id: repeated pushes of one row collapse.
    tag: payload.id,
    ...icons,
    data: { id: payload.id, link: payload.link },
  });
}

/**
 * Handles a `pushsubscriptionchange`: resubscribes with the old
 * subscription's key, best effort. Never POSTs the new subscription (no token
 * here); the page re-syncs on its next load, which is the real mechanism.
 *
 * @param scope - the worker's global scope (`self`).
 * @param event - the change event.
 * @returns when the attempt settles; never rejects.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export async function handlePushSubscriptionChange(
  scope: NotificationsServiceWorkerScope,
  event: NotificationsPushSubscriptionChangeEvent,
): Promise<void> {
  const applicationServerKey = event.oldSubscription?.options?.applicationServerKey;
  if (!applicationServerKey) return;
  try {
    await scope.registration.pushManager.subscribe({ applicationServerKey, userVisibleOnly: true });
  } catch (error) {
    console.warn('Service worker push resubscription failed; page will resync on next load.', error);
  }
}

/**
 * Adds the three notification listeners (`push`, `notificationclick`,
 * `pushsubscriptionchange`) to the worker. Call it once from the app's
 * `sw.ts`.
 *
 * @param scope - the worker's global scope (`self`).
 * @param options - the push notification icons.
 *
 * @example
 * ```ts
 * // apps/web/src/sw.ts
 * registerNotificationServiceWorkerHandlers(self, { icon: '/icons/icon-192.png', badge: '/icons/badge-96.png' });
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function registerNotificationServiceWorkerHandlers(
  scope: NotificationsServiceWorkerScope,
  options?: NotificationServiceWorkerOptions,
): void {
  scope.addEventListener('notificationclick', (event: NotificationsClickEvent) => {
    handleNotificationClick(scope, event);
  });
  scope.addEventListener('push', (event: NotificationsPushEvent) => {
    event.waitUntil(handlePushEvent(scope, event, options));
  });
  scope.addEventListener('pushsubscriptionchange', (event: NotificationsPushSubscriptionChangeEvent) => {
    event.waitUntil(handlePushSubscriptionChange(scope, event));
  });
}
