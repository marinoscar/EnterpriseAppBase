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

import { isInternalLink } from './utils/internalLink';

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
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//],
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
// notificationclick — issue #223, epic #215
// -----------------------------------------------------------------------------
//
// The ONLY place a click on a worker-shown notification can be handled. A
// toast raised by `showPageNotification` (`services/browserNotifications.ts`)
// carries a JS `onclick` closure in the page that already knows what to do
// with a click; one raised by `registration.showNotification()`
// (`showAppNotification`, same file, issue #222) has NO such closure — the
// click instead arrives here, as this event, possibly with no page open at
// all. That is the entire reason this handler exists rather than living next
// to the other one.
//
// STILL BOUND BY "THIS WORKER MUST NEVER CALL THE API" AT THE TOP OF THIS
// FILE. Marking a notification read needs a valid access token, and the only
// place one exists is inside an open page's `ApiClient` instance (memory-only,
// see above) — so this handler never does the marking itself. It only ever
// hands the click to a page that already holds a token, one of two ways:
//   * a page is already open — focus it and `postMessage` the click, and let
//     `NotificationContext.tsx`'s `message` listener call the SAME
//     `markRead`/`navigate` the in-page toast's own click handler calls;
//   * no page is open — `clients.openWindow()` a fresh one at the link, with
//     the notification id riding along in a `?n=` query param, because there
//     is no page yet to `postMessage` to. `NotificationContext.tsx`'s
//     boot-time effect reads `?n=`, marks it read once the app (and its
//     token) exist, and strips the param so a refresh does not re-fire it.
// Either way, the API call happens from the page, on the page's own token,
// exactly as if the user had clicked the row in the bell.
//
// RE-VALIDATE `link` HERE EVEN THOUGH `sanitizeLink` ALREADY ENFORCES
// ROOT-RELATIVE-ONLY AT WRITE TIME
// (`apps/api/src/notifications/channels/browser-notification.channel.ts`).
// That sanitizer's own comment argues a forgetful FUTURE consumer would have
// to be unlucky, not that one is impossible — and this worker is exactly that
// new consumer, feeding the value straight into `clients.openWindow()`, a real
// navigation. A row written by an older build, seeded by hand, or restored
// from a backup taken before the sanitiser existed is not something this
// worker chooses to trust a second time on faith. `isInternalLink` (also used
// by the row click in `NotificationBell.tsx` and the in-page toast click in
// `NotificationContext.tsx`) accepts only a single leading `/` and rejects the
// protocol-relative `//`, which a browser resolves as "same scheme, ANY
// host" — precisely the shape an open-redirect payload would take. Anything
// that fails the check falls back to `/`: a wrong destination inside this app
// is a wrong click, an accepted off-origin link is a vulnerability.
self.addEventListener('notificationclick', (event) => {
  // Dismiss immediately, before the async work below. Left open, the OS lets
  // the same notification be clicked again while this handler is still
  // in flight, which would just fire it a second time for one click.
  event.notification.close();

  const data = (event.notification.data ?? {}) as { id?: unknown; link?: unknown };
  const id = typeof data.id === 'string' ? data.id : '';
  const rawLink = typeof data.link === 'string' ? data.link : null;
  const link = isInternalLink(rawLink) ? rawLink : '/';

  event.waitUntil(
    (async () => {
      // `includeUncontrolled: true` matters on the FIRST click after this
      // worker activates: `clientsClaim()` above hands the worker control of
      // pages going forward, but a tab that was already open when this worker
      // installed is not retroactively controlled, and without this flag
      // `matchAll` would not see it — the click would then look like the
      // cold-open case below and launch a SECOND tab next to the one already
      // open, rather than reusing it.
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      if (allClients.length > 0) {
        // Prefer a client already sitting on the link's path — nothing to
        // navigate, just bring it forward — and fall back to whichever window
        // is first otherwise. `matchAll({ type: 'window' })` guarantees
        // `WindowClient`s back even though `Clients.matchAll`'s declared
        // return type is the narrower `Client[]`.
        const windowClients = allClients as WindowClient[];
        const linkPath = link.split('?')[0];
        const target =
          windowClients.find((client) => {
            try {
              return new URL(client.url).pathname === linkPath;
            } catch {
              return false;
            }
          }) ?? windowClients[0];

        await target.focus();
        // The PAGE does the mark-read and the navigation from here — see
        // `NotificationContext.tsx`'s `message` listener, which reuses the
        // exact `markRead`/`navigate` calls the in-page toast's click handler
        // already makes. This worker only ever delivers the click.
        target.postMessage({ type: 'notification-click', id, link });
        return;
      }

      // COLD OPEN: no page to `postMessage` to, so the id rides along in the
      // URL instead, for `NotificationContext.tsx`'s boot-time `?n=` handler
      // to pick up once the app — and a token to mark it read with — exists.
      const separator = link.includes('?') ? '&' : '?';
      await self.clients.openWindow(`${link}${separator}n=${encodeURIComponent(id)}`);
    })(),
  );
});

// -----------------------------------------------------------------------------
// Push notifications  —  PARTIALLY IMPLEMENTED
// -----------------------------------------------------------------------------
// `push` and `pushsubscriptionchange` are not yet wired — the former has no
// filed issue yet, the latter is issue #230. They belong HERE, in this file,
// and not in a script pulled in with `importScripts()` — that split is
// precisely why this build uses `injectManifest` rather than `generateSW`;
// see `vite.config.ts`.
//
// Whatever `push` ends up doing, it must respect the "never call the API"
// constraint at the top of this file: it renders the payload it was given
// (from the push message itself), it does not fetch anything to render it.
