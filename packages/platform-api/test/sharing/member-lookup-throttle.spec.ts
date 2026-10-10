// The enumeration defence of member lookup by e-mail (issue #728).
import { MemberLookupThrottle } from '../../src/sharing/index';

describe('MemberLookupThrottle', () => {
  it('allows 10 misses per 10 minutes per account, then says how long to wait', () => {
    let now = 1_000_000;
    const throttle = new MemberLookupThrottle({ now: () => now });
    for (let i = 0; i < 10; i += 1) {
      expect(throttle.retryAfterMs('u1')).toBe(0);
      throttle.recordMiss('u1');
      now += 1000;
    }
    // The first miss was at 1_000_000; it leaves the window at 1_600_000.
    expect(throttle.retryAfterMs('u1')).toBe(1_600_000 - now);
    expect(throttle.retryAfterMs('u2')).toBe(0);
    now = 1_600_001;
    expect(throttle.retryAfterMs('u1')).toBe(0);
  });

  it('forgets an account whose misses all left the window', () => {
    let now = 0;
    const throttle = new MemberLookupThrottle({ now: () => now, windowMs: 100 });
    throttle.recordMiss('u1');
    expect(throttle.size()).toBe(1);
    now = 101;
    expect(throttle.retryAfterMs('u1')).toBe(0);
    expect(throttle.size()).toBe(0);
  });

  it('is bounded: the oldest account is evicted past maxAccounts', () => {
    const throttle = new MemberLookupThrottle({ maxAccounts: 3 });
    for (const id of ['a', 'b', 'c', 'd']) throttle.recordMiss(id);
    expect(throttle.size()).toBe(3);
  });

  it('keeps at most maxMisses timestamps per account', () => {
    let now = 0;
    const throttle = new MemberLookupThrottle({ now: () => now, maxMisses: 2, windowMs: 1000 });
    for (let i = 0; i < 5; i += 1) {
      throttle.recordMiss('u1');
      now += 10;
    }
    // The 4th miss (at 30) is the oldest of the two kept.
    expect(throttle.retryAfterMs('u1')).toBe(30 + 1000 - now);
  });
});
