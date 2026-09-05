/**
 * The native `Notification` Web API — the calls this app makes against it.
 *
 * Issue #127, epic #109. Issue #222 adds the service-worker delivery path.
 *
 * =============================================================================
 * THIS IS DECORATION. THE NOTIFICATION CENTRE IS THE FEATURE.
 * =============================================================================
 *
 * Everything in this file can fail, be blocked, or be unavailable, and the
 * product must be unaffected. Permission is denied by a large fraction of users
 * and cannot be re-requested; the API does not exist in a non-secure context or
 * under the test runner's jsdom; some hardened browsers define `Notification`
 * and throw on touching it. So every function here DEGRADES SILENTLY and none
 * of them throws.
 *
 * The durable surface is `GET /api/notifications` behind the bell, which works
 * with permission denied, with the SSE stream down, and in a browser that has
 * never heard of `Notification`. Epic #109 is explicit that a feature existing
 * only as an OS toast does not exist at all for the users who denied it. That
 * includes browsers where the toast can ONLY be raised through a service
 * worker registration (Android Chrome) — see `showAppNotification` below,
 * which is why this file now has two ways to raise the same toast instead of
 * one.
 *
 * SEPARATED FROM `hooks/useBrowserNotificationPermission.ts` ON PURPOSE. That
 * hook OBSERVES permission and must never request it — it runs on mount, and a
 * request on mount is the exact mistake described below. This module ACTS, and
 * every function in it is reachable only from a user gesture or from an event
 * that has already arrived. Keeping the two apart is what makes "does anything
 * prompt on load?" answerable by looking at one file's callers.
 */

import type { AppNotification } from '../types';

/** Is the constructor there at all, and safe to touch? */
function isSupported(): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  try {
    // The ACCESS is the test, not the presence of the key. Some embedded and
    // privacy-hardened browsers expose `Notification` and throw on reading
    // `permission` — the same defence `useBrowserNotificationPermission` takes,
    // for the same reason.
    void window.Notification.permission;
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask the browser for permission. **Call this only from a user gesture.**
 *
 * =============================================================================
 * WHY THE CALL SITE MATTERS MORE THAN THIS FUNCTION DOES
 * =============================================================================
 *
 * There is exactly ONE caller, and it is a click handler on the "Allow
 * notifications" button inside the explanatory banner on
 * `/settings/notifications` (`components/settings/NotificationSettings.tsx`,
 * wired by `pages/UserNotificationsPage.tsx`). That is not a stylistic
 * preference:
 *
 *   * A DENIAL IS EFFECTIVELY PERMANENT. The app cannot re-prompt and cannot
 *     undo it; only the user can, buried in browser site settings. The prompt
 *     is a ONE-SHOT RESOURCE, and spending it on somebody who never asked for
 *     notifications kills the feature for that person for good.
 *   * Browsers actively penalise prompts with no user gesture. Chrome
 *     suppresses them into a quiet UI, Firefox requires the gesture outright and
 *     auto-dismisses without one, and Safari throws. So a prompt on mount is not
 *     merely rude — it frequently does not even reach the user, while still
 *     burning the coin.
 *
 * DO NOT CALL THIS FROM AN EFFECT, A ROUTE TRANSITION, A TIMER, OR ON MOUNT.
 * If a second call site ever seems necessary, it must be a second deliberate
 * click, not a second automatic trigger.
 *
 * @returns the resulting permission, or `null` when the browser has no usable
 *          `Notification` API. The caller should refresh its permission state
 *          from `useBrowserNotificationPermission().refresh()` regardless of
 *          what comes back — that hook is the single source of truth for what
 *          the UI renders, and this return value is only what one call happened
 *          to see.
 */
export async function requestBrowserNotificationPermission(): Promise<
  NotificationPermission | null
> {
  if (!isSupported()) return null;

  try {
    // `Notification.requestPermission()` has two signatures across browsers —
    // a promise (modern, everywhere current) and a legacy callback (old Safari).
    // `await` handles the promise form and, on the callback form, simply
    // resolves the `undefined` it returns; the UI is refreshed from
    // `Notification.permission` afterwards either way, so the legacy path
    // degrades to "the banner updates on the next visibility change" rather
    // than to a broken button.
    const result = await window.Notification.requestPermission();
    return result ?? window.Notification.permission;
  } catch {
    // A throw here is a browser that refuses the request outright. Not an error
    // worth surfacing: the permission state is unchanged, and the banner that
    // prompted the click already explains what is going on.
    return null;
  }
}

/**
 * Try the page-`Notification` constructor path — the ONLY path that existed
 * before #222, and now the FALLBACK for browsers that either have no service
 * worker registration or where the SW call itself failed.
 *
 * Kept as its own function rather than inlined into `showAppNotification`
 * because it is also the emergency exit when the SW attempt throws for a
 * reason that has nothing to do with Android's SW-only restriction (a
 * misbehaving embedded browser, a registration stuck mid-update, etc) — one
 * `try` around one call, reused from two call sites instead of duplicated.
 *
 * @param onClick invoked when the user activates the toast. The window is
 *        focused first, because a toast is clicked from outside the browser and
 *        navigating a background tab the user cannot see is not a useful
 *        outcome. THIS FOCUS/ONCLICK WIRING HAS NO EQUIVALENT ON THE SW PATH —
 *        `ServiceWorkerRegistration.showNotification()` returns no handle to
 *        attach a JS `onclick` to; a clicked SW toast instead fires a
 *        `notificationclick` event inside the worker, which is issue #223's
 *        job to wire up (`postMessage` back to an open tab, or open one). That
 *        is a real, currently-unfilled gap on the SW path, not an oversight in
 *        this function.
 * @returns whether a toast was actually raised this way.
 */
function showPageNotification(
  notification: AppNotification,
  onClick?: (notification: AppNotification) => void,
): boolean {
  try {
    const toast = new window.Notification(notification.title, {
      body: notification.body,

      // `tag` COLLAPSES DUPLICATES. The API publishes to every connection the
      // user has open, so someone with four tabs receives four copies of the
      // same event and would otherwise get four identical OS toasts. Tagging by
      // the notification's id makes the browser replace rather than stack them,
      // which is the only mechanism available — the tabs cannot coordinate, and
      // adding cross-tab leader election for a toast would be far more machinery
      // than the problem deserves.
      tag: notification.id,

      // NOT `renotify`. With the tag above, re-notifying would restore exactly
      // the duplicate alerting the tag exists to suppress.
    });

    if (onClick) {
      toast.onclick = () => {
        try {
          // The user clicked something outside the browser; without this the
          // navigation happens in a window they still cannot see.
          window.focus();
          onClick(notification);
        } finally {
          // Dismiss it ourselves. Platform behaviour on click varies — some
          // leave the toast sitting in a notification centre — and a toast that
          // outlives the click that handled it invites a second one.
          toast.close();
        }
      };
    }

    return true;
  } catch {
    // Constructing a `Notification` throws on Android Chrome, where the API is
    // service-worker-only. That is a supported outcome, not a bug: the
    // notification is already in the centre and the bell already shows it.
    return false;
  }
}

/**
 * Raise a native toast for a notification that just arrived over SSE.
 *
 * SILENT NO-OP unless permission is ALREADY `granted`. It never requests —
 * requesting from an incoming event would fire a prompt with no user gesture,
 * which is the failure mode the whole permission section above exists to
 * prevent.
 *
 * =============================================================================
 * WHY THE SERVICE-WORKER PATH IS TRIED FIRST (#222)
 * =============================================================================
 *
 * `new Notification(...)` THROWS ON ANDROID CHROME. The page constructor is
 * disabled there on purpose — Android requires every web notification to go
 * through a service worker registration's `showNotification()`, full stop.
 * Before this function existed, `showNativeNotification` only knew the page
 * path, so on Android the `catch` below was reached on every single arrival
 * and the toast silently never appeared — which is the bug #222 exists to
 * fix. Trying the page constructor FIRST and falling back to the SW would
 * "work" on every desktop browser and never once fire on Android, so the
 * order here is not a preference, it is the fix.
 *
 * =============================================================================
 * WHY `getRegistration()` AND NOT `navigator.serviceWorker.ready`
 * =============================================================================
 *
 * `.ready` is a promise that resolves once a service worker controls the
 * page — and NEVER RESOLVES AT ALL if that never happens. This app's SW
 * self-registers via `vite-plugin-pwa`'s auto-injected register script (see
 * `vite.config.ts`'s `injectRegister: 'auto'`), but nothing here guarantees
 * that registration has completed, or ever will (registration can fail, be
 * disabled by the browser, or simply not have run yet on this page load).
 * Awaiting `.ready` in that situation would hang this function's `await`
 * forever, and a notification path that can hang forever is worse than one
 * that occasionally falls back to the page path. `getRegistration()` instead
 * resolves immediately either way — with a registration, or with
 * `undefined` — which is the only shape compatible with "never throws, never
 * hangs".
 *
 * =============================================================================
 * WHY THE PAGE PATH STAYS, AS A FALLBACK
 * =============================================================================
 *
 * Desktop Safari has no bar against `new Notification(...)` and this app does
 * not currently register a service worker there in every configuration; more
 * generally, any browser where SW registration failed, is still in flight, or
 * was rejected by the user's settings still deserves a toast if permission is
 * independently `granted`. Falling back — rather than requiring a SW — keeps
 * every browser this worked on before #222 working exactly as before.
 *
 * @param onClick invoked when the user activates the toast — see
 *        `showPageNotification` above for why this ONLY fires on the page
 *        path, never on the SW path.
 * @returns which path actually raised the toast (`'sw'` or `'page'`), or
 *          `'none'` if neither did. For tests and diagnostics; no caller
 *          makes a decision from it, because there is no fallback to fall
 *          back to — the notification is already in the centre.
 */
export async function showAppNotification(
  notification: AppNotification,
  onClick?: (notification: AppNotification) => void,
): Promise<'sw' | 'page' | 'none'> {
  try {
    if (!isSupported()) return 'none';
    if (window.Notification.permission !== 'granted') return 'none';

    if ('serviceWorker' in navigator) {
      try {
        // NOT `.ready` — see the doc comment above for why that can hang
        // forever. `getRegistration()` resolves immediately with `undefined`
        // when there is none.
        const registration = await navigator.serviceWorker.getRegistration();

        // Defensive: some unusual embedded WebViews expose `serviceWorker`
        // and return a registration-shaped object without a working
        // `showNotification` method. Checking the method itself, rather than
        // trusting the type, is the same posture `isSupported()` above takes
        // with `Notification.permission`.
        if (registration && typeof registration.showNotification === 'function') {
          await registration.showNotification(notification.title, {
            body: notification.body,
            tag: notification.id,
            icon: '/icons/icon-192.png',
            badge: '/icons/badge-96.png',
            // Not read by anything yet. This is forward-prep for issue #223's
            // `notificationclick` handler inside the service worker, which
            // needs the id (to tell the centre what was clicked) and the link
            // (to navigate) and has no other way to get either — a SW toast
            // carries no JS closure the way `showPageNotification`'s does.
            data: { id: notification.id, link: notification.link },
          });
          return 'sw';
        }
      } catch {
        // Fall through to the page path below. A SW that exists but rejects
        // `showNotification` (e.g. mid-update, or a browser bug) is not a
        // reason to lose the toast entirely when the page path might still
        // work.
      }
    }

    return showPageNotification(notification, onClick) ? 'page' : 'none';
  } catch {
    // Belt-and-braces: this function must never throw, no matter what a
    // future edit above does.
    return 'none';
  }
}
