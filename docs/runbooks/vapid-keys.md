# Runbook: Generate, Enable, Rotate, and Disable VAPID Keys (Web Push)

This runbook covers the operator-facing lifecycle of Web Push on this
deployment: generating a VAPID key pair, turning the channel on, rotating the
keys, and turning it back off. It does not cover the delivery mechanism
itself — see [`docs/specs/browser-notifications.md`](../specs/browser-notifications.md)
for why Web Push exists, how it fits alongside the browser-toast channel, and
what it does and does not guarantee.

Source of truth for every claim below:

- `apps/api/src/config/configuration.ts` — the `push` config block
  (`push.vapidPublicKey`, `push.vapidPrivateKey`, `push.vapidSubject`), read
  from `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`.
- `apps/api/src/notifications/push-subscription.service.ts` — `isEnabled()`,
  the one predicate that decides whether this deployment accepts push
  subscriptions at all.
- `apps/api/src/notifications/channels/push-notification.channel.ts` — the
  sender, including what happens when a send fails.
- `apps/api/src/notifications/notifications.module.ts` — where `isEnabled()`
  decides, once, whether the push channel is even in the dispatcher's sender
  array.
- `infra/compose/.env.example` — the three environment variables, commented
  out by default.

**Web Push ships disabled by default.** Leaving the three variables unset is
a fully supported, permanent configuration — nothing in this codebase
requires them, and every other notification channel (email, the in-app
browser toast) is unaffected by their absence.

---

## 1. Before you start

- Decide whether you want Web Push at all. It is the *only* channel that can
  reach a signed-in user with the app fully closed (no open tab, no installed
  PWA in the foreground) — if that is not a requirement for this deployment,
  there is nothing to do here.
- Decide on a contact address for `VAPID_SUBJECT` before generating keys: a
  `mailto:` or `https:` URL identifying the operator, per the Web Push
  protocol (RFC 8292). This is advisory metadata a push service (FCM,
  Mozilla's autopush, …) can use to reach you if this deployment's traffic
  looks abusive — it is never seen by end users. See Section 2.3 for what
  happens if you skip it.
- Note that turning Web Push on or off requires an **API restart** — see
  Section 3's explanation of why the decision is not re-evaluated per
  request.

## 2. Generating a key pair

```bash
npx web-push generate-vapid-keys
```

This prints a public and a private key (base64url-encoded). It requires no
network access and touches no state on this deployment — it is a pure
keypair generation, and running it twice produces two independent, unrelated
key pairs.

### 2.1 Where the keys go

Set three environment variables (`infra/compose/.env.example:86-93` documents
them, commented out by default):

```bash
VAPID_PUBLIC_KEY=<the generated public key>
VAPID_PRIVATE_KEY=<the generated private key>
VAPID_SUBJECT=mailto:admin@example.com
```

Do not commit these to the repository. Store them the same way you store
`JWT_SECRET` or `GOOGLE_CLIENT_SECRET` — this deployment's ordinary
environment-variable secret path, not the encrypted `credentials` table (that
path is for runtime-configured, admin-entered secrets like an SMTP password;
VAPID keys are deploy-time configuration like every other credential in this
list, per `apps/api/src/config/configuration.ts`'s own comment: "generated
once at deploy time... and supplied as an environment variable, exactly like
`GOOGLE_CLIENT_SECRET`").

### 2.2 Why both halves of the key pair are required, together

`PushSubscriptionService.isEnabled()` (`push-subscription.service.ts:57-61`)
requires **both** `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` to be present —
a public key with no private key is useless, since nothing on this server
could sign a push, and accepting subscriptions in that state would just
accumulate rows the channel can never deliver to.

### 2.3 What happens if `VAPID_SUBJECT` is absent

Unlike the two keys, `VAPID_SUBJECT` is not required for `isEnabled()` to
return `true` — `push-subscription.service.ts`'s own header states why it is
a different kind of field: it is contact metadata for the JWT `web-push`
signs, not something that affects whether signing is possible at all.

If it is unset, `PushNotificationChannel.deliverInner` still sends, but falls
back to a generic subject and logs a warning on every delivery
(`push-notification.channel.ts:266-287`):

```ts
const vapidDetails = {
  subject: vapidSubject ?? 'mailto:admin@example.com',
  publicKey: vapidPublicKey,
  privateKey: vapidPrivateKey,
};
```

Every push this deployment sends will therefore carry `web-push`'s own
example address as its contact, which is harmless to end users (they never
see it) but means a push-service operator investigating unwanted traffic from
this deployment has no way to reach you. Set `VAPID_SUBJECT` before enabling
push in any deployment that will see real traffic.

## 3. Enabling Web Push on a running deployment

1. Set all three environment variables from Section 2.1.
2. **Restart the API.**

That second step is not optional, and confirming exactly why requires reading
two things together:

- `PushSubscriptionService.isEnabled()` reads `this.config.get<string>(...)`
  on every call — it is not cached inside that service, and NestJS's
  `ConfigService` (configured with `ConfigModule.forRoot({ isGlobal: true,
  load: [configuration] })` in `apps/api/src/app.module.ts`) resolves
  `process.env` once, at process boot, into its internal store. So
  `isEnabled()` itself is "live" only in the sense that it re-reads that
  store on every call — it does not re-read `process.env` after boot.
- More importantly, **whether the push channel is even reachable is decided
  once, at module construction, not per call.** `notifications.module.ts`'s
  `NOTIFICATION_CHANNEL_SENDERS` factory
  (`notifications.module.ts:160-190`) calls
  `pushSubscriptions.isEnabled()` exactly once, when Nest builds the provider
  array, and that decision — whether `PushNotificationChannel` is in the
  `senders` array the dispatcher iterates — is fixed for the life of the
  process. A running API process that had no VAPID keys at boot will **never**
  dispatch over `push`, no matter what you change in its environment
  afterward, until it restarts.

So: set the env vars, then restart. There is no live-reload path, no admin
endpoint, and no signal you can send the running process to make it
re-evaluate this.

Once restarted, confirm it took effect by calling `GET
/api/notifications/config` as any authenticated user — `pushEnabled` should
read `true` and `vapidPublicKey` should carry your public key
(`notifications.controller.ts:205-211`). Nothing beyond the restart is
required: there is no migration, no seed step, and no admin toggle separate
from these three environment variables — `push` has no deployment-wide
enable/disable setting of its own in `system_settings` (see
[`docs/specs/browser-notifications.md`](../specs/browser-notifications.md#5-the-kill-switch--inbox-row-split)
for why: the admin kill switch epic #226 shipped covers the browser toast
only, and a policy gate for `push` specifically was explicitly left to a
later change, not this one).

## 4. Rotating VAPID keys

**Every existing push subscription becomes permanently unusable the moment
you rotate.** A `PushSubscription` a browser holds is cryptographically bound
to the public key it was created with (`applicationServerKey`) — there is no
"re-key in place" operation on either side of the Web Push protocol. This is
expected behavior of the protocol, not a bug in this implementation.

What actually happens on the next send attempt against a subscription
negotiated under the old keys, verified against
`push-notification.channel.ts`'s failure handling (Section 9 of the spec
document covers this in full): the push service will reject the send. Whether
that arrives as a 404/410 (immediate deletion of the row,
`push-notification.channel.ts:339-352`) or some other error code that instead
increments `failureCount` toward the 5-attempt threshold
(`push-notification.channel.ts:363-376`,
`MAX_PUSH_FAILURE_COUNT`) depends on how the specific push service (FCM,
autopush, …) reports a key mismatch — this codebase does not special-case
that response, so expect anywhere from immediate pruning to up to 5 silently
failed deliveries per stale subscription before the row is cleaned up
automatically.

**Recovery is real but not instantaneous, and it requires the user to open
the app.** `apps/web/src/hooks/useNotificationCapability.ts` and
`apps/web/src/services/browserNotifications.ts` were checked for a
client-side re-subscribe-on-boot mechanism, and **none exists as merged in
this worktree.** `apps/web/src/sw.ts`'s `pushsubscriptionchange` handler
(`sw.ts:374-403`) only re-subscribes when the *browser itself* rotates a
subscription out from under the page (a browser-initiated event, unrelated to
a server-side key rotation) — it has no way to detect "the server changed its
VAPID keys," because nothing tells it that. So do not assert that a rotation
"heals itself the next time each user's tab loads and a client-side re-sync
runs" — that re-sync does not exist yet in this codebase.

What genuinely does recover a subscription after rotation: the ordinary
subscribe flow. Once a user's client next calls
`pushManager.subscribe({ applicationServerKey: <new public key> })` — which
happens whenever code calls that API, e.g. a future re-prompt flow, or a user
manually toggling notifications off and back on in a UI that wires up
`POST /api/notifications/push/subscriptions` — `PushSubscriptionService.subscribe`
upserts by `endpoint` (`push-subscription.service.ts:89-138`), replacing
whatever row existed. Until that happens for a given browser, that
subscription is dead weight that will fail every send and eventually prune
itself via the failure-threshold mechanism above.

**Practical rotation procedure:**

1. Generate a new key pair (Section 2).
2. Update `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (and `VAPID_SUBJECT` if it
   changed) to the new values.
3. Restart the API (Section 3 explains why this step cannot be skipped).
4. Expect every existing subscription to fail on its next delivery attempt,
   per the failure handling above, and to prune itself over time (immediately
   for a 404/410-reporting push service, within 5 attempts otherwise).
5. There is currently no bulk re-subscribe mechanism and no forced client
   notification that a rotation happened — a subscribed user simply stops
   receiving push notifications (their bell and email notifications are
   unaffected) until whatever UI calls `pushManager.subscribe` again runs for
   them. If this matters for your deployment, that gap — a proactive
   re-subscribe prompt after a detected rotation — is a feature this runbook
   cannot make you a workaround for; it does not exist in this codebase as of
   this writing.
6. Securely discard the old key pair once you've confirmed the new one is
   live (`GET /api/notifications/config` reflects the new `vapidPublicKey`).

## 5. Disabling Web Push

1. Unset (or remove) `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and
   `VAPID_SUBJECT`.
2. Restart the API.

This is genuinely sufficient, confirmed by reading both halves of the gate:

- `PushSubscriptionService.isEnabled()` returns `false` the moment either key
  is missing (`push-subscription.service.ts:57-61`), which makes
  `POST /api/notifications/push/subscriptions` reject new subscriptions with
  a `409 Conflict` ("Web Push is not enabled on this deployment",
  `push-subscription.service.ts:94-104`) — but existing rows in
  `push_subscriptions` are **not deleted** by disabling.
- `notifications.module.ts`'s factory (`notifications.module.ts:160-190`)
  re-evaluates `isEnabled()` on the **next process boot** and, finding it
  `false`, omits `PushNotificationChannel` from `NOTIFICATION_CHANNEL_SENDERS`
  entirely. With the channel absent from that array, `NotificationsService`
  never sees `push` as an available sender for any event — not a queued
  delivery that fails, no delivery record at all, exactly as the module's own
  comment states for the "never configured" case.

So after the restart, no push is ever attempted again, existing
`push_subscriptions` rows sit inert (harmless — nothing reads them while the
channel is unregistered), and `GET /api/notifications/config` reports
`pushEnabled: false` again. Re-enabling later (Section 3) picks up exactly
where you left off; the leftover rows are not a problem — the next real send
attempt to one would rediscover any that have since gone stale via the
ordinary 404/410 pruning path.

## 6. Summary checklist

- [ ] Key pair generated with `npx web-push generate-vapid-keys`
- [ ] `VAPID_SUBJECT` decided (a real `mailto:` or `https:` address, not left
      to the `mailto:admin@example.com` fallback, for any deployment with
      real traffic)
- [ ] `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` set in the
      deployment's environment (not committed, not stored in the
      `credentials` table)
- [ ] API restarted — required for both enabling and disabling, because
      channel registration is decided once at module construction
- [ ] `GET /api/notifications/config` confirms `pushEnabled` and
      `vapidPublicKey` match the change just made
- [ ] If rotating: existing subscriptions expected to fail and self-prune;
      no bulk re-subscribe or user notification exists in this codebase —
      affected users simply stop receiving push until their client
      re-subscribes through the ordinary flow
- [ ] If disabling: understood that `push_subscriptions` rows are left in
      place, inert, not deleted
