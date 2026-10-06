import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  EVENT_BUS,
  type EventBus,
  type EventBusHealth,
  type EventBusMeta,
} from '../../common/event-bus/event-bus.interface';
import { InProcessEventBus } from '../../common/event-bus/in-process-event-bus';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { DEFAULT_PRINCIPAL_CACHE_TTL_SECONDS } from './principal-cache.config';

// =============================================================================
// PrincipalCache — short-TTL principals for JWT validation (PP-1.12, #683)
// =============================================================================
//
// Every JWT request used to run a four-level join (user → userRoles → role →
// rolePermissions → permission) before its controller ran. This cache holds
// the result of that join, keyed by user id, for at most
// `AUTH_PRINCIPAL_CACHE_TTL_SECONDS` (default 30; `0` turns it off).
//
// THE SECURITY PROPERTY IT MUST NOT BREAK (docs/SECURITY-ARCHITECTURE.md §1):
// the database is authoritative for roles and `isActive`, so a role change or
// a deactivation reaches the very next request. That survives because every
// code path that changes what a principal resolves to calls `invalidate()`
// AFTER its write commits:
//
//   - locally, synchronously: the entry is gone before `invalidate` returns,
//     so the next request on THIS replica reads the database again;
//   - remotely, through the event bus (`auth.principal.invalidate`): every
//     other replica drops its entry within bus latency;
//   - and if the bus is down, the TTL is the backstop: a stale entry lives at
//     most `ttlMs`, far below the 15-minute access-token lifetime.
//
// `test/auth/principal-invalidation-sites.spec.ts` fails the build when a new
// `userRole` / `user.update` write appears in a file that never invalidates.
//
// WHAT IS NOT CACHED, deliberately:
//   - the device-session (`did`) liveness check — it runs on every request, so
//     `DELETE /api/auth/device/sessions/{id}` stays immediate;
//   - PAT and node credentials — their token row must be read per request for
//     revocation and expiry anyway;
//   - token material of any kind. An entry is the user/role/permission row
//     graph the join already loaded, nothing more.
//
// BOUNDED: at most `PRINCIPAL_CACHE_MAX_ENTRIES`, evicted in insertion order.
// FROZEN: an entry is a deep-frozen clone, so no request can mutate a
// principal another request will be handed.
// RACE-SAFE: see `generation()` — a read that started before an invalidation
// can never store its (stale) result after it.
// =============================================================================

/** The bus channel every replica listens on. Payload: {@link PrincipalInvalidation}. */
export const PRINCIPAL_INVALIDATE_CHANNEL = 'auth.principal.invalidate';

/** The most principals one process holds. Insertion-order eviction past it. */
export const PRINCIPAL_CACHE_MAX_ENTRIES = 10_000;

/** Optional DI token for the clock (ms since epoch). Tests inject one; production uses `Date.now`. */
export const PRINCIPAL_CACHE_CLOCK = Symbol('PRINCIPAL_CACHE_CLOCK');

/**
 * What to drop: one user's principal, or every principal (a role ↔ permission
 * change affects everyone holding that role, and there is no index from role
 * to user in the cache).
 */
export type PrincipalInvalidation = { userId: string } | { all: true };

export interface PrincipalCacheStats {
  size: number;
  hits: number;
  misses: number;
  invalidations: number;
}

interface Entry {
  value: AuthenticatedUser;
  expiresAt: number;
}

/**
 * A deep copy of a Prisma row graph: plain objects, arrays, `Date`s and
 * primitives. Anything else (a class instance, a function) throws, and the
 * caller declines to cache — never true of the join `validateJwtPayload`
 * runs. Hand-rolled rather than `structuredClone` so a copied `Date` belongs
 * to the caller's realm (Jest runs specs in a VM context).
 */
function deepCopy<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol') {
      throw new TypeError('not a plain value');
    }
    return value;
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepCopy(item)) as T;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError('not a plain object');
  }
  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    copy[key] = deepCopy(item);
  }
  return copy as T;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function isInvalidation(payload: unknown): payload is PrincipalInvalidation {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return p.all === true || (typeof p.userId === 'string' && p.userId.length > 0);
}

@Injectable()
export class PrincipalCache implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrincipalCache.name);

  /** 0 = disabled: `get` always misses and `set` never stores. */
  readonly ttlMs: number;

  private readonly entries = new Map<string, Entry>();

  // ---------------------------------------------------------------------------
  // Generations (the in-flight read race)
  // ---------------------------------------------------------------------------
  // A request that started its database read BEFORE an invalidation could
  // otherwise `set()` the pre-change principal AFTER it, re-poisoning the
  // cache for a whole TTL. So every invalidation moves a counter, the reader
  // captures `generation(userId)` before it reads, and `set()` refuses when
  // the value has moved since.
  //
  // One monotonic counter serves both scopes: a per-user invalidation stamps
  // that user with a fresh value, an `all` invalidation stamps the epoch (and
  // forgets the per-user stamps, which the new epoch outranks). A user's
  // generation is the larger of the two, so it changes whenever ANY
  // invalidation that covers the user happens.
  private counter = 0;
  private epoch = 0;
  private readonly generations = new Map<string, number>();

  private hits = 0;
  private misses = 0;
  private invalidations = 0;

  private unsubscribe: (() => void) | null = null;

  /** The process's bus; a private in-process one only in a graph without `EventBusModule`. */
  private readonly bus: EventBus;

  constructor(
    config: ConfigService,
    // Optional for the same reason as in `NotificationStreamService`: a test
    // graph built from one feature module has no `EventBusModule`. There the
    // cache still invalidates locally (single process); the app always has
    // the global bus, and the Doctor reports which one this cache uses.
    @Optional() @Inject(EVENT_BUS) bus?: EventBus,
    @Optional() @Inject(PRINCIPAL_CACHE_CLOCK) private readonly now: () => number = Date.now,
  ) {
    this.bus = bus ?? new InProcessEventBus();
    const seconds = config.get<number>('auth.principalCacheTtlSeconds');
    const ttlSeconds =
      typeof seconds === 'number' && Number.isSafeInteger(seconds) && seconds >= 0
        ? seconds
        : DEFAULT_PRINCIPAL_CACHE_TTL_SECONDS;
    this.ttlMs = ttlSeconds * 1000;
  }

  /** Whether the cache stores anything at all. */
  get enabled(): boolean {
    return this.ttlMs > 0;
  }

  onModuleInit(): void {
    this.logger.debug(
      this.enabled
        ? `JWT principal cache enabled: TTL ${this.ttlMs / 1000}s, at most ${PRINCIPAL_CACHE_MAX_ENTRIES} entries, ` +
            `invalidated on "${PRINCIPAL_INVALIDATE_CHANNEL}" (${this.bus.adapter} bus)`
        : 'JWT principal cache disabled (AUTH_PRINCIPAL_CACHE_TTL_SECONDS=0)',
    );

    if (this.unsubscribe) return;

    // Subscribed even when disabled: it costs nothing, and keeps the
    // generation counter moving so a mixed-TTL fleet mid-rollout stays safe.
    this.unsubscribe = this.bus.subscribe<unknown>(
      PRINCIPAL_INVALIDATE_CHANNEL,
      (payload: unknown, meta: EventBusMeta) => {
        // Local deliveries were already applied synchronously by `invalidate`.
        if (meta.local) return;
        if (!isInvalidation(payload)) {
          this.logger.warn(`Ignoring a malformed message on "${PRINCIPAL_INVALIDATE_CHANNEL}"`);
          return;
        }
        this.drop(payload);
      },
    );
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.entries.clear();
  }

  /** The cached principal, or `undefined` when absent, expired or disabled. */
  get(userId: string): AuthenticatedUser | undefined {
    if (!this.enabled) return undefined;

    const entry = this.entries.get(userId);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(userId);
      this.misses += 1;
      return undefined;
    }

    this.hits += 1;
    return entry.value;
  }

  /**
   * The value to capture BEFORE reading the database for `userId`, and to
   * hand back to {@link set}. Moves whenever an invalidation covering
   * `userId` happens, locally or from another replica.
   */
  generation(userId: string): number {
    return Math.max(this.epoch, this.generations.get(userId) ?? 0);
  }

  /**
   * Stores a deep-frozen copy of `value` and returns it — unless the cache is
   * disabled, or `expectedGeneration` is no longer current (an invalidation
   * happened while the caller was reading), in which case nothing is stored
   * and `undefined` is returned. Never throws.
   */
  set(userId: string, value: AuthenticatedUser, expectedGeneration: number): AuthenticatedUser | undefined {
    if (!this.enabled) return undefined;
    if (this.generation(userId) !== expectedGeneration) return undefined;

    let frozen: AuthenticatedUser;
    try {
      frozen = deepFreeze(deepCopy(value));
    } catch {
      // Not cloneable (never true of a Prisma row graph). Do not cache it.
      return undefined;
    }

    // Re-insert so a refreshed key moves to the back of the eviction order.
    this.entries.delete(userId);
    this.entries.set(userId, { value: frozen, expiresAt: this.now() + this.ttlMs });

    while (this.entries.size > PRINCIPAL_CACHE_MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }

    return frozen;
  }

  /**
   * Drops the entry (or every entry) in THIS process synchronously, then
   * publishes the same invalidation to every other replica. Call it after
   * the write commits, outside any `$transaction`. Never throws.
   */
  invalidate(target: PrincipalInvalidation): void {
    try {
      this.drop(target);
    } catch (error) {
      // `drop` only touches Maps; this is belt and braces for "never throws".
      this.logger.error(`Principal cache invalidation failed locally: ${String(error)}`);
    }

    try {
      // `publish` never rejects (bus rule 5); the catch is for a bus that breaks it.
      this.bus.publish(PRINCIPAL_INVALIDATE_CHANNEL, target).catch(() => undefined);
    } catch {
      // Same: a synchronous throw from a misbehaving adapter never reaches the caller.
    }
  }

  /** The health of the bus invalidations travel on. Synchronous, no I/O. */
  busHealth(): EventBusHealth {
    return this.bus.health();
  }

  /** A synchronous snapshot for the Doctor. No I/O. */
  stats(): PrincipalCacheStats {
    return {
      size: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      invalidations: this.invalidations,
    };
  }

  private drop(target: PrincipalInvalidation): void {
    this.invalidations += 1;
    this.counter += 1;

    if ('all' in target) {
      this.epoch = this.counter;
      this.generations.clear();
      this.entries.clear();
      return;
    }

    this.entries.delete(target.userId);
    this.generations.delete(target.userId);
    this.generations.set(target.userId, this.counter);

    // Bound the stamp map too. Advancing the epoch instead is conservative:
    // it only makes in-flight reads skip storing, never keeps a stale entry.
    if (this.generations.size > PRINCIPAL_CACHE_MAX_ENTRIES) {
      this.epoch = this.counter;
      this.generations.clear();
    }
  }
}
