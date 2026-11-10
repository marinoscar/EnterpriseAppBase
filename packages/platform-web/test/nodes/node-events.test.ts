// How a node event reads (issue #1045): the label of a known type, the humanized
// fallback for an unknown one, and the one-line attribute summary.

import { describe, expect, it } from 'vitest';

import {
  MAX_NODE_EVENT_SUMMARY_ATTRS,
  NODE_EVENT_TYPES,
  humanizeNodeEventType,
  nodeEventLabel,
  nodeEventSummary,
} from '../../src/nodes/headless/index.js';

describe('nodeEventLabel', () => {
  it('labels every platform event type', () => {
    expect(nodeEventLabel(NODE_EVENT_TYPES.POWER_SOURCE_CHANGED)).toBe('Power source changed');
    expect(nodeEventLabel(NODE_EVENT_TYPES.BATTERY_LOW)).toBe('Battery low');
    expect(nodeEventLabel(NODE_EVENT_TYPES.BATTERY_CRITICAL)).toBe('Battery critical');
    expect(nodeEventLabel(NODE_EVENT_TYPES.BATTERY_RECOVERED)).toBe('Battery recovered');
    expect(nodeEventLabel(NODE_EVENT_TYPES.SLEEP_RESUMED)).toBe('Resumed from sleep');
    expect(nodeEventLabel(NODE_EVENT_TYPES.DISK_LOW)).toBe('Disk space low');
    // No platform type is left to the fallback.
    for (const type of Object.values(NODE_EVENT_TYPES)) expect(nodeEventLabel(type)).not.toBe(humanizeNodeEventType(type));
  });

  it('humanizes an unknown type instead of hiding it', () => {
    expect(nodeEventLabel('transcode.queue_full')).toBe('Transcode: queue full');
    expect(nodeEventLabel('app.media_box.fan_stalled')).toBe('App Media box: fan stalled');
    expect(humanizeNodeEventType('single_word')).toBe('Single word');
    expect(humanizeNodeEventType('')).toBe('');
  });
});

describe('nodeEventSummary', () => {
  it('words a power source change with the charge', () => {
    expect(
      nodeEventSummary({ type: 'power.source_changed', attrs: { from: 'ac', to: 'battery', batteryPercent: 64 } }),
    ).toBe('AC → Battery (64%)');
    expect(nodeEventSummary({ type: 'power.source_changed', attrs: { from: 'battery', to: 'ac' } })).toBe('Battery → AC');
  });

  it('words battery events with their threshold', () => {
    expect(nodeEventSummary({ type: 'power.battery_low', attrs: { batteryPercent: 18, threshold: 20 } })).toBe(
      '18% (threshold 20%)',
    );
    expect(nodeEventSummary({ type: 'power.battery_recovered', attrs: { batteryPercent: 45 } })).toBe('45%');
  });

  it('words a wake from sleep and a low disk', () => {
    expect(nodeEventSummary({ type: 'node.sleep_resumed', attrs: { gapSeconds: 7_380 } })).toBe('Asleep for 2h 03m');
    expect(nodeEventSummary({ type: 'node.disk_low', attrs: { freePercent: 4.5, freeBytes: 1024 ** 3 } })).toBe(
      '4.5% free (1 GB)',
    );
  });

  it('falls back to sorted key: value pairs, bounded, for an unknown type or missing attrs', () => {
    expect(nodeEventSummary({ type: 'transcode.queue_full', attrs: { depth: 12, codec: 'h264' } })).toBe(
      'codec: h264, depth: 12',
    );
    expect(nodeEventSummary({ type: 'power.battery_low', attrs: { note: 'no percent' } })).toBe('note: no percent');
    const many = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`k${i}`, i]));
    const text = nodeEventSummary({ type: 'app.many.things', attrs: many });
    expect(text).toBe(
      `${Array.from({ length: MAX_NODE_EVENT_SUMMARY_ATTRS }, (_, i) => `k${i}: ${i}`).join(', ')} (+2 more)`,
    );
  });

  it('returns null when there is nothing to say', () => {
    expect(nodeEventSummary({ type: 'node.sleep_resumed', attrs: {} })).toBeNull();
  });
});
