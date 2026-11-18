// Host vitals, power and node events on the heartbeat (issue #1045).
import { describe, expect, it } from 'vitest';

import {
  NODE_EVENT_TYPES,
  NODE_SERVER_CAPABILITY_HOST_VITALS,
  adminNodeEventListSchema,
  adminNodeEventSchema,
  heartbeatNodeSchema,
  nodeEventSchema,
  nodeVitalsSchema,
  registerNodeResponseSchema,
} from '../src/nodes/index.js';

const event = { type: 'power.battery_low', severity: 'warning', at: '2026-01-01T00:00:00.000Z', attrs: { batteryPercent: 19, source: 'battery', ok: false } };

describe('nodeVitalsSchema host and power', () => {
  it('accepts a full host and power block', () => {
    const vitals = {
      host: { cpuPercent: 55.5, cpuCount: 8, loadAvg1: 1, loadAvg5: 2, loadAvg15: 3, memTotalBytes: 16e9, memFreeBytes: 4e9, memAvailableBytes: 8e9, osRelease: '6.1.0', arch: 'x64', uptimeSeconds: 1000 },
      power: { source: 'battery', batteryPercent: 80, charging: false, timeRemainingSeconds: 3600, lowPowerMode: true },
    };
    expect(nodeVitalsSchema.parse(vitals)).toEqual(vitals);
  });

  it('keeps host and power optional', () => {
    expect(nodeVitalsSchema.parse({ cpuPercent: 1 })).toEqual({ cpuPercent: 1 });
  });

  it.each([
    [{ host: { cpuPercent: 100.1 } }],
    [{ host: { cpuPercent: -1 } }],
    [{ host: { cpuCount: 0 } }],
    [{ host: { cpuCount: 4097 } }],
    [{ host: { loadAvg1: 10_001 } }],
    [{ host: { memFreeBytes: 1.5 } }],
    [{ host: { osRelease: 'x'.repeat(129) } }],
    [{ host: { arch: 'x'.repeat(33) } }],
    [{ host: { unknown: 1 } }],
    [{ power: { source: 'solar' } }],
    [{ power: { source: 'ac', batteryPercent: 101 } }],
    [{ power: { source: 'ac', timeRemainingSeconds: 8 * 24 * 3600 } }],
    [{ power: { source: 'ac', extra: 1 } }],
  ])('rejects %j', (bad) => {
    expect(nodeVitalsSchema.safeParse(bad).success).toBe(false);
  });
});

describe('nodeEventSchema', () => {
  it('accepts a valid event and keeps the type open', () => {
    expect(nodeEventSchema.parse(event)).toEqual(event);
    expect(nodeEventSchema.safeParse({ ...event, type: 'app.custom_thing' }).success).toBe(true);
    for (const type of Object.values(NODE_EVENT_TYPES)) expect(nodeEventSchema.safeParse({ ...event, type }).success).toBe(true);
  });

  it.each([
    [{ type: 'nodot' }],
    [{ type: 'Power.low' }],
    [{ type: `a.${'b'.repeat(70)}` }],
    [{ severity: 'fatal' }],
    [{ at: 'yesterday' }],
    [{ attrs: { a: { nested: 1 } } }],
    [{ attrs: { a: 'x'.repeat(257) } }],
    [{ extra: 1 }],
  ])('rejects %j', (patch) => {
    expect(nodeEventSchema.safeParse({ ...event, ...patch }).success).toBe(false);
  });

  it('allows at most 16 attrs', () => {
    const attrs = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]));
    expect(nodeEventSchema.safeParse({ ...event, attrs: attrs(16) }).success).toBe(true);
    expect(nodeEventSchema.safeParse({ ...event, attrs: attrs(17) }).success).toBe(false);
  });
});

describe('heartbeatNodeSchema events', () => {
  it('allows 50 events and refuses 51', () => {
    expect(heartbeatNodeSchema.safeParse({ events: Array(50).fill(event) }).success).toBe(true);
    expect(heartbeatNodeSchema.safeParse({ events: Array(51).fill(event) }).success).toBe(false);
  });
  it('stays valid without events', () => {
    expect(heartbeatNodeSchema.safeParse({ status: 'online' }).success).toBe(true);
  });
});

describe('server features and admin event shapes', () => {
  it('parses serverFeatures and tolerates its absence', () => {
    expect(registerNodeResponseSchema.parse({ node: {}, serverFeatures: [NODE_SERVER_CAPABILITY_HOST_VITALS] }).serverFeatures).toEqual(['node_host_vitals']);
    expect(registerNodeResponseSchema.parse({ node: {} }).serverFeatures).toBeUndefined();
  });

  it('parses a stored event and a page', () => {
    const row = { id: 'a', nodeId: 'b', type: event.type, severity: 'warning', attrs: {}, occurredAt: event.at, receivedAt: event.at };
    expect(adminNodeEventSchema.parse(row)).toEqual(row);
    expect(adminNodeEventListSchema.parse({ items: [row], total: 1, page: 1, pageSize: 20, totalPages: 1 }).items).toHaveLength(1);
  });
});
