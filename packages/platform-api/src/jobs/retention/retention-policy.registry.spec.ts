import { BUILTIN_RETENTION_POLICY_KEYS, RETENTION_MAX_DAYS } from '@marinoscar/platform-contract/jobs';

import { listRetentionPolicies, registerRetentionPolicy, retentionPolicyRegistry, sealRetentionPolicies } from './retention-policy.registry';

// The registry is process-wide and static; each case registers a key of its own.
describe('the retention policy registry', () => {
  const purge = (type: string) => ({ type, what: `${type} purge` });

  it("registers the platform's four first, in the shipped key order, with the shipped defaults", () => {
    const builtins = listRetentionPolicies().slice(0, 4);

    expect(builtins.map((policy) => policy.key)).toEqual([...BUILTIN_RETENTION_POLICY_KEYS]);
    expect(Object.fromEntries(builtins.map((policy) => [policy.key, [policy.defaultEnabled, policy.defaultDays, policy.purge.type]]))).toEqual({
      notifications: [true, 180, 'notifications.inbox.purge'],
      notificationDeliveries: [true, 90, 'notifications.deliveries.purge'],
      auditEvents: [false, 365, 'audit.events.purge'],
      aiRuns: [true, 90, 'ai.runs.purge'],
    });
  });

  it('adds an app policy after the built-ins', () => {
    registerRetentionPolicy({ key: 'orderEvents', label: 'Order events', defaultDays: 30, purge: purge('app.order-events.purge') });

    expect(listRetentionPolicies().map((policy) => policy.key).slice(-1)).toEqual(['orderEvents']);
    expect(retentionPolicyRegistry.get('orderEvents')).toMatchObject({ label: 'Order events', defaultDays: 30 });
  });

  it('refuses a duplicate key, naming that a key is permanent', () => {
    expect(() => registerRetentionPolicy({ key: 'aiRuns', label: 'x', defaultDays: 5, purge: purge('app.other.purge') })).toThrow(/already registered/);
  });

  it('refuses a job type that already enforces another policy', () => {
    expect(() => registerRetentionPolicy({ key: 'clashing', label: 'x', defaultDays: 5, purge: purge('ai.runs.purge') })).toThrow(/already enforces retention policy "aiRuns"/);
  });

  it.each(['', 'a', 'Bad', '1abc', 'has-dash', 'has space', 'x'.repeat(49)])('refuses the key %p', (key) => {
    expect(() => registerRetentionPolicy({ key, label: 'x', defaultDays: 5, purge: purge(`app.k${key.length}.purge`) })).toThrow();
  });

  it('refuses bounds outside 1..3650, an inverted range and a default outside the range', () => {
    const base = { label: 'x', purge: purge('app.bounds.purge') };
    expect(() => registerRetentionPolicy({ ...base, key: 'boundsA', defaultDays: 5, minDays: 0 })).toThrow(/minDays\/maxDays/);
    expect(() => registerRetentionPolicy({ ...base, key: 'boundsB', defaultDays: 5, maxDays: RETENTION_MAX_DAYS + 1 })).toThrow(/minDays\/maxDays/);
    expect(() => registerRetentionPolicy({ ...base, key: 'boundsC', defaultDays: 5, minDays: 10, maxDays: 5 })).toThrow(/minDays\/maxDays/);
    expect(() => registerRetentionPolicy({ ...base, key: 'boundsD', defaultDays: 5, minDays: 7 })).toThrow(/defaultDays/);
    expect(() => registerRetentionPolicy({ ...base, key: 'boundsE', defaultDays: 1.5 })).toThrow(/defaultDays/);
  });

  it('refuses a blank label and a purge without a type or a phrase', () => {
    expect(() => registerRetentionPolicy({ key: 'blankLabel', label: ' ', defaultDays: 5, purge: purge('app.blank.purge') })).toThrow(/label/);
    expect(() => registerRetentionPolicy({ key: 'noType', label: 'x', defaultDays: 5, purge: { type: ' ', what: 'x' } })).toThrow(/purge needs/);
    expect(() => registerRetentionPolicy({ key: 'noWhat', label: 'x', defaultDays: 5, purge: { type: 'app.nowhat.purge', what: '' } })).toThrow(/purge needs/);
  });

  it('defaults a new policy to OFF: deleting rows is an operator decision', () => {
    registerRetentionPolicy({ key: 'offByDefault', label: 'x', defaultDays: 5, purge: purge('app.off.purge') });
    expect(retentionPolicyRegistry.get('offByDefault')?.defaultEnabled).toBeUndefined();
  });

  // Last: sealing is permanent for the process.
  it('refuses a policy registered after the namespace was composed, naming the fix', () => {
    sealRetentionPolicies('a test composed it');

    expect(() => registerRetentionPolicy({ key: 'tooLate', label: 'x', defaultDays: 5, purge: purge('app.late.purge') })).toThrow(
      /registered after a test composed it.*import time/s,
    );
    expect(retentionPolicyRegistry.has('tooLate')).toBe(false);
  });
});
