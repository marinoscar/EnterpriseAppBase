import { describe, expect, it } from 'vitest';

import { NodeEventQueue } from './node-events-queue.js';
import type { NodeEvent } from './node-api.js';
import { createPowerWatcher } from './power-watcher.js';

const HB = 15_000;
const bat = (pct: number) => ({ source: 'battery' as const, batteryPercent: pct, charging: false });
const ac = (pct?: number) => ({ source: 'ac' as const, ...(pct !== undefined ? { batteryPercent: pct } : {}) });
const types = (events: NodeEvent[]) => events.map((e) => e.type);

describe('createPowerWatcher', () => {
  it('emits nothing on the baseline observation', () => {
    const w = createPowerWatcher({ heartbeatMs: HB });
    expect(w.observe(bat(5), 0)).toEqual([]);
  });

  it('source change: warning when going to battery, info otherwise', () => {
    const w = createPowerWatcher({ heartbeatMs: HB });
    w.observe(ac(90), 0);
    const [toBattery] = w.observe(bat(90), 10_000);
    expect(toBattery).toMatchObject({ type: 'power.source_changed', severity: 'warning', attrs: { from: 'ac', to: 'battery', batteryPercent: 90 } });
    const [toAc] = w.observe(ac(90), 20_000);
    expect(toAc).toMatchObject({ severity: 'info', attrs: { from: 'battery', to: 'ac' } });
  });

  it('low fires once, recovers only above low + 5', () => {
    const w = createPowerWatcher({ heartbeatMs: HB });
    w.observe(bat(30), 0);
    expect(types(w.observe(bat(19), 1000))).toEqual(['power.battery_low']);
    expect(w.observe(bat(18), 2000)).toEqual([]);
    expect(w.observe(bat(24), 3000)).toEqual([]); // inside the hysteresis band
    expect(w.observe(bat(21), 4000)).toEqual([]); // dips again: still latched, no repeat
    expect(types(w.observe(bat(25), 5000))).toEqual(['power.battery_recovered']);
    expect(types(w.observe(bat(19), 6000))).toEqual(['power.battery_low']); // re-armed
  });

  it('critical fires once with critical severity', () => {
    const w = createPowerWatcher({ heartbeatMs: HB });
    w.observe(bat(30), 0);
    w.observe(bat(15), 1000);
    const events = w.observe(bat(9), 2000);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'power.battery_critical', severity: 'critical' });
    expect(w.observe(bat(8), 3000)).toEqual([]);
  });

  it('a low battery on AC does not alert', () => {
    const w = createPowerWatcher({ heartbeatMs: HB });
    w.observe(ac(50), 0);
    expect(w.observe(ac(5), 1000)).toEqual([]);
  });

  it('detects a sleep from a wall-clock gap over 3x the heartbeat', () => {
    const w = createPowerWatcher({ heartbeatMs: HB });
    w.observe(undefined, 0);
    expect(w.observe(undefined, 3 * HB)).toEqual([]);
    const events = w.observe(undefined, 3 * HB + 3 * HB + 1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'node.sleep_resumed', severity: 'info', attrs: { gapSeconds: 45 } });
  });

  it('disk low fires once with hysteresis at 10%', () => {
    const w = createPowerWatcher({ heartbeatMs: HB });
    expect(w.observeDisk(30, 100, 0)).toEqual([]);
    expect(types(w.observeDisk(4, 100, 1))).toEqual(['node.disk_low']);
    expect(w.observeDisk(3, 100, 2)).toEqual([]);
    expect(w.observeDisk(8, 100, 3)).toEqual([]);
    expect(w.observeDisk(4, 100, 4)).toEqual([]); // still latched
    expect(w.observeDisk(12, 100, 5)).toEqual([]); // re-arms
    expect(types(w.observeDisk(4, 100, 6))).toEqual(['node.disk_low']);
    expect(w.observeDisk(undefined, 100, 7)).toEqual([]);
  });
});

describe('NodeEventQueue', () => {
  const ev = (n: number): NodeEvent => ({ type: 'a.b', severity: 'info', at: new Date(n).toISOString(), attrs: { n } });

  it('drops the oldest past the cap and counts them', () => {
    const q = new NodeEventQueue(200);
    q.push(Array.from({ length: 250 }, (_, i) => ev(i)));
    expect(q.size).toBe(200);
    expect(q.dropped).toBe(50);
    expect(q.drain(1)[0]?.attrs?.['n']).toBe(50);
  });

  it('drains at most 50 per heartbeat by default, remainder next time', () => {
    const q = new NodeEventQueue();
    q.push(Array.from({ length: 120 }, (_, i) => ev(i)));
    expect(q.drain()).toHaveLength(50);
    expect(q.drain()).toHaveLength(50);
    expect(q.drain()).toHaveLength(20);
  });

  it('requeues a failed batch at the front, in order', () => {
    const q = new NodeEventQueue();
    q.push([ev(1), ev(2), ev(3)]);
    const batch = q.drain(2);
    q.push([ev(4)]);
    q.requeue(batch);
    expect(q.drain().map((e) => e.attrs?.['n'])).toEqual([1, 2, 3, 4]);
  });
});
