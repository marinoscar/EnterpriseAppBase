import { createHash } from 'node:crypto';

import type {
  NotificationRow,
  NotificationsInputJsonValue,
  NotificationsJsonValue,
  NotificationsPrisma,
  NotificationsTx,
} from './data/notifications-db';
import type { InboxWrite } from './notification.types';

// =============================================================================
// NotificationInboxWriter — the STATE and COUNTED inbox writes (issue #1077)
// =============================================================================
//
// `notify()` appends one inbox row per call. Two kinds of producer cannot live
// with that, and this class is the single place that writes their rows:
//
//   STATE    "N items await review". At most ONE live row per (user, scope,
//            event), refreshed in place, dismissed when the count drains to
//            zero. A scope with 929 pending items is one row, never 929.
//   COUNTED  "N uploads finished". Repeated occurrences fold into ONE row
//            whose `data.count` grows, optionally inside a rolling window
//            anchored on the row's last update. A 4 000-file import is one row
//            with `count: 4000`.
//
// -----------------------------------------------------------------------------
// HOW A RACE IS DECIDED
// -----------------------------------------------------------------------------
//
// Every write runs in ONE transaction that first takes
// `pg_advisory_xact_lock(hashtext(user|dedupKey))`. A row lock cannot do this:
// the case that must be serialized is "no row exists yet", where there is
// nothing to lock. The lock is transaction-scoped, so it is released on commit
// or rollback and a crashed worker cannot leak it.
//
// The partial unique index `notifications_live_dedup_uniq_idx`
// (user_id, dedup_key WHERE dismissed_at IS NULL AND dedup_key IS NOT NULL) is
// the backstop: the lock makes the common case wait instead of fail, and the
// index guarantees that a writer which somehow bypassed the lock (a second
// process using another lock key, a hand-written insert) still cannot create a
// second live row. A unique violation is therefore treated as "somebody else
// won the insert" and retried ONCE as a fold into the winner's row.
//
// -----------------------------------------------------------------------------
// WHY RENDERING HAPPENS INSIDE THE TRANSACTION
// -----------------------------------------------------------------------------
//
// The title ("12 uploads finished") depends on the TOTAL count, which is only
// known once the live row has been read under the lock. The writer therefore
// takes a `render(data)` callback and calls it with the merged payload. It is a
// pure, synchronous template function, so it holds the lock for microseconds.
//
// -----------------------------------------------------------------------------
// WHAT IT NEVER DOES
// -----------------------------------------------------------------------------
//
//   * It does not run inside the producer's own transaction. A producer calls
//     `notifyState` / `notifyCounted` AFTER its write commits (the same
//     notify-after-commit rule as `notify()`); this writer opens its own
//     transaction.
//   * It does not log `data`.
// =============================================================================

/**
 * What a template produced, already length-capped and link-sanitised.
 *
 * @stability experimental
 */
export interface InboxContent {
  /** The title. */
  title: string;
  /** The body. */
  body: string;
  /** A sanitised root-relative link, or null. */
  link: string | null;
}

/**
 * Why an inbox write changed what the user sees.
 *
 * @stability experimental
 */
export type InboxWriteReason = 'created' | 'incremented' | 'reunread';

/**
 * The outcome of one STATE or COUNTED write.
 *
 * @stability experimental
 */
export interface InboxWriteResult {
  /** The row's id. */
  id: string;
  /** When the row was first created. */
  createdAt: Date;
  /** When this write refreshed it. */
  updatedAt: Date;
  /** The row's `data.count` after the write. */
  count: number;
  /** The row's scope, or null. */
  scopeId: string | null;
  /** Why this is news: a new row, a row that grew, or a read row that is unread again. */
  reason: InboxWriteReason;
  /** True when the row did not change what the user sees (a STATE refresh with an unchanged count). */
  quiet: boolean;
}

/**
 * Renders the row from the final payload; may throw (the writer lets it propagate before writing).
 *
 * @stability experimental
 */
export type InboxRender = (data: Record<string, unknown>) => InboxContent;

/** Longest dedup key stored; longer keys are hashed. */
const MAX_DEDUP_KEY_LENGTH = 200;

/** Prisma's unique-violation code. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * Builds the dedup key of a STATE row: one per `(eventKey, scopeId)`.
 *
 * @stability experimental
 */
export function stateDedupKey(eventKey: string, scopeId: string | null): string {
  return capKey(`state:${eventKey}:${scopeId ?? '-'}`);
}

/**
 * Builds the dedup key of a COUNTED row: one per `(eventKey, scopeId, match)`.
 * The match object is serialised with sorted keys, so `{a, b}` and `{b, a}`
 * fold together.
 *
 * @stability experimental
 */
export function countedDedupKey(
  eventKey: string,
  scopeId: string | null,
  match: Readonly<Record<string, string | number | boolean>> | undefined,
): string {
  const entries = Object.entries(match ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const suffix = entries.length === 0 ? '' : `:${JSON.stringify(entries)}`;
  return capKey(`counted:${eventKey}:${scopeId ?? '-'}${suffix}`);
}

function capKey(key: string): string {
  if (key.length <= MAX_DEDUP_KEY_LENGTH) return key;
  return `${key.slice(0, 120)}#${createHash('sha256').update(key).digest('hex').slice(0, 40)}`;
}

function asRecord(value: NotificationsJsonValue | null | undefined): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === UNIQUE_VIOLATION;
}

/**
 * Writes STATE and COUNTED inbox rows.
 *
 * Exported for an app's own unit tests (`@marinoscar/platform-api/notifications/testing`); not an extension point: reach it through `NotificationsService.notifyState` and `notifyCounted`.
 *
 * @internal
 */
export class NotificationInboxWriter {
  constructor(private readonly prisma: NotificationsPrisma) {}

  /**
   * Upserts the single live STATE row, or returns null when `mode.count` is
   * not positive (use {@link dismissLive} for that).
   *
   * The refresh replaces title, body, link and `data` wholesale, carrying
   * `countAtRead` forward (replacing `data` would otherwise silently disable the
   * re-unread rule until the row is next read). A READ row is re-marked unread
   * only when `reunreadWhen` is `count-increased`, the new count exceeds a
   * recorded `countAtRead`, and nothing else: never on a decrease, never on an
   * equal count, never on a row with no `countAtRead` (absent means "already
   * seen"; re-unreading on it would re-nag every legacy row on every refresh).
   */
  async upsertState(
    userId: string,
    eventKey: string,
    mode: Extract<InboxWrite, { kind: 'state' }>,
    data: Record<string, unknown>,
    render: InboxRender,
  ): Promise<InboxWriteResult> {
    return this.withRetry(() =>
      this.locked(userId, mode.dedupKey, async (tx) => {
        const live = await this.findLive(tx, userId, mode.dedupKey);
        const payload = { ...data, count: mode.count };

        if (!live) {
          const content = render(payload);
          const created = await tx.notification.create({
            data: {
              userId,
              eventKey,
              ...content,
              scopeId: mode.scopeId,
              data: payload as NotificationsInputJsonValue,
              dedupKey: mode.dedupKey,
            },
          });
          return result(created, mode.count, 'created', false);
        }

        const previous = asRecord(live.data);
        const previousCount = asCount(previous['count']);
        const countAtRead = asCount(previous['countAtRead']);

        const grew = previousCount === null ? true : mode.count > previousCount;
        const reunread =
          live.readAt !== null &&
          mode.reunreadWhen === 'count-increased' &&
          countAtRead !== null &&
          mode.count > countAtRead;

        const merged: Record<string, unknown> = { ...payload };
        if (countAtRead !== null) merged['countAtRead'] = countAtRead;

        const content = render(merged);
        const updated = await tx.notification.update({
          where: { id: live.id },
          data: {
            ...content,
            scopeId: mode.scopeId,
            data: merged as NotificationsInputJsonValue,
            ...(reunread ? { readAt: null } : {}),
          },
        });

        // Quiet: nothing for the user to notice (same count, still as read or
        // unread as before). The row is refreshed but no stream frame is sent.
        const quiet = !reunread && !(grew && live.readAt === null);
        return result(updated, mode.count, reunread ? 'reunread' : 'incremented', quiet);
      }),
    );
  }

  /**
   * Folds one occurrence into the live COUNTED row, or starts a new row.
   *
   * Inside the window (or with none) the live row's `data.count` grows by
   * `increment`, its text is re-rendered with the new total, and `readAt` is
   * cleared so continued activity re-badges the bell. Outside the window the
   * old row is RETIRED (its `dedup_key` becomes `retired:<id>` so the key is free; it stays in
   * the inbox as the record of that batch) and a fresh row starts at
   * `increment`.
   */
  async upsertCounted(
    userId: string,
    eventKey: string,
    mode: Extract<InboxWrite, { kind: 'counted' }>,
    data: Record<string, unknown>,
    render: InboxRender,
    now: Date = new Date(),
  ): Promise<InboxWriteResult> {
    return this.withRetry(() =>
      this.locked(userId, mode.dedupKey, async (tx) => {
        let live = await this.findLive(tx, userId, mode.dedupKey);

        if (live && mode.windowMs !== null && now.getTime() - live.updatedAt.getTime() > mode.windowMs) {
          // Retire, do not delete or dismiss: the user still sees that batch.
          // The key becomes 'retired:<id>', unique to the row, so the live key
          // is free and the row still reads as a folded one (non-null key) to
          // the retention sweep. Raw: Prisma's `update` would also bump
          // `updated_at`, rewriting the timestamp this row is evidence of.
          await tx.$executeRaw`UPDATE notifications SET dedup_key = ${`retired:${live.id}`} WHERE id = ${live.id}::uuid`;
          live = null;
        }

        if (!live) {
          const payload = { ...data, count: mode.increment };
          const content = render(payload);
          const created = await tx.notification.create({
            data: {
              userId,
              eventKey,
              ...content,
              scopeId: mode.scopeId,
              data: payload as NotificationsInputJsonValue,
              dedupKey: mode.dedupKey,
            },
          });
          return result(created, mode.increment, 'created', false);
        }

        const previous = asRecord(live.data);
        const total = (asCount(previous['count']) ?? 0) + mode.increment;
        // The latest occurrence's fields win; the count accumulates and any
        // `countAtRead` is untouched.
        const merged: Record<string, unknown> = { ...previous, ...data, count: total };

        const content = render(merged);
        const wasRead = live.readAt !== null;
        const updated = await tx.notification.update({
          where: { id: live.id },
          data: {
            ...content,
            data: merged as NotificationsInputJsonValue,
            readAt: null,
          },
        });

        return result(updated, total, wasRead ? 'reunread' : 'incremented', false);
      }),
    );
  }

  /**
   * Dismisses the live row of `dedupKey` (a STATE row whose count drained to
   * zero). Dismissal implies read. Returns whether a row was dismissed.
   */
  async dismissLive(userId: string, dedupKey: string): Promise<boolean> {
    return this.locked(userId, dedupKey, async (tx) => {
      const touched = await tx.$executeRaw`
        UPDATE notifications
        SET dismissed_at = now(), read_at = COALESCE(read_at, now()), updated_at = now()
        WHERE user_id = ${userId}::uuid AND dedup_key = ${dedupKey} AND dismissed_at IS NULL`;
      return touched > 0;
    });
  }

  /** Runs `work` in a transaction holding the advisory lock of `(userId, dedupKey)`. */
  private locked<T>(userId: string, dedupKey: string, work: (tx: NotificationsTx) => Promise<T>): Promise<T> {
    const lockKey = `${userId}|${dedupKey}`;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      return work(tx);
    });
  }

  /** One retry on a unique violation: the winner's row exists now, so the retry folds into it. */
  private async withRetry<T>(attempt: () => Promise<T>): Promise<T> {
    try {
      return await attempt();
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return attempt();
    }
  }

  private findLive(tx: NotificationsTx, userId: string, dedupKey: string): Promise<NotificationRow | null> {
    return tx.notification.findFirst({ where: { userId, dedupKey, dismissedAt: null } });
  }
}

function result(row: NotificationRow, count: number, reason: InboxWriteReason, quiet: boolean): InboxWriteResult {
  return {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    count,
    scopeId: row.scopeId ?? null,
    reason,
    quiet,
  };
}
