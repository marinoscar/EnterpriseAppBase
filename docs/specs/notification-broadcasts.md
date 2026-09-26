# Admin Notification Broadcasts

> Epic #319, issues #320–#325 (#320 the `NotificationBroadcast` schema and the
> `broadcasts:*` permission pair, #321 the two registry events plus
> narrowing-only channel selection and `notifyNow()`, #322 the broadcast email
> and browser templates, #323 the `admin.broadcast.start` /
> `admin.broadcast.chunk` fan-out handlers, #324 the admin API, #325 the
> admin page, composer and visual baselines). #326 added the database-level
> suite for the claim compare-and-swap and the audience under concurrency —
> see [Verification](#verification).
>
> Implemented in `apps/api/prisma/schema.prisma` (the `NotificationBroadcast`
> model and `NotificationBroadcastStatus` enum),
> `apps/api/src/notifications/notification-events.ts` (`admin.broadcast`,
> `admin.broadcast_critical`),
> `apps/api/src/notifications/notification.types.ts` (`NotifyOptions`),
> `apps/api/src/notifications/notifications.service.ts` (`notifyNow`, the
> narrowing intersection in `dispatch()`),
> `apps/api/src/notifications/broadcasts/` (`broadcast-audience.ts`,
> `broadcasts.controller.ts`, `broadcasts.service.ts`, `broadcasts.module.ts`,
> `dto/`, `handlers/broadcast-start.handler.ts`,
> `handlers/broadcast-chunk.handler.ts`),
> `apps/api/src/email/templates/broadcast.email.ts`,
> `apps/api/src/notifications/channels/email-notification.channel.ts` and
> `browser-notification.channel.ts` (the `EVENT_EMAIL_TEMPLATES` /
> `EVENT_BROWSER_TEMPLATES` registrations), and `.github/workflows/
> visual-baselines.yml`. The admin page (`apps/web/src/pages/Admin/
> BroadcastsPage.tsx`, `components/admin/BroadcastComposer.tsx`,
> `services/broadcasts.ts`) is #325's slice of this epic and is described here
> at the level of what the API contract requires of it; it is being built in
> parallel with this document and is not asserted as merged in this checkout.

## 1. What this is, and what it is not

A broadcast is a message an administrator composes once, in the app, and
that reaches **every active user** in the deployment — over whatever
channels that deployment already supports (email, the in-app bell, Web
Push) — sent immediately or scheduled for a future time.

It is deliberately narrow, and the boundary is worth stating before anything
else because most of the rejected-alternatives section (§10) is this
boundary being asked to move and declining to:

- **Not marketing.** There is no template library, no HTML body, no rich
  media, no click-tracking. One plain-text message, rendered the same way
  every time.
- **Not segmented.** Every broadcast goes to all active users. No role
  filter, no user picker, no saved audience. "All active users" is the
  entire targeting model.
- **Not templated at read time.** The composed `title` and `body` are frozen
  into the row at create time, exactly as `Notification.title`/`.body`
  freeze what a triggered event said. A later rename of a product or a
  rewording of house style does not retroactively change what a past
  broadcast is remembered as having announced.
- **Not editable after creation.** There is no `PATCH /:id`. Content is
  frozen at compose time; cancel-and-recreate expresses "I want to say this
  differently" without an edit path that could race the fan-out mid-flight.

What it reuses, deliberately, is everything else: the existing job queue
(epic #254) for the fan-out, the existing per-user dispatcher
(`notifications.service.ts`) for delivery, the existing preference matrix and
admin kill switch for what a recipient actually receives, and the existing
email/browser channel implementations for rendering. This epic adds a
one-way, all-users trigger onto that stack; it does not stand up a second
notification system beside it.

## 2. Two registry events, not one flag

`NOTIFICATION_EVENTS` gains two entries:

```ts
{ key: 'admin.broadcast',          label: 'Announcements',
  channels: ['email', 'browser', 'push'], defaultEnabled: true }
{ key: 'admin.broadcast_critical', label: 'Important announcements',
  channels: ['email', 'browser', 'push'], defaultEnabled: true, mandatory: true }
```

The obvious-looking alternative — one `admin.broadcast` event with a
per-send "important" boolean — was rejected, and the reason is structural
rather than stylistic.

`NotificationEventDef.mandatory` is a **static registry property**, and it
is not decoration: `isChannelEnabled` (notification-preferences.ts) and
`policyChannels` (notification-policy.ts) both branch on it, and each branch
is a security gate — the first decides whether a *stored user preference*
may mute this event at all, the second whether an *operator's deployment-wide
kill switch* may. Making the flag dynamic (readable per send) would push a
value the composer chooses into the gate that decides whether a recipient
may mute an event at all — the exact coupling `mandatory` exists to keep out
of reach of anything but the registry file.

Two keys is also **the only representation** under which
`/settings/notifications`' preferences matrix can show both things at once: a
muteable row the user may switch off (`admin.broadcast`), and an unmuteable
one rendered disabled with its reason (`admin.broadcast_critical`). A single
event carrying a per-send flag has exactly one row on that matrix, and that
row has to lie in one direction or the other — either it offers a toggle
some sends will ignore, or it hides a toggle most sends would honour. Because
the matrix is registry-driven (one declaration, three consumers — see that
file's own header), both keys appear there automatically with no separate
edit.

The pair is otherwise identical: same channels, same default. The only
difference is who may mute them.

## 3. The audience

Every broadcast targets the same population, defined by one function used by
every reader:

```ts
// apps/api/src/notifications/broadcasts/broadcast-audience.ts
export function audienceWhere(cutoff: Date): Prisma.UserWhereInput {
  return {
    isActive: true,
    createdAt: { lte: cutoff },
  };
}
```

`GET /admin/broadcasts/audience`, the start handler's `recipientsTargeted`
count, and the chunk handler's keyset paging **all call this one function**.
That is the entire point of factoring it out: a count taken against a
different predicate than the pages actually walk is what makes a progress
bar lie. Concretely, if the count used `isActive: true` alone while the
paging added `createdAt <= cutoff`, the admin UI would show a progress bar
climbing to 940/1000 and stopping there forever, with every job row
`succeeded` and no error anywhere — nothing broken except the number, and the
number is the only thing an operator has to go on. The inverse drift (a
count *narrower* than the paging) is worse, reporting more delivered than
were ever targeted.

The two clauses answer two different questions, one live and one frozen:

- `isActive: true` is evaluated **live, on every page**. A user deactivated
  mid-fan-out stops receiving the broadcast from the next chunk onward —
  deactivation is a statement about *now*. This is also why
  `recipientsTargeted` can legitimately exceed `recipientsDispatched`: the
  schema's own comment calls the former "targeted at send time," never
  "should have received it."
- `createdAt <= audienceCutoff` is **frozen**, stamped once by the start
  handler's compare-and-swap (§4) at the moment sending begins. Without it a
  fan-out on a busy deployment would keep discovering newly-created rows to
  page through as it walks — the query changes under it, so the run may
  never terminate, and "who got this?" stops being an answerable question
  after the fact.

That freeze defines two windows explicitly, and both are intentional rather
than edge cases discovered later:

- A user created **between `create` and `start`** (i.e. before the fan-out
  claims the broadcast and stamps the cutoff) **is included** — the rule is
  "everyone who exists once sending starts," not "everyone who existed when
  an admin clicked compose."
- A user created **between `start` and the last chunk** **is excluded** —
  they signed up after the audience was frozen, and by definition are not
  behind the cursor a resumed run would ever revisit.

## 4. Lifecycle and the state machine

```
draft --(unreachable in this epic)--> …
scheduled --[start handler CAS]--> sending --[chunk handler, empty page]--> sent
   |                                  |
   |                                  +--[fan-out job settles permanently:
   |                                      BroadcastFailureListener CAS]--> failed
   |                                                                         |
   |                                            [resume: BroadcastsService.resume CAS] |
   |                                                        sending <-----------+
   |
   +--[cancel: status in (scheduled, sending, failed)]--> canceled
```

Six statuses (`NotificationBroadcastStatus`): `draft`, `scheduled`,
`sending`, `sent`, `canceled`, `failed`. `draft` is unreachable by any route
this epic ships — no compose endpoint writes it, no handler reads it — and it
stays in the Postgres enum on purpose: adding a value to a live enum later is
a migration, and `ALTER TYPE … ADD VALUE` cannot run inside the same
transaction Prisma wraps a migration in. Paying for the slot now, while it
costs nothing, buys the escape hatch for a future "save and finish composing
later" feature without a migration on a table that by then holds real data.
Do not remove it as dead code — it is deliberately dead, not left over.

**`sending -> failed` and `failed -> sending` are both compare-and-swaps,
added by issue #459.** Before #459, a fan-out job (`admin.broadcast.start` or
`admin.broadcast.chunk`) that spent its attempt or rate-limit budget left the
broadcast `sending` forever — nothing wrote a terminal status, and the admin
list showed a send "in progress" that would never progress. `BroadcastFailure-
Listener` (`broadcast-failure.listener.ts`) closes that: it subscribes to
`JOB_SETTLED_EVENT` (§5's job queue), and when a fan-out job for a given
broadcast settles permanently `failed`, it CASes that broadcast `sending` ->
`failed`, `WHERE status = 'sending'` — so a cancel racing the same failure
wins if it lands first, and a broadcast already `sent`/`canceled`/`failed` is
untouched. `lastError` is set to `"<Start|Chunk> job <id> failed permanently
after <N> attempt(s): <cause>"` and `finishedAt` to the job's own
`finishedAt` — the moment the fan-out stopped, not "now" if that differs.
`POST /admin/broadcasts/:id/resume` (`BroadcastsService.resume`) is the way
back: a CAS `failed` -> `sending` (requiring `audienceCutoff` to be set, so a
row that was never actually claimed cannot be "resumed" into a no-op),
clearing `lastError`/`finishedAt` and enqueuing a fresh chunk job
(`skipDedup: true`, `reason: 'rerun'`) from the persisted cursor. See §9 for
the full mechanism, and §11 for its tests. It is a
listener rather than a job for the same reason `JobFailureNotifier` and
`NodeSecretRevoker` are: one bounded, single-row, indexed UPDATE is not
"duration worth accounting for" under CLAUDE.md rule 1.

**Every transition that matters is a compare-and-swap, never a
read-then-write**, because a read-then-write has a real window a concurrent
actor can land in:

```ts
// admin.broadcast.start — the claim
await prisma.notificationBroadcast.updateMany({
  where: { id, status: 'scheduled' },
  data: { status: 'sending', startedAt: now, audienceCutoff: now },
});
// count === 0 => somebody else already decided this broadcast's fate; no-op.
```

```ts
// POST /:id/cancel — the recall
await prisma.notificationBroadcast.updateMany({
  where: { id, status: { in: ['scheduled', 'sending', 'failed'] } },
  data: { status: 'canceled', canceledAt: new Date() },
});
```

(`'failed'` since #459 — cancelling a `failed` broadcast is how an operator
who will not resume it closes the record honestly, rather than leaving it
sitting as `failed` indefinitely.)

```ts
// the chunk handler's terminal write, on an exhausted audience
await prisma.notificationBroadcast.updateMany({
  where: { id, status: 'sending' },
  data: { status: 'sent', finishedAt: new Date() },
});
```

Why `updateMany` with the status **in the `WHERE`**, rather than a
`findUnique` followed by an `if` and an `update`: consider the read-then-write
shape spelled out concretely —

```ts
const b = await findUnique(...);          // status: 'scheduled'
if (b.status !== 'scheduled') return;     // ← passes
// ... an admin cancels here: status := 'canceled' ...
await update({ data: { status: 'sending' } });   // ← resurrects it
```

The window between the read and the write is small and it is real, and what
falls into it is a cancelled announcement going out to everybody anyway.
Putting the status in the `WHERE` instead makes the claim and the cancel race
**inside the database**, where Postgres guarantees exactly one of two
concurrent statements against the same row wins. `updateMany` rather than
`update` is deliberate too: `update` requires a unique match and throws
`P2025` when it finds none, which would turn "somebody already claimed this"
into a failed job and a retry; `updateMany` reports `count: 0`, a fact to
branch on rather than an exception to interpret.

This is also what makes an operator's manual rerun of an already-succeeded
start job (available from the admin Jobs dashboard) harmless: on rerun the
broadcast is `sending`, `sent`, `failed`, or `canceled` — never `scheduled` —
so the swap matches nothing. That matters specifically for `audienceCutoff`,
which is written in the same statement that consumes the only status a claim
can happen from, so no second execution can move it — a rerun cannot silently
redefine who the broadcast was for while chunks are already walking the
original population.

A `sending` row is the one case that is not simply a no-op (issue #469): the
handler routes it to a resume check instead of the swap above, and that check
only *acts* — recounting against the stored `audienceCutoff` and enqueuing a
first chunk — when the hand-off the claim began demonstrably never finished
(no cursor, no dispatches, no chunk job for it in any status). A `sending`
broadcast with a chunk chain already running still re-stamps nothing and
enqueues nothing, for the same reason a `sent`/`failed`/`canceled` rerun does;
see §5 for the four checks and why each is load-bearing.

**What cancel can and cannot un-send.** Cancel is the only recall mechanism
this feature has, and it is honest about its limits. It flips the status
(above); it does **not** delete queued `jobs` rows — deleting one would race
a worker claiming it, whereas the status guard is durable, and letting a
stale job run to a no-op keeps the `jobs` table's audit trail of what the
fan-out actually did intact. Both handlers re-check status (`process()`'s
first real branch in the chunk handler; every claim in the start handler) and
return without sending anything once it no longer reads `sending`. But the
chunk handler also re-checks status **mid-page**, every
`STATUS_RECHECK_INTERVAL` (25) recipients, specifically so a cancel does not
have to wait out an entire 200-recipient chunk before it takes effect. The
consequence stated plainly, because both the API description and the admin
UI's confirm dialog must say it too: **cancelling a `sending` broadcast may
still let up to one sub-group's worth of recipients already dispatched or
mid-dispatch go out** before the next status check lands. Cancel stops
everything after that point; it cannot recall what already left.

## 5. Fan-out

Two job types under `apps/api/src/notifications/broadcasts/handlers/`, each
self-registering from its own `onModuleInit()` per the job queue's
`handlers/README.md` convention — no migration, no enum arm, no worker
change, and both appear in the admin Jobs dashboard automatically once
labelled (`job-type-labels.ts`: `admin.broadcast.start` → "Broadcast start",
`admin.broadcast.chunk` → "Broadcast delivery"). Neither declares
`nodeResultSchema` or `persistNodeResult`, so both are **server-only** —
correct, since a remote worker node has no database access and no mail
credentials.

**`Job.scheduledFor` is the scheduler.** `POST /` enqueues the start job with
`scheduledFor: broadcast.scheduledFor ?? undefined`. A deferred job is
invisible to every replica's claim query until its time arrives, using the
`[status, scheduledFor, priority, createdAt]` index already built for exactly
this. "Send this Friday at 09:00" is therefore a `jobs` row that survives
every restart and redeploy between now and Friday, with no second scheduler
introduced (§10 covers the rejected `@Cron` sweeper).

**`admin.broadcast.start`** — dedup **left on** (the queue's default), so a
double-clicked "Send now" cannot enqueue two start jobs for the same subject
while one is pending or running. It loads the broadcast (a missing row is a
no-op, not a failure — the admin may have deleted it while the job sat
queued), performs the compare-and-swap in §4, counts the frozen audience with
`audienceWhere()` into `recipientsTargeted`, and enqueues the first chunk.

**Idempotent past its claim (issue #469).** The claim and the hand-off
(count, write `recipientsTargeted`, enqueue the first chunk) are separate
statements, so a start job that claims the broadcast and then throws — a
connection drop between the CAS and the enqueue, say — leaves the row
`sending` with nothing behind it. Its retry (or any later start execution for
this broadcast) finds `status: 'sending'` and, before touching the CAS at
all, checks whether that hand-off ever finished. It resumes — recounting
against the **stored** `audienceCutoff`, never a fresh `now`, so the frozen
audience never widens — only when **all four** hold:

- the row is `sending` with `audienceCutoff` set (a claim actually happened);
- `cursorUserId` is null **and** `recipientsDispatched` is `0` — on their own
  these miss a first chunk that is still `pending`, or one deferred by a
  rate limit at its very first recipient (#456), which has made no progress
  yet but is alive;
- no `admin.broadcast.chunk` job exists for this broadcast, **in any
  status** — on its own this misses a chain whose old chunk rows were
  removed by the job history purge, which is why the two checks above stay.
  "Any status" is deliberate: a chunk that ended `failed` already flipped the
  broadcast to `failed` through `BroadcastFailureListener`, so a `failed`
  chunk beside a `sending` broadcast is not a state this path needs to heal.

Both the fresh-claim path and the resume path call one shared hand-off
method, and its `recipientsTargeted` write is conditional on
`status = 'sending'` in both — so a cancel landing between the claim and the
count stops the enqueue exactly the same way whichever path is running. Any
start job for the broadcast may finish the hand-off safely, not only the one
that claimed it. A double execution racing through the resume check (a
zombie whose lease was reaped, still running beside its replacement) can
enqueue two first chunks in a narrow window; §5's own cursor CAS (below,
added by #459) collapses that to one chain with at most one page
(`BROADCAST_CHUNK_SIZE`, 200) of duplicate sends and an exact
`recipientsDispatched`.

**Operator side effect.** A broadcast already stranded `sending` by this bug
before the fix — no cursor, no dispatches, no chunk job — is repaired by
retrying its start job from the admin Jobs page: the retry now finishes the
hand-off instead of reporting a hollow `succeeded`. `BroadcastFailureListener`
(§4, §9) still covers the other half — a start job that spends its **final**
attempt before a retry manages to resume — by CASing the broadcast to
`failed` once that job settles, so it can be resumed the ordinary way.

**`admin.broadcast.chunk`** — enqueued with **`skipDedup: true`**, and this
is load-bearing in a way that fails **silently** if it is ever dropped.
Chunk *n* enqueues chunk *n+1* from inside its own `process()`, while chunk
*n* is itself still `running`. With dedup on (the default), `buildDedupKey`
computes the identical key for two jobs sharing a `type`/`subjectType`/
`subjectId`, the active-dedup unique index rejects the second insert, and
`JobsService.enqueue` resolves the conflict by handing back **the job already
in flight — chunk n, the one doing the enqueueing.** Nothing throws. Chunk n
returns normally and its row goes `succeeded`. The observable result: the
broadcast stops dead after one page (up to 200 recipients out of however many
were targeted), every job row reports `succeeded`, `lastError` is empty, and
there is no exception anywhere to point at — the only visible symptom is a
progress counter that stopped, indistinguishable from a send that finished.
Both enqueue sites (the start handler's first chunk, and the chunk handler's
own successor) pass `skipDedup: true`, and the handler spec asserts it
explicitly on both, because this is exactly the class of failure no other
test would notice.

Each chunk pages `users` with `audienceWhere(audienceCutoff)` plus
`id > cursorUserId`, `orderBy: { id: 'asc' }`, `take: 200`
(`BROADCAST_CHUNK_SIZE`) — keyset pagination on the primary key because it is
unique, immutable, and already indexed, so a page boundary is stable under
concurrent inserts and deletes; `createdAt` is deliberately not the paging
column because two rows can share a timestamp and a boundary drawn on it can
silently skip or repeat a user. Dispatch inside a page runs at a bounded
concurrency of 5 (`BROADCAST_SEND_CONCURRENCY`) through `notifyNow` (§7), not
`Promise.all` over the whole page — an unbounded pool would open as many
concurrent SMTP conversations as the page has members, trading a mail
provider's patience for latency nobody is waiting on.

**Duplicate over drop, and the bound is a number.** The cursor
(`cursorUserId`) and the dispatched counter are advanced in **one update,
after** a page (or sub-group) has actually been dispatched — never before.
Under the job queue's at-least-once contract, a process killed mid-chunk
therefore re-sends **at most `BROADCAST_CHUNK_SIZE` (200) recipients** on
retry, because the cursor still points at the start of the page that was
interrupted. The reverse ordering — advancing the cursor first, then
dispatching — was considered and rejected: the identical crash would instead
**skip** up to 200 people, and that failure is strictly worse on every axis
that matters. The duplicate is bounded, visible (two `notification_deliveries`
rows for the same recipient), and self-correcting (the send simply
completes). The drop is bounded by the same number but **invisible and
permanent** — nothing records who was skipped, the cursor moved, the job
succeeded, the counters look plausible, and the only evidence is 200 people
who never heard about the maintenance window. It cannot be detected after the
fact and cannot be repaired without re-sending to everyone. Tightening the
bound (flushing the cursor every 25 recipients instead of every 200) is a
constant change — the outer loop already walks in `STATUS_RECHECK_INTERVAL`
sub-groups for cancel latency — not a restructuring; it is not done today
because 200 duplicate notifications on a crash whose rate is "a deploy" is an
acceptable worst case against the cost of a round trip per 25 recipients.

The same rule now also commits a **partial** page: since issue #456, an email
provider throttling the fan-out mid-page stops the chunk before it finishes,
and the cursor moves only to the longest contiguous run of recipients that
completed without being throttled — never past the first refusal. That is
"duplicate over drop" holding at a smaller scale: whoever sent successfully
out of order behind the throttled recipient is re-sent, not skipped, and the
duplicate this time is bounded by `BROADCAST_SEND_CONCURRENCY` (5) rather than
by the chunk size, since only sends already in flight when the refusal landed
can have gotten past it. §9 has the full mechanism.

**The progress commit is itself a compare-and-swap, on the cursor this
execution read (issue #459).** `WHERE id = ? AND cursorUserId = <cursor read
at the top of this run>` (`IS NULL` for the first page). This matters because
two executions of the fan-out for the same broadcast can legitimately be
walking it at once: a `resume` (§4) enqueuing a fresh chunk from the
persisted cursor while an operator, from the Jobs page, separately retries
the old chunk job that failed — or a lease-expired chunk still finishing
beside the duplicate that reclaimed its slot. Both read the same cursor and
therefore send the identical page (that page is the ordinary bounded
duplicate described above), but only whichever commits first actually moves
the cursor; the other matches zero rows, logs it, and returns **without**
enqueuing a successor or writing a finish. Two chains collapse to one within
the one page they overlapped on, rather than each continuing to double every
page after it. Losing this race on a throttled page (#456) also returns
normally instead of throwing `RateLimitError` — the winning chain now owns
the broadcast, and deferring the loser would only resurrect the duplicate
that just lost.

## 6. Per-broadcast channel selection

An admin composing a broadcast picks a medium ("email only for this one").
That choice reaches the dispatcher as `NotifyOptions.channels` (a new,
optional fourth parameter on `notify`/`notifyNow`/`notifyAddress`) and is
applied as a **set intersection immediately after** the existing
`resolveChannels(event, preferences, policy)` call inside `dispatch()`, and
**before** the "every channel muted" empty-array check:

```ts
let channels = resolveChannels(event, recipient.preferences, policy);

if (options?.channels) {
  const requested = new Set(options.channels);
  channels = channels.filter((channel) => requested.has(channel));
}
```

**Why the intersection sits here and never inside `resolveChannels` itself**
is the load-bearing decision. `resolveChannels` is a pure function shared
with `GET /api/notifications/events`, the endpoint that builds the per-user
preferences matrix — an endpoint with no notion of a per-dispatch subset and
no reason to ever gain one. Adding the parameter there would push a
dispatch-time concept into the function the preferences page calls, and would
invite some future caller to pass it from the wrong side of that seam.
Intersecting an **already-resolved** list, instead, makes "this can only ever
narrow" **structurally true** rather than a property that has to be
re-verified on every change to this file: there is no path by which a
channel `resolveChannels` did not return can survive the filter. A channel
the event doesn't declare, one the admin kill switch dropped, one the
recipient muted — each is simply an element with nothing to intersect
against. Omitting `options` entirely reproduces pre-#321 behaviour exactly,
which is why the three pre-existing `notify()` call sites (`auth.service.ts`,
`users.service.ts`, `allowlist.service.ts`) are untouched.

**Interaction with `mandatory` and the kill switch.** The intersection is
permitted to narrow a `mandatory` event — that looks like a hole in the flag
and is not. The ruling: **`mandatory` binds the recipient, not the sender.**
It means "the user may not mute this," never "the sender may not choose a
medium" — an admin picking email-only for an announcement is not a user
opting out of it. See `docs/specs/browser-notifications.md` §5 for the
kill-switch/inbox-row split this composes with (`policyChannels` exempts
mandatory events from the deployment-wide switch; `isChannelEnabled` exempts
them from stored user preferences) — that mechanism is unchanged by this
epic and is not restated here.

**Where the `critical ⇒ browser` rule actually lives.** The one composition
rule this application needs — a broadcast marked critical must include the
`browser` channel, because the durable `notifications` row *is* the in-app
delivery in this application, and a critical announcement that skips it
leaves no record a recipient can ever go back and read — is **not** enforced
in the dispatcher. It lives in `CreateBroadcastDto`'s `superRefine` (#324):
`critical && !channels.includes('browser')` is a 400. This is deliberately a
policy about what one product surface (the admin composer) may compose, not
a mechanism inside the gate that decides what a `mandatory` event's
intersection may drop — folding it into `dispatch()` would make `mandatory`
mean two different things in two files. **The honest caveat, stated in the
DTO's own comment and repeated here:** a future call site that reaches
`notifyNow('admin.broadcast_critical', …)` without passing through this DTO
could still narrow to `['email']` alone, and nothing in the dispatcher would
stop it. If that becomes a real risk, the fix is a check at that new entry
point, not a special case inside the shared intersection.

## 7. Why `notifyNow` exists

This is the decision in this epic most likely to be looked at later and
"simplified" back out — so the case for it is made in full, once, here.

`notify()` is detached by design (see `notifications.service.ts`'s own
header): it schedules the dispatch on a microtask via `schedule()` and
returns immediately, before any channel has run. A chunk handler built on
`notify()` would violate the job queue's own contract three ways at once:

1. It would leave up to 200 dispatches in flight **after** `process()`
   returned to the worker.
2. The worker would then mark the job row `succeeded` for work that had not
   happened yet — the queue's record would assert something false, which is
   worse than a recorded failure, because a failure retries and a lie does
   not.
3. A SIGTERM moments later would drop everything past `notifications.
   service.ts`'s 5-second shutdown drain (`SHUTDOWN_DRAIN_MS`), with no job
   row left claiming responsibility for any of it.

`notifyNow(eventKey, userId, data, options?)` is the awaited sibling that
closes all three gaps: identical registry lookup, identical recipient
resolution, identical single gate in `dispatch()`, identical never-rejects
containment (both route through the same `runContained` helper) — the one
difference is that it does not detach. When the promise resolves, every
channel has been attempted and every delivery row has been written. It is
for background workers that own their own concurrency and need backpressure;
**never from a request path** — it puts a mail transport's latency inside
whatever awaits it, and a controller awaiting it would hold a Fastify request
open for as long as the transport takes to answer.

Since issue #456, `notifyNow` resolves a `NotifyNowResult` (`{ rateLimited,
retryAfterMs }`) rather than `void` — the one fact an awaiting background
caller can act on: whether any channel of this dispatch was refused by a
throttling provider, and the longest wait any of them named. It is
deliberately not a per-channel report; the delivery rows already are that
report, in the table built for it, and duplicating them into a return value
would invite a caller to branch on a single recipient's failure reasons that
are none of its business. `notifyNow` still never rejects: a dispatch that
threw internally, found no user, or resolved no channel reports `{
rateLimited: false, retryAfterMs: null }`, same as a clean send. `notify()`'s
detached path ignores the equivalent internal result — nobody is awaiting it,
so there is no caller to back off. See §9 for what reads this value.

**`flush()` is not a substitute, and this is the other reflex worth heading
off explicitly.** `flush()` awaits *every* dispatch currently in
`NotificationsService`'s in-flight set — including every unrelated one raised
by any concurrent request in the process — and it **loops** until that set
drains completely. Under a broadcast the set is being refilled continuously
by the fan-out itself (and by anything else the process happens to be
notifying at the same time), so the loop has no bound: a handler awaiting
`flush()` would be waiting on other people's work, for an unbounded time,
with no per-dispatch outcome to report even once it returned. `notifyNow` is
deliberately **not** tracked in the `inFlight` set `flush()` drains — that
set exists so an orderly shutdown can drain work *nobody is awaiting*; a
`notifyNow` call already has an awaiting owner (the chunk handler), and that
owner, not the notifications service, decides what happens to it on
shutdown.

## 8. Content model

The body a recipient reads is **plain text**, split into paragraphs on blank
lines (`\r?\n\s*\r?\n`); a single newline inside one paragraph is treated as
a soft wrap from the composer's textarea and joined with a space, because
mail clients reflow to the reader's window width and a hard-wrapped paragraph
would otherwise double-wrap into a ragged column on a phone. Empty
paragraphs are dropped.

**The escaping guarantee is structural, not a habit to remember.** This is
the first template in the codebase rendering content the codebase did not
write — every other template (`role-changed.email.ts`, for instance) knows
exactly what it is saying; this one renders a title and body an administrator
typed minutes earlier, and has no idea what is in them. `broadcast.email.ts`
splits the body into paragraphs and interpolates each one as a *value* into
the `html` tagged literal (`safe-html.ts`), which escapes it by construction.
The result is an array of `SafeHtml` fragments concatenated by the tag
system, so there is no point in the file where markup is assembled by string
concatenation — and therefore no point at which `SafeHtml.
unsafeFromTrustedString` (the one escape hatch `safe-html.ts` exposes) would
even be reachable. It occurs in the file's own header exactly once, in a
sentence stating that it is never called; a reviewer greps for a call site
and finds none. Raw HTML bodies and a markdown subset were both rejected for
the same reason: either requires that escape hatch on admin-supplied input,
turning a compromised admin account into stored XSS in every recipient's
mailbox and in `notifications.body` — which the bell renders as text, so the
two channels would additionally disagree about what the message even was.

**The browser/push template is a projection with a shape guard, not a second
renderer.** `EVENT_BROWSER_TEMPLATES`'s `broadcastBrowserTemplate` does not
truncate and does not sanitize a link — `browser-notification.channel.ts`
already applies `MAX_TITLE_LENGTH`/`MAX_BODY_LENGTH` truncation and
`sanitizeLink` once, to the values it both stores and streams, so doing
either again here would be a second chance for the stored row and the toast
to disagree about what the message said. What the projection *does* do,
because it is the one thing a pure projection still must do itself, is
validate its input's shape (`typeof title === 'string' && typeof body ===
'string'`) and throw inside the try/catch `render()` wraps it in — a
malformed payload becomes a recorded delivery failure, never an unhandled
exception reaching a broadcast recipient's chunk. One entry in the map serves
**both** browser and push: `push-notification.channel.ts` imports
`EVENT_BROWSER_TEMPLATES` and `sanitizeLink` from the browser channel rather
than declaring its own, so `admin.broadcast`/`admin.broadcast_critical` need
no third registration — a one-line comment in that file exists specifically
so nobody adds one.

## 9. Operational limits

**Email provider rate limits (issue #456).** The email channel's contract is
still to **never throw** — a send failure is always `{ success: false }` and a
failed `notification_deliveries` row, never an exception — so wiring it into
`provider-throttle.service.ts` could not mean "let it throw `RateLimitError`
like an ordinary handler." Instead the classification happens where the raw
transport error is still an object with a status code and a name, not yet a
redacted string: `BaseEmailProvider.send` (`base-email.provider.ts`) runs
every caught error through `classifyEmailRateLimit`
(`email-rate-limit.ts`), which recognises SES's throttle names, `429`/
`503`/`529`, a `Retry-After` header, and the SMTP codes `421`/`450`/`451`/
`452`/`454` **only** when the reply's own wording says "rate"/"throttle"/
"too many …"/"slow down"/"server busy" rather than a per-recipient condition
(greylisting, a full mailbox, over quota) that happens to share a 4xx code.
SES's **daily** sending quota is deliberately excluded even though AWS
reports it under the same `Throttling` name: a 24-hour quota outlives the
queue's entire rate-limit budget (`JOBS_RATELIMIT_MAX_HITS` deferrals capped
at `JOBS_RATELIMIT_MAX_MS` each — a couple of hours), so deferring on it would
only delay the same failure while leaving the broadcast in `sending`; it is
reported as an ordinary failed row instead, with the provider's own wording
on it, where an operator can see it and raise the quota. A false positive
here — reading a permanent failure as a throttle — is treated as the worse
mistake than a false negative, because it would stall an entire broadcast
behind one bad address; see `email-rate-limit.ts`'s own header for the full
asymmetry argument. The channel then still returns `{ success: false }`, now
with `rateLimited: true` (and `retryAfterMs` when the provider named one), and
writes the delivery row's `error` prefixed `Rate limited by the email
provider: ` so an operator can tell a throttle from a bad mailbox at a
glance. Web Push's own 429s are not classified anywhere — the push channel
never sets `rateLimited`, so a broadcast's push leg gets none of what
follows.

That flag travels up through exactly one path: `NotificationsService.
notifyNow` (§7) now resolves a `NotifyNowResult` — `rateLimited` if *any*
channel of the dispatch was throttled, `retryAfterMs` the longest wait any of
them named — instead of `void`. (`notify()` is unchanged; nobody awaits it,
so there is no caller to report a throttle to.) `BroadcastChunkHandler` is
the one place that turns that resolved fact into a thrown `RateLimitError` —
the one layer allowed to throw, raising the one error the queue already
understands. On the first rate-limited recipient in a page it stops
*launching* further sends (up to `BROADCAST_SEND_CONCURRENCY - 1` already in
flight are let finish, since an issued send cannot be recalled), commits the
cursor and `recipientsDispatched` to the longest **contiguous** prefix, in id
order, of recipients that completed without being rate-limited, enqueues no
successor, and throws. `JobTerminalService` defers that same chunk row to
`pending` under `scheduledFor` (`JOBS_RATELIMIT_*` backoff, charged against
`rateLimitHits` rather than `attempts`), and the chunk type is registered to
the shared provider key `BROADCAST_EMAIL_PROVIDER_KEY`
(`'notifications.email'`) so `ProviderThrottleService` holds off every
broadcast's chunks, not just this one's, for the cooldown. On resume the
chunk re-pages from the committed cursor exactly as any retry does. A
recipient who happened to complete *after* the throttled one, out of order,
is not counted in the committed prefix and is sent again on resume — §5's
"duplicate over drop" applied to a partial page, with the duplicate bounded
by `BROADCAST_SEND_CONCURRENCY` for the same reason it bounds the
steady-state pool (see `broadcast-audience.ts`'s header). A cancel observed
once the page has stopped wins over the throttle: the chunk returns normally
without deferring, rather than committing an admin to a cooldown for a
broadcast they already called off.

`rateLimitHits` lives on the one chunk row that keeps deferring, not on the
broadcast — so a chunk throttled more than `JOBS_RATELIMIT_MAX_HITS` times
(default 10) fails that row permanently, the same as any other permanently
failed chunk. Since issue #459 that is no longer a silent dead end: a
permanently failed fan-out job (this one, or an ordinary attempt-budget
exhaustion) is caught by `BroadcastFailureListener` on `JOB_SETTLED_EVENT`
and flips the broadcast `sending` -> `failed`, with `lastError` naming the
job, its attempt count and the underlying cause, and `finishedAt` set to when
the job gave up. An operator sees a `failed` row on the Broadcasts page (not
a stuck "in progress" one), reads why, and either resumes it (`POST
/admin/broadcasts/:id/resume`, which flips `failed` back to `sending`, clears
`lastError`/`finishedAt`, and enqueues a fresh chunk with `skipDedup: true`
from the persisted cursor) or cancels it (§4). See §4 for the state-machine
detail and §5 for the cursor compare-and-swap that keeps a resume and a stray
retry of the old chunk from double-sending more than one page's worth.

**Retrying the failed chunk job from the Jobs page does NOT resume the
broadcast.** That retry re-runs `BroadcastChunkHandler.process()` against a
broadcast that is still `failed`, and the handler's status guard (§4, §5) only
acts on `sending` — every other status, `failed` included, sends nothing and
returns. The only way back to `sending` is `POST
/admin/broadcasts/:id/resume`, which is the sole writer of that transition.
An admin who retries the dead job from the Jobs dashboard sees it succeed
(having done nothing) and the broadcast still reads `failed`, exactly as
designed — that job's retry and the broadcast's resume are deliberately two
different actions.

**Both gaps this section used to track are closed, by #468 and #469
respectively.** The lease reaper's permanent give-up (`JobStuckService`,
`jobs/job-stuck.service.ts` phase 1 — a job whose executor died on *every*
attempt) used to write `status: 'failed'` directly without emitting
`JOB_SETTLED_EVENT`, so a chunk that died that way stranded its broadcast in
`sending` with nothing to catch it. Since #468 the reaper's give-up emits the
event too (`docs/specs/job-queue.md` §7.2), through the same `emitJobSettled`
helper the terminal path uses, so `broadcast-failure.listener.ts` now sees it
and fails the broadcast exactly as it would for an in-process give-up.

The other gap was upstream of the listener entirely: a start job that fails
on a *non-final* attempt after its compare-and-swap to `sending` committed
but before the first-chunk enqueue leaves the broadcast `sending` with no
terminal job row yet for the listener to react to. Since #469 that retry (or
any later start execution for the broadcast) is idempotent past its claim —
it finishes the interrupted hand-off itself against the stored
`audienceCutoff` rather than being a no-op — so the broadcast heals on the
very next attempt instead of depending on the attempt budget running out
first. See §5 for the four checks that decide when a resume finishes the
hand-off. `BroadcastFailureListener` remains the backstop for the case #469
does not touch: a start job whose *final* attempt is the one that fails after
the claim, with no further retry left to resume it.

**The approximate delivery window closes and reopens with `failed`/resume
(#459).** The `[startedAt, finishedAt ?? now]` window below treats a
`failed` row's `finishedAt` as the moment the fan-out stopped, so the window
for a `failed` broadcast is closed and stable rather than still counting
against "now." A resume clears `finishedAt`, and the window reopens to "now"
until the resumed fan-out itself finishes, fails again, or is cancelled;
`startedAt` never moves, so the window still spans the whole broadcast,
pause included, rather than restarting at the resume.

**The SSE per-process boundary matters more here than for a single-recipient
event.** `notification-stream.service.ts`'s per-process fan-out (no replay,
no `Last-Event-ID`, one process's open connections only) is a property this
codebase already lived with for ordinary single-user notifications, where it
is invisible — one user, one process, usually one open tab. A broadcast makes
the same boundary visible at scale: across a multi-instance deployment, each
process only streams live-toast updates to the browser tabs connected to
*it*, so "did everyone's bell update instantly" is a per-process question,
not a deployment-wide guarantee — the durable `GET /api/notifications` read
and the row in Postgres are still the source of truth regardless of which
process handled a given recipient's dispatch.

**A `notification_deliveries` row cannot be attributed to a specific
broadcast**, and the detail view is honest about the resulting
approximation rather than pretending otherwise. `NotificationDelivery`
carries no broadcast id — adding one would mean a migration on the
fastest-growing table in the schema, plus threading a broadcast id from this
feature through `notifyNow` and into a dispatcher deliberately ignorant of
who is calling it, purely to make one admin screen's number exact (§10 has
the full rejection). Instead, `GET /:id` computes
`approximateDeliveryAttempts` as `groupBy(['channel', 'status'])` over
`notification_deliveries` filtered by this broadcast's `eventKey` and by
`createdAt` between `startedAt` and `finishedAt ?? now`. That window can
**over-count**: a second broadcast raised under the same event key while this
one is still sending contributes its rows to the same total, and nothing in
the schema can separate them. The field name says so on purpose
(`approximateDeliveryAttempts`, not `deliveries` or `stats`) and the UI
labels it "delivery attempts during this broadcast" for the same reason — a
shorter name would be read as exact by the next person who touches the
screen.

## 10. Rejected alternatives

- **A `notification_broadcast_recipients` join table**, tracking exact
  per-recipient delivery outcome. Rejected: one row per (broadcast, user)
  pair is unbounded growth keyed to user-base size on *every* broadcast sent
  — a 50,000-user deployment sending one broadcast a week is 2.6 million new
  rows a year for this feature alone — for a marginal gain over what
  `cursorUserId`/`audienceCutoff` plus the two counters already give: the
  queue's own at-least-once contract already bounds a replay to at most one
  chunk, so re-processing is inherently limited to users near the resume
  boundary, not the whole broadcast.
- **A `broadcastId` column on `notification_deliveries`**, for exact
  attribution in the detail view. Rejected: a migration on the
  fastest-growing table in the schema, plus threading a broadcast id through
  a dispatcher (`notify`/`notifyNow`) deliberately ignorant of its callers,
  to make one screen's number exact instead of approximate. See §9.
- **One job per recipient.** Right at a different scale, wrong here:
  thousands of `jobs` rows per broadcast make the admin dashboard unusable,
  give `job-history-purge` thousands of rows per send to grind through,
  render `job_stats_rollup`'s per-type averages meaningless (an "average
  broadcast job" would measure one email), and turn a single "Send now" into
  thousands of inserts.
- **One long-running job with an in-memory loop.** Resumes correctly enough
  and fails on everything around it: it holds a worker slot for the entire
  broadcast, starving a queue sized for human-triggered work; the
  lease-expiry sweep would need tuning to a runtime nobody can predict; and
  the Jobs page would show one perpetually-`running` row with no visible
  progress in it.
- **A `@Cron` scheduler instead of `Job.scheduledFor`.** Would duplicate
  what the queue's own `scheduledFor` column and its
  `[status, scheduledFor, priority, createdAt]` index already do durably,
  and would add a second place where "is it time yet?" is decided.
- **Widening `resolveChannels` to accept the per-dispatch subset.** Rejected
  — see §6. `resolveChannels` is shared with `GET /api/notifications/events`,
  which has no per-dispatch concept and should never grow one.
- **A `broadcast` value on `JobReason`.** `JobReason` is a three-member
  Prisma enum (`upload | rerun | backfill`); adding a fourth for a display
  string is a migration plus web-side `JOB_REASONS` array churn plus OpenAPI
  churn, for something the friendly label in `job-type-labels.ts` already
  carries to a human reading the dashboard. Both broadcast job types reuse
  `backfill`, exactly as `job-history-purge.task.ts` already does.
- **Markdown or raw HTML bodies.** Both require the `unsafeFromTrustedString`
  escape hatch on admin-supplied input somewhere, turning a compromised admin
  account into stored XSS in every recipient's mailbox (raw HTML) or
  requiring a hand-rolled inline-HTML emitter that is itself a new injection
  surface (a markdown subset) — and either has no meaning at all on the
  browser/push channels, whose content is plain strings. See §8.
- **`@mui/x-date-pickers`** for the schedule field. Rejected: a new
  dependency plus a locale adapter for one field, in a repo that has shipped
  none; a native `TextField type="datetime-local"` with `slotProps={{
  inputLabel: { shrink: true } }}` (the `FilterEditor.tsx` precedent) does
  the job.
- **Role targeting** (send to Admins only, Contributors only, …). Out of
  scope for this epic by design — "all active users" is the entire targeting
  model; a role filter is a real feature that would need its own audience
  predicate, its own UI, and its own answer to "what does the audience count
  mean now."
- **Reusing `system_settings:read`/`:write`** as the broadcast permission.
  Rejected: that pair is the kill switch's permission — configuring whether
  browser notifications are allowed at all — and mirroring it on the
  broadcasts settings card would advertise a permission the broadcasts
  controller never actually checks. `broadcasts:read`/`broadcasts:write` are
  their own pair, seeded to Admin only, matching the `jobs:*`/`nodes:*`/
  `users:*` convention for a collection resource.

## 11. Verification

| Claim | Covered by |
|---|---|
| `NotificationBroadcast`'s generated field set and `NotificationBroadcastStatus`'s enum members match the schema | `apps/api/test/broadcasts/broadcast-model.db.spec.ts` (asserted against `Prisma.NotificationBroadcastScalarFieldEnum`, generated from `schema.prisma`) |
| The `[status, scheduledFor]` and `[createdAt desc]` indexes and column defaults exist on the real table | `apps/api/test/broadcasts/broadcast-model.db.spec.ts` (the `resolveDbSuite`-gated half, real Postgres only) |
| Both event keys satisfy the registry's structural invariants (unique key, non-empty channels, `mandatory` implies `defaultEnabled`, `<area>.<event>` key shape) with **no edit** to the generic test | `apps/api/src/notifications/notification-events.spec.ts` — its loops iterate `NOTIFICATION_EVENTS`, so the two new entries are covered automatically |
| `NotifyOptions.channels` narrows a three-channel event to the requested subset, cannot resurrect a policy-dropped or user-muted channel, and an explicit `[]` means no channels | `apps/api/src/notifications/notifications.service.spec.ts`, `describe('NotifyOptions.channels')` |
| A mandatory event is still narrowable by `options.channels` (the recipient-vs-sender ruling) | `apps/api/src/notifications/notifications.service.spec.ts`, `'a mandatory event still ignores stored preferences, and is still narrowable'` |
| `notifyNow()` resolves only after every channel has been attempted and every delivery row written, resolves a `NotifyNowResult` (`rateLimited` if any channel was, `retryAfterMs` the longest named wait, `{ false, null }` when nothing was throttled or dispatch found no channel), and shares `notify()`'s narrowing | `apps/api/src/notifications/notifications.service.spec.ts`, `describe('notifyNow()')` |
| SES throttle names/`429`/`503`/`529`, a `Retry-After` header, and "Maximum sending rate exceeded" wording are classified as a rate limit; SES's daily quota, auth failures, and every SMTP 5xx are not | `apps/api/src/email/email-rate-limit.spec.ts` |
| SMTP `421`/`450`/`451`/`452`/`454` are a rate limit only with throttle wording in the reply; the same codes with greylisting/mailbox-full/over-quota wording are not | `apps/api/src/email/email-rate-limit.spec.ts` |
| `BaseEmailProvider.send` classifies the raw thrown error and returns `{ success: false, rateLimited: true, retryAfterMs? }` without throwing, and a non-throttle failure keeps its pre-#456 `{ success, error }` shape | `apps/api/src/email/base-email.provider.spec.ts` |
| The email channel prefixes a rate-limited delivery's stored error `Rate limited by the email provider: ` and carries `rateLimited`/`retryAfterMs` onto its result, never throwing | `apps/api/src/notifications/channels/email-notification.channel.spec.ts` |
| `dispatch()` accumulates the dispatch-wide throttle verdict across channels (any channel rate-limited, the longest `retryAfterMs`) without skipping a later channel because an earlier one was throttled | `apps/api/src/notifications/notifications.service.spec.ts` |
| `BroadcastChunkHandler` stops launching further sends on the first rate-limited recipient, commits the longest contiguous un-throttled prefix, enqueues no successor, and throws `RateLimitError` carrying the longest named `retryAfterMs`; a cancel observed once the page stops returns normally instead | `apps/api/src/notifications/broadcasts/handlers/broadcast-chunk.handler.spec.ts` |
| A throttled mid-page run defers the chunk under `JOBS_RATELIMIT_*`, and resuming it completes the broadcast with every recipient dispatched — nobody skipped, duplicates bounded by `BROADCAST_SEND_CONCURRENCY` | `apps/api/test/broadcasts/broadcast-fanout.db.spec.ts` |
| The email template escapes every paragraph by construction and never calls `unsafeFromTrustedString` | `apps/api/src/email/templates/broadcast.email.spec.ts` |
| Both event keys map to the one `'broadcast'` email template and the one shared browser/push renderer | `email-notification.channel.ts` / `browser-notification.channel.ts` registrations, exercised via the handler specs' dispatch assertions |
| The start handler's claim puts `status` in the `WHERE`, stamps `startedAt`/`audienceCutoff` from one instant, counts with `audienceWhere()`, and enqueues the first chunk with `skipDedup: true` | `apps/api/src/notifications/broadcasts/handlers/broadcast-start.handler.spec.ts` |
| A compare-and-swap that claims nothing (already `sending`/`sent`/`canceled`) re-stamps nothing and enqueues nothing | `broadcast-start.handler.spec.ts`, `describe('when the compare-and-swap claims nothing')` |
| A `sending` broadcast resumes its hand-off only when all four conditions hold (cutoff set, no cursor, zero dispatched, no chunk job in any status), recounts against the **stored** `audienceCutoff` rather than a fresh `now`, and is a no-op — no recount, no write, no enqueue — the moment any one condition fails (fan-out already progressing, or a chunk job already exists) | `apps/api/src/notifications/broadcasts/handlers/broadcast-start.handler.spec.ts` |
| A cancel landing between the claim and the hand-off's `recipientsTargeted` write stops the enqueue, on both the fresh-claim path and the resume path, because the write is conditional on `status = 'sending'` in both | `broadcast-start.handler.spec.ts` |
| The chunk handler's status guard neutralises a cancelled, finished, deleted, or cutoff-less broadcast | `apps/api/src/notifications/broadcasts/handlers/broadcast-chunk.handler.spec.ts`, `describe('the status guard')` |
| Paging is keyset (`id > cursor`, `orderBy: id asc`), frozen at the cutoff, and skips inactive users | `broadcast-chunk.handler.spec.ts`, `describe('paging')` |
| Dispatch uses `notifyNow` (never the detached `notify`) with the broadcast's stored channels | `broadcast-chunk.handler.spec.ts`, `describe('dispatch')` |
| The cursor and dispatched counter advance together, in one update, after sends — never before | `broadcast-chunk.handler.spec.ts`, `describe('progress')` |
| A chunk enqueues its successor **only** with `skipDedup: true`, on a full page only, and finishes the broadcast on a short page | `broadcast-chunk.handler.spec.ts`, `describe('the chain')` |
| A cancel landing mid-page stops the chunk without waiting out the remainder and queues no successor | `broadcast-chunk.handler.spec.ts`, `describe('cancellation mid-page')` |
| A retried chunk resumes from the persisted cursor rather than replaying earlier pages | `broadcast-chunk.handler.spec.ts`, `describe('idempotence under at-least-once delivery')` |
| Every database error in either handler propagates (throws to fail) rather than being swallowed | Both handler specs, `describe('throw to fail')` |
| Literal routes (`/audience`, `/test`) resolve ahead of `/:id` through the real Nest router | `apps/api/test/broadcasts/broadcasts.integration.spec.ts`, `describe('literal routes resolve before :id')` |
| All eight routes require Admin + the correct `broadcasts:read`/`broadcasts:write` permission | `broadcasts.integration.spec.ts`, `describe('authorization')` |
| `critical: true` without `browser` in `channels` is a 400; the event key is derived and a client-supplied `eventKey` is ignored | `broadcasts.integration.spec.ts`, `describe('POST /admin/broadcasts validation')` |
| Cancel is a conditional `updateMany` (status in `WHERE`, `failed` included since #459), 404 for a missing row vs. 409 for a wrong-status row, and deletes no queued job row | `apps/api/src/notifications/broadcasts/broadcasts.service.spec.ts`, `describe('cancel')` |
| Delete refuses with 409 while `sending`; a cancelled, sent or failed broadcast can be deleted | `broadcasts.service.spec.ts`, `describe('remove')`; `broadcasts.integration.spec.ts`'s 409-on-cancel-of-sent case |
| A permanently `failed` fan-out job (`admin.broadcast.start` or `admin.broadcast.chunk`) CASes its broadcast `sending` -> `failed` with a prefixed `lastError` and `finishedAt`; matches only `sending` (a broadcast already `sent`/`canceled`/`failed`, or one belonging to a different subject, is untouched); errors inside the listener are caught and logged, never rethrown into the settle path | `apps/api/src/notifications/broadcasts/broadcast-failure.listener.spec.ts` |
| The chunk handler's progress commit is a CAS on the cursor it read (`IS NULL` for the first page); losing it returns normally with no successor enqueued and no `RateLimitError` thrown, even on a throttled page | `apps/api/src/notifications/broadcasts/handlers/broadcast-chunk.handler.spec.ts` |
| `BroadcastsService.resume`: CASes `failed` -> `sending` only when `audienceCutoff` is set, clears `lastError`/`finishedAt`, enqueues a fresh chunk with `skipDedup: true` and `reason: 'rerun'`, 404 for a missing row, 409 for any non-`failed` status, and compensates back to `failed` with a `lastError` naming the enqueue failure (then rethrows) if the enqueue itself throws | `apps/api/src/notifications/broadcasts/broadcasts.service.spec.ts`, `describe('resume')` |
| `POST /admin/broadcasts/:id/resume` requires Admin + `broadcasts:write`, returns the resumed row on 200, and 409s for a broadcast that is not `failed` | `apps/api/test/broadcasts/broadcasts.integration.spec.ts`, `describe('POST /admin/broadcasts/:id/resume')` |
| Against real Postgres: a permanently failed fan-out job flips its broadcast to `failed` through the real `JobTerminalService` (not a mocked settle event); a cancel racing that failure lands on whichever write commits first; a resume reaches exactly the remainder of the frozen audience; two concurrent fan-out chains for the same broadcast (a resume and a stray retry of the old failed chunk) collapse to one within the page they overlap on | `apps/api/test/broadcasts/broadcast-fanout.db.spec.ts` |
| The admin Broadcasts page renders a Resume row action (disabled unless `failed` + `broadcasts:write`), its confirm names the bounded duplicate window, the cancel confirm has a `failed` branch, and the detail dialog shows a "Stopped after X of Y" summary on a `failed` row | `apps/web/src/__tests__/pages/Admin/BroadcastsPage.test.tsx` |
| `sendTest` dispatches to the caller only, writes no row, queues no job | `broadcasts.service.spec.ts`, `describe('sendTest')` |
| `audience()` counts with the same `audienceWhere()` the fan-out pages with | `broadcasts.service.spec.ts`, `describe('audience')` |
| The approximate delivery breakdown windows by event key and `[startedAt, finishedAt ?? now]`, and is empty before `startedAt` exists | `broadcasts.service.spec.ts`, `describe('get')` |
| Every state-changing route writes an audit event with identifiers and shape, **never the composed body** | `broadcasts.service.spec.ts` — each of `create`/`cancel`/`remove`/`sendTest`'s `'audits … without the body'` cases |
| 250 active + 10 inactive seeded users: the dispatched set equals exactly the active users with `createdAt` ≤ `audienceCutoff` (recomputed from the DB), inactive excluded, `recipientsDispatched` matches, status ends `sent`, ≥2 chunks ran | `apps/api/test/broadcasts/broadcast-fanout.db.spec.ts`, real Postgres only, run by `npm run test:db` |
| A user created after `audienceCutoff` is excluded from the audience | `broadcast-fanout.db.spec.ts` |
| Two concurrent `start` executions on two separate `PrismaClient` connections, overlapped with `Promise.all`, resolve to exactly one winner: `startedAt`/`audienceCutoff` stamped once, the loser resolves as a no-op, exactly one chunk job row is enqueued | `broadcast-fanout.db.spec.ts` |
| Replaying the same chunk job after its cursor has advanced pages only the window after the cursor, never earlier ids | `broadcast-fanout.db.spec.ts` |
| A cancel landing between two chunk jobs stops the fan-out | `broadcast-fanout.db.spec.ts` |
| A cancel committed while a chunk is mid-dispatch: the in-flight send completes, but the terminal compare-and-swap cannot flip `canceled` to `sent` — `finishedAt` stays null and no successor is enqueued | `broadcast-fanout.db.spec.ts` |
| A chunk the lease reaper gives up on (its executor died on every attempt) still flips its broadcast `sending` -> `failed`, end to end, through the reaper's `job.settled` emit rather than `JobTerminalService`'s | `apps/api/test/broadcasts/broadcast-fanout.db.spec.ts` |
| A start job that claims a broadcast and then fails on a non-final attempt (before the first chunk is enqueued) is retried and completes the fan-out end to end, against the original `audienceCutoff`, with no chunk skipped or duplicated beyond the ordinary bound | `apps/api/test/broadcasts/broadcast-fanout.db.spec.ts` |
| A `sending` broadcast whose fan-out has already made progress, or whose cursor was reset by an admin cancel/resume in between, is left alone by a later start execution | `broadcast-fanout.db.spec.ts` |
| Two concurrent start executions that both reach the resume path for the same stranded broadcast (a double execution of the same zombie start job) collapse to one chunk chain, via the #459 cursor CAS, with `recipientsDispatched` exact and duplicates bounded to at most one page | `broadcast-fanout.db.spec.ts` |

**What this still doesn't prove.** `broadcast-fanout.db.spec.ts` drives the
real `BroadcastStartHandler` and `BroadcastChunkHandler` against a real
Postgres instance, through a real `JobsService` — only `notifyNow` and the
handler registry are stubbed — so the compare-and-swap's atomicity and the
audience's keyset paging are now exercised under real row locking, not
inferred from a mocked statement's shape. Two limits remain, and are worth
stating precisely rather than papering over: it proves the outcome under
**two** overlapping executions on **one** Postgres instance, not what an
arbitrary number of concurrent executions or a multi-replica deployment
would do; and because `NotificationsService` is stubbed, it proves **who is
dispatched to** (the recipient set, the counts, the cursor), not that an
email or a push notification actually arrives in an inbox or a browser.
