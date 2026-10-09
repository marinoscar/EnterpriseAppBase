/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

// =============================================================================
// The service worker  (issue #218, epic #215)
// =============================================================================
//
// WHY THIS FILE EXISTS AT ALL
//
// Not for offline support — that is the bonus. On ANDROID CHROME the
// Notifications API is service-worker-only: `new Notification()` throws
// (`Illegal constructor`), and `ServiceWorkerRegistration.showNotification()`
// is the single code path that can put a notification on the screen. Without
// this file every Android phone and tablet gets nothing from epic #215, no
// matter what the permission prompt says. It is also the only place the
// `push`, `notificationclick` and `pushsubscriptionchange` handlers of issues
// #223 and #230 can live — a page cannot host them.
//
// Offline precaching of the app shell rides along for free, because the epic
// opted into it and the precache manifest is generated either way.
//
// -----------------------------------------------------------------------
// HARD CONSTRAINT: THIS WORKER MUST NEVER CALL THE API
// -----------------------------------------------------------------------
//
// It has no way to authenticate, and any attempt to acquire that ability
// breaks the page. The access token is MEMORY-ONLY — it lives in a private
// field of the `ApiClient` instance in `src/services/api.ts` and is never
// written to storage the worker can read — and the refresh cookie is scoped to
// `path: '/api/auth'` and ROTATED ON EVERY USE. So a worker that tried to
// refresh on its own would spend the one-shot refresh token behind the page's
// back; the page's next refresh would then present a token the server has
// already retired, and the user would be logged out by their own service
// worker. Anything the worker needs from the API must be pushed TO it (a Web
// Push payload, or a `postMessage` from a page that already holds a token),
// never fetched BY it.
//
// -----------------------------------------------------------------------
// SECURITY: NOTHING UNDER `/api` MAY EVER BE CACHED
// -----------------------------------------------------------------------
//
// Cache Storage is origin-scoped and outlives the session: it is not cleared
// by logout, and it is not partitioned per account. Precaching or
// runtime-caching an authenticated JSON response therefore leaves one user's
// data readable by the NEXT person to sign in on a shared device, long after
// the token that fetched it expired. There is deliberately no runtime caching
// strategy registered below for that reason, and `globPatterns` in
// `vite.config.ts` only ever matches built static assets, which never include
// `/api` because the API is a different service entirely.
// =============================================================================

import { registerNotificationServiceWorkerHandlers } from '@marinoscar/platform-web/notifications/service-worker';

declare let self: ServiceWorkerGlobalScope;

// -----------------------------------------------------------------------------
// Precache the app shell
// -----------------------------------------------------------------------------
// `self.__WB_MANIFEST` is replaced at build time by vite-plugin-pwa with the
// list of built assets (see `injectManifest.globPatterns` in `vite.config.ts`).
// `cleanupOutdatedCaches()` deletes precaches left by PREVIOUS revisions of
// this worker; without it every deploy grows Cache Storage by another full copy
// of the bundle until the browser evicts the origin wholesale.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// -----------------------------------------------------------------------------
// SPA navigation fallback
// -----------------------------------------------------------------------------
// Every in-app route (`/settings`, `/admin/settings/users`, …) is a client-side
// path with no file behind it, so a navigation request is answered from the
// precached `index.html` — the same job `try_files $uri $uri/ /index.html` does
// in `apps/web/nginx.conf`, done offline.
//
// THE DENYLIST IS LOAD-BEARING, AND `/api/notifications/stream` IS WHY.
//
// `/^\/api\//` keeps the worker out of the API's URL space entirely. Do not
// narrow it to "just the HTML-ish API routes" or to individual paths: that
// endpoint is SERVER-SENT EVENTS, and an SSE response BY DESIGN NEVER ENDS.
// A handler that took it would hold a `fetch()` open for the lifetime of the
// stream — the worker never reaches idle, the browser eventually kills it as
// unresponsive, and the notification stream dies with it. The same reasoning
// covers `/api/docs` and `/api/storage/objects/:id/download`, which are real
// server responses that must not be swapped for the SPA shell.
//
// (Strictly, `NavigationRoute` only sees requests whose `mode` is `navigate`,
// which an `EventSource` connection is not. The denylist is belt-and-braces
// against exactly that reasoning being used to remove it.)
//
// `/.well-known/` is the server's too: documents there (Digital Asset Links,
// `security.txt`, OpenID metadata) are served by nginx or the API. A
// platform's own verification fetch never passes through this worker, but a
// person opening the URL in a tab would otherwise get the SPA shell instead of
// the document they came to check.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/\.well-known\//],
  }),
);

// -----------------------------------------------------------------------------
// Take control of open pages as soon as this worker activates
// -----------------------------------------------------------------------------
// This is not a nicety. On a FIRST load the page that installed the worker is
// not controlled by it, and an uncontrolled page has no
// `registration.active` — so `registration.showNotification()` is unavailable
// for that entire session, which on Android means the user grants notification
// permission and then sees nothing until they reload. `clientsClaim()` closes
// that window.
clientsClaim();

// -----------------------------------------------------------------------------
// Update handshake  (`registerType: 'prompt'`)
// -----------------------------------------------------------------------------
// Deliberately NO top-level `self.skipWaiting()`. Under `prompt` a new worker
// installs and then WAITS, so a user mid-session keeps the exact asset
// revisions their loaded page was built against; activating underneath them
// would let a stale chunk request 404 against a rotated filename.
//
// The page decides when to hand over, by posting `{ type: 'SKIP_WAITING' }`.
// Issue #219 wires the UI half (`useRegisterSW` plus an "update available"
// prompt); this listener is the worker half it will call, and it exists now so
// that a worker shipped today is never permanently stuck in `waiting` should a
// build land before that UI does.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// -----------------------------------------------------------------------------
// notificationclick, push and pushsubscriptionchange (issues #222, #223, #230,
// #618; the handlers are `@marinoscar/platform-web/notifications/headless`'s
// since #738)
// -----------------------------------------------------------------------------
//
// The three handlers live in the notifications web slice and are registered
// here, in THIS file and not in a script pulled in with `importScripts()`:
// that split is precisely why this build uses `injectManifest` rather than
// `generateSW` (see `vite.config.ts`). The package's handlers obey the HARD
// CONSTRAINT at the top of this file:
//
//   * `push` renders the payload it was given, never fetches anything to
//     render it, and ALWAYS shows a notification (a push that shows nothing
//     makes Chrome substitute its own "updated in the background" notice);
//   * `notificationclick` re-validates the link (root-relative only; `//` and
//     any other origin fall back to `/`), then hands the click to an open page
//     by `postMessage`, or opens one with the id in `?n=`; the PAGE marks it
//     read, on its own token (`NotificationProvider`);
//   * `pushsubscriptionchange` resubscribes best effort and never tries to
//     tell the server: the page re-syncs on its next load.
//
// A handler added here for an app's own push behaviour must keep to the same
// rule: never call the API from the worker.
registerNotificationServiceWorkerHandlers(self, {
  icon: '/icons/icon-192.png',
  badge: '/icons/badge-96.png',
});
