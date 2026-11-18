// =============================================================================
// LinkMissThrottle: the brute-force defence of public link resolution (#730)
// =============================================================================
//
// A link token carries 256 bits of randomness, so guessing one is hopeless;
// the throttle is about cost and noise: a client IP whose resolutions keep
// failing (unknown, malformed, revoked, expired, wrong type) is refused with
// 429 (`details.retryAfterMs`, `Retry-After`) once it reaches `maxMisses`
// within `windowMs`, until its oldest miss leaves the window. A refused
// request is not itself a miss, and a throttled address is refused even with
// a valid token.
//
// The same bounded, in-process sliding window as `MemberLookupThrottle`,
// keyed by the client address (`request.ip`, which honours the Fastify proxy
// settings) instead of an account:
//
//   APPROXIMATE ACROSS REPLICAS, like the AI rate limits (docs/API.md): N
//   replicas allow up to N times the limit.
//   BOUNDED: at most `maxAccounts` addresses are tracked, oldest evicted.
// =============================================================================

import { Injectable } from '@nestjs/common';

import { MemberLookupThrottle, type MemberLookupThrottleOptions } from '../groups/member-lookup-throttle';

/**
 * Per-address throttle on failed public link resolutions. Configured by
 * `SharingModule.forRoot({ links: { maxMissesPerIp } })` (default 30 per 10
 * minutes); keys are client addresses.
 *
 * @stability experimental
 */
@Injectable()
export class LinkMissThrottle extends MemberLookupThrottle {
  /**
   * @param options - the bounds; defaults 30 misses per 10 minutes, 10 000 addresses.
   */
  constructor(options: MemberLookupThrottleOptions = {}) {
    super({ maxMisses: 30, windowMs: 10 * 60_000, maxAccounts: 10_000, ...options });
  }
}
