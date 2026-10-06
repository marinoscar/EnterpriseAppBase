import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Observable, type Subscriber } from 'rxjs';

import { exceedsEventBusPayloadLimit } from '../common/event-bus/event-bus-core';
import { EVENT_BUS, type EventBus, type EventBusMeta } from '../common/event-bus/event-bus.interface';
import { PrismaService } from '../prisma/prisma.service';

// =============================================================================
// NotificationStreamService — the live half of the browser channel (#127, #109)
// =============================================================================
//
// A per-process registry of open SSE connections, keyed by user id. The
// browser channel writes a `notifications` row and then calls `publish` here;
// any tab that user has open receives it without polling.
//
// -----------------------------------------------------------------------------
// PER-USER ISOLATION IS STRUCTURAL, NOT A FILTER
// -----------------------------------------------------------------------------
//
// This is the security property the whole issue turns on, so it is built into
// the shape of the registry rather than into a predicate somebody has to
// remember to write.
//
// REJECTED: one process-wide `Subject` that every connection subscribes to,
// each applying `.filter(e => e.userId === me)`. It works, and it is one
// deleted line, one inverted comparison, or one added `.merge()` away from
// broadcasting every user's notifications to every open tab — a leak with no
// error, no failing request and nothing in a log. A reviewer would have to
// notice the absence of a predicate to catch it.
//
// CHOSEN: fan-out at the registry. `subscribers` maps a user id to that user's
// own subscribers, `publish(userId, …)` writes to exactly one bucket, and
// there is NO method on this class that reaches more than one user — no
// broadcast, no "subscribe to everything", no way to reach another user's
// connections. To
// leak a notification you would have to publish it under the wrong key, and
// the key comes from the `user_id` of the row that was just written. The
// controller supplies the id from the authenticated principal
// (`@CurrentUser('id')`) and never from a path, query or body parameter, so
// there is no user-supplied value anywhere on the path that selects a stream.
//
// -----------------------------------------------------------------------------
// ACROSS REPLICAS: THROUGH THE EVENT BUS, AT MOST ONCE (PP-1.11, #682)
// -----------------------------------------------------------------------------
//
// The registry itself is still one Map in one Node heap: a connection lives
// on the replica whose socket it is, and nothing else can write to it. What
// changed is that `publish` no longer stops at this process. It delivers to
// this replica's connections directly (`deliverLocal`, the original body) and
// then hands the same event to the event bus on `notifications.stream`. Every
// OTHER replica's instance of this class receives it from the bus and runs
// the same `deliverLocal` against its own Map. What that means per adapter
// (`EVENT_BUS_ADAPTER`, see common/event-bus/):
//
//   - `in-process` (the default when unset): exactly the old behaviour. The
//     bus reaches this process only, and this class ignores its own local
//     echo, so with ONE replica every connection is reached. With two or more,
//     a tab on pod B still sees nothing for an event published on pod A.
//   - `postgres`: LISTEN/NOTIFY. A tab connected to any replica receives the
//     event, normally within milliseconds.
//
// ISOLATION IS UNCHANGED, AND STILL STRUCTURAL. A bus message names ONE user
// and is delivered with `deliverLocal(thatUser, …)` into that user's bucket
// and no other; there is still no method that reaches more than one user. The
// user id on the message is the one `publish` was called with — the `user_id`
// of the row just written — and a message received from the bus is validated
// and dropped if malformed, never "best-effort" delivered.
//
// OVERSIZE EVENTS TRAVEL BY REFERENCE. A rendered body is unbounded in bytes
// (multi-byte text, JSON escaping), and a bus envelope is capped at
// `EVENT_BUS_MAX_PAYLOAD_BYTES`. When the full event would not fit, the bus
// carries `{ userId, ref: { notificationId, toast, pushed } }` and the
// receiving replica reads the row back with BOTH `id` AND `userId` in the
// `where` — so a forged or mistaken reference can never surface another
// user's notification. A row that is gone is dropped silently.
//
// STILL NOT A DELIVERY GUARANTEE. The bus is at most once with no replay: a
// replica whose listener is reconnecting misses what was sent meanwhile. That
// stays survivable for the reason it always was — THE TABLE, NOT THE STREAM,
// IS THE SOURCE OF TRUTH. The `notifications` row is written by the channel
// BEFORE this is called, in the shared database every replica reads, so the
// bell and the unread count are correct everywhere; a tab that missed the
// live nudge picks the notification up on its next fetch. Losing liveness is
// a degradation; losing the notification would be a defect, and the ordering
// (row first, publish second) is what keeps it the former.
//
// -----------------------------------------------------------------------------
// RECONNECTION: `EventSource` RETRIES, BUT NOTHING IS REPLAYED
// -----------------------------------------------------------------------------
//
// `EventSource` reconnects on its own after a drop. It does NOT get the events
// it missed while disconnected — this class holds no buffer, honours no
// `Last-Event-ID`, and has no replay log. SSE IS NOT A DELIVERY GUARANTEE, and
// anyone reading this file later will assume it is unless it says so here.
//
// The fix is not replay. THE CLIENT REFETCHES ON (RE)CONNECT — the unread
// count and the recent list, from `GET /api/notifications/unread-count` and
// `GET /api/notifications` — and is therefore correct after any gap of any
// length, including one caused by the multi-replica case above. Building
// replay would add a durable per-connection cursor to make the stream do what
// one indexed query already does correctly. The same refetch covers a live
// event a replica missed while its bus listener was reconnecting.
// =============================================================================

/**
 * One notification, as it crosses the wire to an open tab.
 *
 * Deliberately the SAME SHAPE the REST endpoints return for a row
 * (`dto/notification.dto.ts`), so a client can push a streamed event straight
 * into the list it fetched without a second mapping. A divergent "live" shape
 * is how a bell ends up rendering two different objects depending on how the
 * notification arrived. The two deltas are `readAt` (absent — a notification is
 * unread by definition at the instant it is published) and `toast` (present —
 * see the field, it is an instruction about THIS delivery rather than a
 * property of the stored row).
 *
 * Carries no user id. The recipient is implicit in WHICH stream this was
 * written to, and echoing it back would invite a client — or a future refactor
 * — to start filtering on it, which is exactly the design rejected above.
 */
export interface NotificationStreamEvent {
  id: string;
  eventKey: string;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;

  /**
   * MAY THE CLIENT RAISE AN OS TOAST FOR THIS? (#226, epic #215)
   *
   * The one field that is NOT on the stored row, and the one that makes this
   * shape not quite "a notification minus `readAt`". It is a per-event
   * instruction from the server, computed at publish time from the deployment's
   * admin policy (`isBrowserToastAllowed` in notification-policy.ts):
   * `browserEnabled && !disabledEvents.includes(eventKey)`.
   *
   * COMPUTED SERVER-SIDE ON PURPOSE. The client also fetches
   * `GET /api/notifications/config` to decide whether to ask for OS permission
   * at all, and that answer is cached in a long-lived tab. This flag travels
   * WITH the event, so an admin turning toasts off takes effect on the next
   * notification rather than on the next reload — the server stays
   * authoritative even when a client's cached config is stale.
   *
   * FALSE DOES NOT MEAN "SUPPRESSED". The row was still written and this frame
   * was still sent; the bell, the unread count and the notification centre are
   * unaffected. Only the OS bubble is withheld. That distinction is the whole
   * point of the flag: `security.role_changed` is `mandatory: true` and must
   * reach the user's inbox no matter what an operator has muted. In practice
   * only a mandatory event is ever published with `toast: false`: a
   * non-mandatory event the policy suppresses never reaches the browser
   * channel, so no row is written and no frame is sent.
   *
   * #227 is what acts on it. Until then it is published and ignored, which is
   * the harmless direction.
   */
  toast: boolean;

  /**
   * IS THIS NOTIFICATION ALSO GOING OUT OVER WEB PUSH TO THIS USER? (#625)
   *
   * True when this notification is also being delivered over Web Push to this
   * user; a client holding an active push subscription may skip its own OS
   * toast because the service worker will show one.
   *
   * Derived from the dispatcher's final channel list for this recipient (admin
   * policy, preferences and per-dispatch narrowing applied). It means the push
   * channel is part of this dispatch, not that a push was delivered to THIS
   * browser — hence "a client holding an active push subscription". It does not
   * change what `toast` means.
   */
  pushed: boolean;
}

/**
 * SSE `event:` name carrying a new notification.
 *
 * NAMED RATHER THAN THE DEFAULT `message`. A named event lets the client
 * register `addEventListener('notification', …)` and stay unbothered by
 * anything else this stream ever carries; an unnamed event would make every
 * future addition a breaking change for a handler that assumed `message` meant
 * "a notification".
 */
export const NOTIFICATION_SSE_EVENT = 'notification';

/**
 * How often an idle connection is sent a comment line.
 *
 * WHY A HEARTBEAT AT ALL: an SSE connection that sends nothing is
 * indistinguishable, to everything between the browser and this process, from
 * a dead one. `infra/nginx/nginx.conf` sets `proxy_read_timeout 60s` on
 * `location /api` today (the change is #127's infra half, out of this
 * commit's scope), and load balancers, corporate proxies and NAT tables all
 * apply idle timeouts of their own. Without traffic the connection is reaped,
 * the client reconnects, and the cycle repeats — a reconnect storm that looks
 * like a flapping backend.
 *
 * 25 SECONDS, chosen to sit comfortably under a 30s idle timeout (the
 * shortest in common use, and half of nginx's current 60s) with room for a
 * scheduling delay. Shorter wastes wakeups on every idle tab; longer starts
 * losing the race with the tightest proxy in the chain.
 *
 * A COMMENT (`: …`), NOT AN EVENT. Comment lines are consumed by `EventSource`
 * and never surface to the page, so a heartbeat cannot be mistaken for a
 * notification by a client that forgot to check the event name — while still
 * being real bytes on the wire, which is all a proxy's idle timer cares about.
 */
export const HEARTBEAT_INTERVAL_MS = 25_000;

/**
 * The comment text sent as a heartbeat. Content is irrelevant to the protocol;
 * it is here so a human reading `curl` output knows what they are looking at.
 */
const HEARTBEAT_COMMENT = 'heartbeat';

/**
 * A message on the wire, in the shape `@Sse()` serialises.
 *
 * Structurally `@nestjs/common`'s `MessageEvent`, redeclared locally so this
 * file — like `notification-events.ts` and `notification-preferences.ts` next
 * door — stays free of framework imports and testable by calling functions.
 */
export interface SseMessage {
  data?: string | object;
  type?: string;
  comment?: string;
}

/** The event bus channel this service fans out on (PP-1.11). */
export const NOTIFICATION_STREAM_BUS_CHANNEL = 'notifications.stream';

/**
 * What crosses the bus: the full event, or — when the full event would not fit
 * in a bus envelope — a reference the receiver resolves against the table.
 * Either way, exactly ONE user.
 */
export type NotificationStreamBusMessage =
  | { userId: string; event: NotificationStreamEvent }
  | { userId: string; ref: { notificationId: string; toast: boolean; pushed: boolean } };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isStreamEvent(value: unknown): value is NotificationStreamEvent {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    isNonEmptyString(e.id) &&
    typeof e.eventKey === 'string' &&
    typeof e.title === 'string' &&
    typeof e.body === 'string' &&
    (e.link === null || typeof e.link === 'string') &&
    typeof e.createdAt === 'string' &&
    typeof e.toast === 'boolean' &&
    typeof e.pushed === 'boolean'
  );
}

/**
 * Validates a message received from the bus, or returns `null`.
 *
 * The bus is a shared database channel, so a message is DATA to check, not an
 * instruction to follow: anything not exactly one of the two shapes above is
 * dropped rather than partially delivered.
 */
export function parseNotificationStreamBusMessage(raw: unknown): NotificationStreamBusMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const message = raw as Record<string, unknown>;
  if (!isNonEmptyString(message.userId)) return null;

  if ('event' in message) {
    return isStreamEvent(message.event) ? { userId: message.userId, event: message.event } : null;
  }

  const ref = message.ref as Record<string, unknown> | undefined;
  if (
    typeof ref === 'object' &&
    ref !== null &&
    isNonEmptyString(ref.notificationId) &&
    typeof ref.toast === 'boolean' &&
    typeof ref.pushed === 'boolean'
  ) {
    return {
      userId: message.userId,
      ref: { notificationId: ref.notificationId, toast: ref.toast, pushed: ref.pushed },
    };
  }

  return null;
}

@Injectable()
export class NotificationStreamService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationStreamService.name);

  /** Unsubscribes from the bus on shutdown; null when there is no bus. */
  private unsubscribeBus: (() => void) | null = null;

  /**
   * BOTH OPTIONAL, so `new NotificationStreamService()` remains a complete,
   * single-process instance (the unit suite builds it that way). In the
   * application the `@Global()` `EventBusModule` and `PrismaModule` always
   * provide them. Prisma is read ONLY to resolve an oversize event's reference.
   */
  constructor(
    @Optional() @Inject(EVENT_BUS) private readonly bus?: EventBus,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  /** Starts receiving other replicas' events. Registers a handler; no I/O. */
  onModuleInit(): void {
    if (!this.bus || this.unsubscribeBus) return;

    this.unsubscribeBus = this.bus.subscribe<unknown>(
      NOTIFICATION_STREAM_BUS_CHANNEL,
      (message, meta) => this.onBusMessage(message, meta),
    );
  }

  /**
   * user id -> that user's open connections.
   *
   * A `Set` per user because one person legitimately has several tabs open,
   * and each is its own connection that must receive its own copy. The bucket
   * is DELETED when it empties rather than left as an empty Set: a long-lived
   * process serving many users would otherwise accumulate one Map entry per
   * user who ever connected — a slow leak that nothing ever reclaims.
   */
  private readonly subscribers = new Map<string, Set<Subscriber<SseMessage>>>();

  /**
   * Open a stream for ONE user.
   *
   * The returned Observable is COLD and per-caller: the registration happens
   * in the subscribe function, so a connection that is created and never
   * subscribed (a client that vanishes during setup) registers nothing and
   * leaks nothing.
   *
   * @param userId the AUTHENTICATED principal's id. There is no other correct
   *        argument — see the isolation note in the header. A caller passing
   *        an id taken from a request parameter has built an IDOR, and the
   *        controller is written so that value does not exist.
   */
  subscribe(userId: string): Observable<SseMessage> {
    return new Observable<SseMessage>((observer) => {
      // The SUBSCRIBER itself is what gets registered — there is no
      // intermediate Subject. One less object per connection, and more
      // importantly one less place a write can land while the connection it
      // was meant for has already gone away.
      let bucket = this.subscribers.get(userId);
      if (!bucket) {
        bucket = new Set();
        this.subscribers.set(userId, bucket);
      }
      bucket.add(observer);

      // An immediate comment, before anything else.
      //
      // NOT DECORATION. `SseStream` defers the response headers until the
      // first message, so with nothing to send the browser sits with no
      // headers and `EventSource.onopen` never fires — the client cannot tell
      // "connected and idle" from "still connecting". Worse, a buffering proxy
      // has nothing to flush and holds the connection open with zero bytes
      // through its own idle timeout.
      //
      // A comment rather than an event, for the same reason heartbeats are:
      // it commits the headers and proves the path end to end without the page
      // seeing a message it has to recognise and discard.
      observer.next({ comment: 'connected' });

      const heartbeat = setInterval(() => {
        observer.next({ comment: HEARTBEAT_COMMENT });
      }, HEARTBEAT_INTERVAL_MS);

      // `unref` so an open SSE connection can never be the reason the process
      // refuses to exit. Without it a single idle tab keeps the event loop
      // alive and a `docker compose down` waits for its stop grace period on
      // every deploy. `?.` because a test environment's fake timers may not
      // implement it.
      heartbeat.unref?.();

      this.logger.debug(
        `SSE connection opened for user ${userId} ` +
          `(${bucket.size} for this user, ${this.subscribers.size} users connected).`,
      );

      // TEARDOWN. Returned from the subscribe function, so RxJS runs it on
      // EVERY exit path — client disconnect (Nest unsubscribes on the raw
      // socket's `close`), stream completion, and error — rather than only on
      // the one a hand-written `close` listener remembered to cover.
      //
      // Everything allocated above is released here, in the same order it was
      // taken: the interval (a leaked one fires forever against a dead
      // observer) and the registration (a leaked one keeps this user's bucket
      // non-empty so it is never reclaimed, and makes `publish` write into a
      // closed connection on every event thereafter).
      //
      // Idempotent by construction — `clearInterval`, `Set.delete` and
      // `Map.delete` are all safe to run twice — because RxJS is not the only
      // thing that can trigger it and a teardown that must run exactly once is
      // a teardown that eventually runs zero times.
      return () => {
        clearInterval(heartbeat);

        const open = this.subscribers.get(userId);
        if (open) {
          open.delete(observer);
          if (open.size === 0) this.subscribers.delete(userId);
        }

        this.logger.debug(`SSE connection closed for user ${userId}.`);
      };
    });
  }

  /**
   * Deliver a notification to every connection this user currently has open
   * — on this replica directly, and on every other replica through the event
   * bus (`notifications.stream`; see the header for what each adapter reaches).
   *
   * NEVER THROWS, and that is a hard requirement rather than a courtesy: the
   * only caller is `BrowserNotificationChannel.deliver`, which is on the
   * dispatcher's never-throw path (#125). A connection that has somehow
   * already errored must not turn into a failed delivery for a row that was
   * written successfully.
   *
   * NO-OP WHEN NOBODY IS LISTENING, and that is the NORMAL case — the user has
   * no tab open. It is emphatically not a failure: the `notifications` row is
   * already written and the bell will show it at next login. The browser
   * channel therefore reports success on a publish that reached zero
   * connections; see its own comment for why anything else would mark real
   * deliveries as failures.
   *
   * @returns how many connections ON THIS REPLICA it was written to. For
   *          logging and tests only — no caller makes a delivery decision from
   *          it, and other replicas' deliveries are not (cannot be) counted.
   */
  publish(userId: string, event: NotificationStreamEvent): number {
    const delivered = this.deliverLocal(userId, event);

    // Then every other replica, fire and forget. `EventBus.publish` never
    // rejects, so neither does this; the `void` is the whole error handling.
    if (this.bus) {
      void this.bus.publish(NOTIFICATION_STREAM_BUS_CHANNEL, this.busMessageFor(userId, event));
    }

    return delivered;
  }

  /**
   * The full event when it fits in a bus envelope, a reference when it does
   * not. See "OVERSIZE EVENTS TRAVEL BY REFERENCE" in the header.
   */
  private busMessageFor(userId: string, event: NotificationStreamEvent): NotificationStreamBusMessage {
    const full: NotificationStreamBusMessage = { userId, event };
    if (!exceedsEventBusPayloadLimit(NOTIFICATION_STREAM_BUS_CHANNEL, full)) return full;

    return { userId, ref: { notificationId: event.id, toast: event.toast, pushed: event.pushed } };
  }

  /**
   * Another replica's event. Our own (`meta.local`) was already delivered by
   * `publish`, so it is ignored — delivering it again would double every frame.
   */
  private async onBusMessage(raw: unknown, meta: EventBusMeta): Promise<void> {
    if (meta.local) return;

    const message = parseNotificationStreamBusMessage(raw);
    if (!message) {
      this.logger.warn(`Dropping a malformed "${NOTIFICATION_STREAM_BUS_CHANNEL}" message from the event bus.`);
      return;
    }

    if ('event' in message) {
      this.deliverLocal(message.userId, message.event);
      return;
    }

    // Nobody on this replica is listening for this user: skip the read.
    if (this.connectionCount(message.userId) === 0) return;

    const event = await this.resolveReference(message.userId, message.ref);
    if (event) this.deliverLocal(message.userId, event);
  }

  /**
   * Reads a referenced notification back, scoped to its user.
   *
   * ⚠ `id` AND `userId` ARE BOTH IN THE `where`. The id alone would let a
   * reference naming user A and notification-of-user-B push B's row into A's
   * tabs. With both, the worst a bad reference can do is find nothing.
   */
  private async resolveReference(
    userId: string,
    ref: { notificationId: string; toast: boolean; pushed: boolean },
  ): Promise<NotificationStreamEvent | null> {
    if (!this.prisma) return null;

    try {
      const row = await this.prisma.notification.findFirst({
        where: { id: ref.notificationId, userId },
        select: { id: true, eventKey: true, title: true, body: true, link: true, createdAt: true },
      });

      if (!row) return null;

      return {
        id: row.id,
        eventKey: row.eventKey,
        title: row.title,
        body: row.body,
        link: row.link,
        createdAt: row.createdAt.toISOString(),
        toast: ref.toast,
        pushed: ref.pushed,
      };
    } catch (err) {
      this.logger.debug(
        `Could not resolve a streamed notification reference: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
      return null;
    }
  }

  /**
   * Writes one event into ONE user's bucket on THIS replica. The original body
   * of `publish`, and still the only code that touches a connection.
   */
  private deliverLocal(userId: string, event: NotificationStreamEvent): number {
    const bucket = this.subscribers.get(userId);
    if (!bucket || bucket.size === 0) return 0;

    let delivered = 0;

    for (const observer of bucket) {
      try {
        observer.next({ type: NOTIFICATION_SSE_EVENT, data: event });
        delivered += 1;
      } catch (err) {
        // A closed or errored connection. Logged at debug, not warn: the
        // overwhelmingly likely cause is a connection that died between the
        // Map lookup and this write, which is an ordinary race on a stream
        // whose client is a browser tab that can be closed at any instant.
        this.logger.debug(
          `Dropping a stream write for user ${userId}: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        );
      }
    }

    return delivered;
  }

  /**
   * Number of open connections for a user. Diagnostics and tests only.
   */
  connectionCount(userId: string): number {
    return this.subscribers.get(userId)?.size ?? 0;
  }

  /**
   * Close every open stream on shutdown.
   *
   * Without this, a rolling deploy leaves clients hanging on a socket this
   * process will never write to again until a TCP timeout notices — seconds to
   * minutes of a bell that looks connected and receives nothing. Completing
   * the subscriber ends the response cleanly, `EventSource` sees the close
   * immediately and reconnects to the new instance, which is the fastest
   * correct recovery available.
   *
   * The per-connection teardown above also runs (completion is one of its exit
   * paths), so intervals and Map entries are released here too.
   */
  async onModuleDestroy(): Promise<void> {
    this.unsubscribeBus?.();
    this.unsubscribeBus = null;

    if (this.subscribers.size === 0) return;

    this.logger.log(
      `Closing SSE connections for ${this.subscribers.size} user(s) on shutdown.`,
    );

    // Snapshot both levels before completing anything: `complete()` runs the
    // per-connection teardown, which mutates the Map and the Sets being
    // iterated — and mutating a collection mid-iteration is how a shutdown
    // silently skips half its connections.
    for (const bucket of [...this.subscribers.values()]) {
      for (const observer of [...bucket]) {
        observer.complete();
      }
    }

    this.subscribers.clear();
  }
}
