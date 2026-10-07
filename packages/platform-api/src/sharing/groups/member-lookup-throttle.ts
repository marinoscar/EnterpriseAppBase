// =============================================================================
// MemberLookupThrottle: the enumeration defence of member lookup by e-mail
// (issue #728; modelled on kvox `share-lookup-throttle.service.ts`)
// =============================================================================
//
// `POST /api/groups/:id/members { email }` answers differently for an address
// that belongs to a member of the organization and one that does not, so a
// caller could probe which addresses have accounts. Each FAILED lookup counts
// against the caller's account; past `maxMisses` within `windowMs` every
// further lookup is refused with 429 (`details.retryAfterMs`, `Retry-After`)
// until the oldest miss leaves the window.
//
// APPROXIMATE ACROSS REPLICAS, like the AI rate limits (docs/API.md): the
// counts live in this process, so N replicas allow up to N times the limit.
// BOUNDED: at most `maxAccounts` callers are tracked, evicted oldest first.
// =============================================================================

import { Injectable } from '@nestjs/common';

/**
 * The throttle's bounds.
 *
 * @stability experimental
 */
export interface MemberLookupThrottleOptions {
  /** Failed lookups allowed per window. Default 10. */
  maxMisses?: number;
  /** The window, in milliseconds. Default 10 minutes. */
  windowMs?: number;
  /** Callers tracked at most (oldest evicted). Default 10 000. */
  maxAccounts?: number;
  /** The clock (ms since epoch). Default `Date.now`. */
  now?: () => number;
}

/**
 * Per-account throttle on failed member lookups by e-mail.
 *
 * @stability experimental
 */
@Injectable()
export class MemberLookupThrottle {
  private readonly maxMisses: number;
  private readonly windowMs: number;
  private readonly maxAccounts: number;
  private readonly now: () => number;
  /** userId to miss timestamps, oldest first. Map order is insertion order (eviction). */
  private readonly misses = new Map<string, number[]>();

  constructor(options: MemberLookupThrottleOptions = {}) {
    this.maxMisses = options.maxMisses ?? 10;
    this.windowMs = options.windowMs ?? 10 * 60_000;
    this.maxAccounts = options.maxAccounts ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  private live(userId: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const kept = (this.misses.get(userId) ?? []).filter((at) => at > cutoff);
    if (kept.length === 0) this.misses.delete(userId);
    else this.misses.set(userId, kept);
    return kept;
  }

  /**
   * How long `userId` must wait before the next lookup, or `0` when allowed.
   *
   * @param userId - the caller.
   * @returns milliseconds to wait.
   */
  retryAfterMs(userId: string): number {
    const kept = this.live(userId);
    if (kept.length < this.maxMisses) return 0;
    return Math.max(1, kept[kept.length - this.maxMisses]! + this.windowMs - this.now());
  }

  /**
   * Records one failed lookup by `userId`.
   *
   * @param userId - the caller.
   */
  recordMiss(userId: string): void {
    const kept = this.live(userId);
    this.misses.delete(userId);
    this.misses.set(userId, [...kept, this.now()].slice(-this.maxMisses));
    while (this.misses.size > this.maxAccounts) {
      const oldest = this.misses.keys().next().value;
      if (oldest === undefined) break;
      this.misses.delete(oldest);
    }
  }

  /** Callers currently tracked (for tests and diagnostics). */
  size(): number {
    return this.misses.size;
  }
}
