import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CredentialKind } from '../../../core/index';

import {
  IDENTITY_EVENT_BUS,
  type IdentityEventBus as EventBus,
  type IdentityEventBusHealth as EventBusHealth,
  type IdentityEventBusMeta as EventBusMeta,
} from '../../ports';
import { LocalIdentityEventBus } from './local-event-bus';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { DEFAULT_PRINCIPAL_CACHE_TTL_SECONDS } from './principal-cache.config';
import { stampCredential } from '../credential-binding';

// =============================================================================
// PrincipalCache — short-TTL principals for JWT validation (PP-1.12, #683)
// =============================================================================
//
// Every JWT request used to run a four-level join (user → userRoles → role →
// rolePermissions → permission) before its controller ran. This cache holds
// the result of that join for at most `AUTH_PRINCIPAL_CACHE_TTL_SECONDS`
// (default 30; `0` turns it off), keyed by `(userId, orgId, tokenKind)`
// (PP-6.4, #724): the active org and the credential kind are part of what a
// request's principal is, so an entry is never served to a request bound to
// another org. Invalidation is per USER (`invalidateUser`): it drops every
// entry of that user, whatever the org or kind.
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
export const PRINCIPAL_CACHE_CLOCK: unique symbol = Symbol.for('@marinoscar/platform/identity/PRINCIPAL_CACHE_CLOCK');

/**
 * What to drop: every entry of one user (all orgs, all credential kinds), or
 * every principal (a role ↔ permission change affects everyone holding that
 * role, and there is no index from role to user in the cache).
 */
export type PrincipalInvalidation = { userId: string } | { all: true };

/**
 * One cache entry's identity (#724): the user, the org the credential is
 * bound to, and the credential kind. `orgId: null` is a credential bound to
 * NO org: a pre-#724 access token (the compatibility path in
 * `AuthService.validateJwtPayload`). Node credentials are never cached.
 */
export interface PrincipalCacheKey {
  userId: string;
  orgId: string | null;
  tokenKind: CredentialKind;
}

/** The map key. NUL separators: none of the three parts can contain one. */
function keyString(key: PrincipalCacheKey): string {
  return `${key.userId}\u0000${key.orgId ?? ''}\u0000${key.tokenKind}`;
}

export interface PrincipalCacheStats {
  size: number;
  hits: number;
  misses: number;
  invalidations: number;
}

interface Entry {
  userId: string;
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

  /** userId → the keys of its entries, so `invalidateUser` drops them all. */
  private readonly keysByUser = new Map<string, Set<string>>();

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
    @Optional() @Inject(IDENTITY_EVENT_BUS) bus?: EventBus,
    @Optional() @Inject(PRINCIPAL_CACHE_CLOCK) private readonly now: () => number = Date.now,
  ) {
    this.bus = bus ?? new LocalIdentityEventBus();
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
    this.keysByUser.clear();
  }

  /** A key of `userId`'s entries: a live one first, else any (so `get` expires it). */
  private anyKeyOf(userId: string): string | undefined {
    const keys = [...(this.keysByUser.get(userId) ?? [])];
    const now = this.now();
    return keys.find((id) => (this.entries.get(id)?.expiresAt ?? 0) > now) ?? keys[0];
  }

  /** Removes one entry and its index slot. */
  private deleteEntry(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    const keys = this.keysByUser.get(entry.userId);
    keys?.delete(id);
    if (keys && keys.size === 0) this.keysByUser.delete(entry.userId);
  }

  /**
   * The cached principal, or `undefined` when absent, expired or disabled.
   *
   * With a bare user id (diagnostics and tests): any live entry of that user,
   * whatever its org or credential kind. Request paths always pass the full
   * {@link PrincipalCacheKey}.
   */
  get(key: PrincipalCacheKey | string): AuthenticatedUser | undefined {
    if (!this.enabled) return undefined;

    const id = typeof key === 'string' ? this.anyKeyOf(key) : keyString(key);
    const entry = id === undefined ? undefined : this.entries.get(id);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }

    if (entry.expiresAt <= this.now()) {
      this.deleteEntry(id!);
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
   * Stores a deep-frozen copy of `value`, BOUND to the key (#724: its
   * `activeOrgId` is `key.orgId` when that is set, its `tokenKind` is
   * `key.tokenKind`; see `credential-binding.ts`), and returns it — unless
   * the cache is disabled, or `expectedGeneration` is no longer current (an
   * invalidation happened while the caller was reading), in which case
   * nothing is stored and `undefined` is returned. Never throws.
   */
  set(key: PrincipalCacheKey, value: AuthenticatedUser, expectedGeneration: number): AuthenticatedUser | undefined {
    if (!this.enabled) return undefined;
    const { userId } = key;
    if (this.generation(userId) !== expectedGeneration) return undefined;

    let frozen: AuthenticatedUser;
    try {
      frozen = deepFreeze(
        stampCredential(deepCopy(value), {
          activeOrgId: key.orgId ?? undefined,
          tokenKind: key.tokenKind,
        }),
      );
    } catch {
      // Not cloneable (never true of a Prisma row graph). Do not cache it.
      return undefined;
    }

    // Re-insert so a refreshed key moves to the back of the eviction order.
    const id = keyString(key);
    this.entries.delete(id);
    this.entries.set(id, { userId, value: frozen, expiresAt: this.now() + this.ttlMs });
    let keys = this.keysByUser.get(userId);
    if (!keys) {
      keys = new Set();
      this.keysByUser.set(userId, keys);
    }
    keys.add(id);

    while (this.entries.size > PRINCIPAL_CACHE_MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.deleteEntry(oldest);
    }

    return frozen;
  }

  /**
   * Drops every entry of `userId` (every org, every credential kind) here and
   * on every other replica: {@link invalidate} with `{ userId }`. The one call
   * the principal-changing writes make (#724), after their transaction
   * commits: membership create, delete, status or role change; system role
   * change; user deactivation; PAT revoke; device-session revoke. Never throws.
   */
  invalidateUser(userId: string): void {
    this.invalidate({ userId });
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
      this.keysByUser.clear();
      return;
    }

    for (const id of this.keysByUser.get(target.userId) ?? []) this.entries.delete(id);
    this.keysByUser.delete(target.userId);
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
