import { Inject, Injectable, Optional } from '@nestjs/common';

// =============================================================================
// The OAuth endpoints' rate limiter (PP-15.4, docs/specs/oauth-server.md §3)
// =============================================================================
//
// The platform has no HTTP rate limiter and must not gain a global throttler
// `APP_GUARD` (the `host` conformance suite lists every global guard). The
// limit is applied BY the OAuth controllers, through this small interface:
// the default is an in-memory fixed window (correct for one replica); an app
// with several replicas binds `OAUTH_RATE_LIMITER` to a shared store.
// =============================================================================

/**
 * Injection token of the app's {@link OAuthRateLimiter}.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const OAUTH_RATE_LIMITER: unique symbol = Symbol.for('@marinoscar/platform/identity/OAUTH_RATE_LIMITER');

/**
 * What a limiter answers for one hit.
 *
 * @stability experimental
 */
export interface OAuthRateLimitVerdict {
  /** Whether the call may proceed. */
  readonly allowed: boolean;
  /** When refused: whole seconds until the window ends (at least 1). */
  readonly retryAfterSeconds: number;
}

/**
 * A fixed-window rate limiter. `consume` counts one hit against `key`.
 *
 * @stability experimental
 */
export interface OAuthRateLimiter {
  /**
   * Counts one hit.
   *
   * @param key - the bucket, for example `token:client:abc`.
   * @param limit - hits allowed per window.
   * @param windowMs - the window length in milliseconds.
   * @returns the verdict.
   */
  consume(key: string, limit: number, windowMs: number): Promise<OAuthRateLimitVerdict> | OAuthRateLimitVerdict;
}

/** Most buckets held before expired ones are swept. */
const SWEEP_AT = 10_000;

/**
 * The default limiter: counters in this process's memory.
 *
 * @stability experimental
 */
export class InMemoryOAuthRateLimiter implements OAuthRateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  /**
   * @param now - the clock, for tests.
   */
  constructor(private readonly now: () => number = Date.now) {}

  /** Implements the interface method of the same name. */
  consume(key: string, limit: number, windowMs: number): OAuthRateLimitVerdict {
    const at = this.now();
    if (this.buckets.size >= SWEEP_AT) {
      for (const [bucket, state] of this.buckets) if (state.resetAt <= at) this.buckets.delete(bucket);
    }
    let state = this.buckets.get(key);
    if (!state || state.resetAt <= at) {
      state = { count: 0, resetAt: at + windowMs };
      this.buckets.set(key, state);
    }
    state.count += 1;
    if (state.count <= limit) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((state.resetAt - at) / 1000)) };
  }
}

/**
 * The limiter the OAuth controllers call: the app's {@link OAUTH_RATE_LIMITER}
 * when one is bound (several replicas share a store), else one in-memory limiter
 * for this process. One instance, so every endpoint counts against the same state.
 *
 * @stability experimental
 */
@Injectable()
export class OAuthRateLimitService implements OAuthRateLimiter {
  private readonly limiter: OAuthRateLimiter;

  constructor(@Optional() @Inject(OAUTH_RATE_LIMITER) bound?: OAuthRateLimiter) {
    this.limiter = bound ?? new InMemoryOAuthRateLimiter();
  }

  /** Implements the interface method of the same name. */
  consume(key: string, limit: number, windowMs: number): Promise<OAuthRateLimitVerdict> | OAuthRateLimitVerdict {
    return this.limiter.consume(key, limit, windowMs);
  }
}
