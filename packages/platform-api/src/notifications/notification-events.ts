// =============================================================================
// Notification event registry (issue #121, epic #109)
// =============================================================================
//
// ONE declaration, three consumers — the same argument
// `apps/web/src/config/adminSections.tsx` and `apps/web/src/config/
// destinations.ts` each make on their own axis, applied to notifications.
//
// Epic #109's premise is that adding a notification later costs ONE registry
// entry, exactly as adding a settings page now costs one card (epic #90).
// That promise only holds while there is a single answer to "what events
// exist, which channels can carry them, and what happens when the user has
// said nothing". The consumers are:
//
//   1. the dispatcher (#125)            — what to send, over what, to whom
//   2. the preferences page (#126)      — the event x channel matrix
//   3. the docs / admin surfaces        — what this app can even tell you
//
// Without one list, the preferences page has its own and the dispatcher has
// its own, and they drift: a toggle for an event nothing dispatches, or an
// event that dispatches with no toggle. That is precisely the failure
// `destinations.ts` describes ("three gates, three answers") one axis over.
//
// -----------------------------------------------------------------------------
// WHERE THIS LIVES, AND WHY IT IS HERE RATHER THAN SHARED OR DUPLICATED
// -----------------------------------------------------------------------------
//
// The API dispatches and the web renders, so both need this. Three options
// were on the table; this file is option 1.
//
// 1. **CHOSEN — the API owns it; the web reads it over an endpoint.**
//    There is exactly one declaration in the repository, so there is nothing
//    to drift. The web does not get a copy to keep in sync; it gets the
//    server's answer. That matters more here than for `adminSections.tsx`,
//    which mirrors permission strings by convention (see CLAUDE.md's Settings
//    UI Pattern, rule 3) and accepts the mirroring cost: `mandatory` below is
//    a SECURITY gate, not a label, and a second copy of a security gate is a
//    second place for it to be wrong. The endpoint itself is deliberately NOT
//    in this issue — #125/#126 add it when they have a consumer for it, and
//    #121 ships the declaration those read.
//
// 2. **REJECTED — duplicate in `apps/web`, with a test asserting the two
//    agree.** A test converts silent drift into loud drift, which is better
//    than nothing, but it is detection rather than prevention: the copies can
//    still disagree in a working tree, in a branch, and in any build where the
//    test is not run. It also breaks the epic's headline promise directly —
//    adding a notification would cost TWO registry entries and a green test,
//    not one entry.
//
// 3. **REJECTED — a shared package both apps import.** The honest structural
//    answer, and the wrong trade today. This repo has no `packages/` workspace
//    (`package.json` declares `workspaces: ["apps/*"]`) and no cross-app import
//    anywhere. The two apps do not agree on module resolution — the API is
//    `NodeNext` compiled by Nest out of `src/`, the web is `bundler` under
//    Vite — so a shared location means a new workspace, a path alias in both
//    tsconfigs, a Vite alias, and a Nest `rootDir` change that moves `dist/`
//    and therefore edits `apps/api/Dockerfile`. That is a real and reviewable
//    architectural change, and it should be made when there is a body of
//    shared contract to justify it, not smuggled in under one 100-line file.
//    If that package ever lands, this file moves into it unchanged: nothing
//    below imports from Nest, Prisma, or anything Node-only, precisely so
//    that move stays a `git mv`.
//
//    UPDATE (epic #161): that package now exists — `packages/shared`,
//    published to the workspace as `@app/shared` — and it landed exactly as
//    the paragraph above asks: as its own filed, reviewed change rather than
//    as a side effect of a feature. Two things it says are now out of date:
//    `workspaces` reads `["apps/*", "packages/*"]`, and there IS a cross-app
//    import. The rest still holds, and **this registry deliberately did not
//    move**. `@app/shared` carries rebrandable CONSTANTS — today a single
//    display-name string that all three apps render — and it is plain
//    CommonJS with a hand-written `.d.ts` and no build step, which is what
//    lets it satisfy Nest's `rootDir`, ts-jest's transform rules and Vite at
//    once. A 100-line registry of security-relevant contract is a different
//    kind of thing on both counts, and option 1 above still beats a shared
//    copy for it: the web gets the server's answer, not a second declaration
//    that a build could skew. Moving it remains available, and remains a
//    call for whoever has a reason to make it.
//
// This file is intentionally NOT a Nest provider. It is pure data and pure
// functions, so tests, the future endpoint, and a shared package later can all
// consume it without standing up DI for a constant.
//
// -----------------------------------------------------------------------------
// UPDATE (#678, PP-1.6): THE DECLARATION IS NOW A REGISTRY, AND THIS FILE IS ITS VIEW
// -----------------------------------------------------------------------------
//
// "ONE declaration" still holds, but it is no longer one array in this file.
// The closed literals that used to live here (`NOTIFICATION_CHANNELS` and the
// nine-entry `NOTIFICATION_EVENTS`) made every app that added an event or a
// channel edit a platform file. Now:
//
//   - channels are registered in `./registry/channel.registry.ts`
//     (platform: `./registry/platform-channels.ts`);
//   - each event is declared next to the module that raises it
//     (`auth/auth.notifications.ts`, `users/users.notifications.ts`, ...) with
//     its email template and browser renderer, and registered with
//     `registerNotification`;
//   - an app adds its own in `app-registrations/notifications.ts`;
//   - `./registry/notification.manifest.ts` registers all of it, platform
//     first, at import time.
//
// The lookup functions read the registry live. Since #738 the frozen
// snapshots that used to live here (`NOTIFICATION_CHANNELS`,
// `NOTIFICATION_EVENTS`) are gone from the package: a package module loads
// before the app's manifest registers anything, so a snapshot taken here would
// be empty. The reference app keeps both names, taken after its manifest ran,
// in `apps/api/src/platform/notifications/index.ts`.
// The registry, not this file, now enforces what the old spec checked after the
// fact (non-empty channels, registered channels, mandatory implies
// defaultEnabled); see ./registry/README.md.
// =============================================================================

import { notificationEventRegistry } from './registry/event.registry';
import type { NotificationChannel } from './registry/channel.registry';
import type { NotificationEventDef } from './registry/event.registry';

export type { NotificationChannel, NotificationChannelIds } from './registry/channel.registry';
export type { NotificationEventDef } from './registry/event.registry';

/**
 * Every registered event, read from the registry now, in registration order.
 *
 * A fresh array each call; the entries are the registry's own objects, so do
 * not mutate them.
  *
  * @stability stable
 */
export function listNotificationEvents(): NotificationEventDef[] {
  return notificationEventRegistry.list();
}

/**
 * The definition for `key`, or `undefined` when nothing is registered under it.
 *
 * RETURNS `undefined` RATHER THAN THROWING because the caller is frequently
 * holding a string that came from persisted data — a preference row or a
 * delivery record written before an event was removed from this list. A
 * decommissioned event must not turn a preferences page render into a 500;
 * the caller decides whether an unknown key is "skip it" or "this is a bug".
 *
 * A keyed lookup in the registry, so the dispatcher's per-delivery lookups are
 * not a linear scan.
  *
  * @stability stable
 */
export function findEvent(key: string): NotificationEventDef | undefined {
  return notificationEventRegistry.get(key);
}

/**
 * Channels `key` can be delivered over, or an empty array when the key is
 * unknown.
 *
 * Empty-for-unknown is the safe direction and is deliberately not an
 * exception: every caller is about to iterate the result, and "an event that
 * no longer exists is delivered nowhere" is the correct outcome of that loop.
 * Throwing would instead take down whatever action raised the stale event —
 * violating epic #109's rule that a notification failure never fails the
 * action that triggered it.
 *
 * Returns a defensive copy: the arrays in the registered events are the
 * registry's own state, and a caller that sorted or spliced the result in
 * place would silently reconfigure delivery for every later dispatch in the
 * process.
  *
  * @stability stable
 */
export function channelsFor(key: string): NotificationChannel[] {
  return [...(notificationEventRegistry.get(key)?.channels ?? [])];
}

/**
 * Can `key` be delivered over `channel`?
 *
 * The membership test the dispatcher (#125) needs on every delivery, kept here
 * so the answer is not re-derived — and re-derived subtly differently — at
 * each call site. Unknown key is `false`, consistent with `channelsFor`.
  *
  * @stability stable
 */
export function supportsChannel(key: string, channel: NotificationChannel): boolean {
  return notificationEventRegistry.get(key)?.channels.includes(channel) ?? false;
}

/**
 * Is `key` an event the user may not opt out of?
 *
 * THE SERVER-SIDE GATE, not a UI hint. #125 calls this during preference
 * resolution, so a stored preference disabling a mandatory event is ignored no
 * matter how it got written — including by a crafted PATCH that never went
 * near the UI.
 *
 * Unknown key is `false`: an event that is not registered cannot be dispatched
 * at all, so nothing is being weakened by the default.
  *
  * @stability stable
 */
export function isMandatory(key: string): boolean {
  return notificationEventRegistry.get(key)?.mandatory === true;
}
