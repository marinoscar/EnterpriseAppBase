// App-defined node vitals (PP-14.19): the registry, the unit formatting and the rows the dialog prints.
import { describe, expect, it } from 'vitest';

import {
  formatNodeVital,
  nodeCapabilityItems,
  nodeVitalFor,
  nodeVitalRows,
  registerNodeVital,
  registeredNodeVitals,
  MAX_LISTED_CAPABILITIES,
  MAX_CAPABILITY_TEXT_LENGTH,
} from '../../src/nodes/headless/index.js';

describe('registerNodeVital', () => {
  it('registers a key with its label and unit, and replaces on a repeat', () => {
    registerNodeVital({ key: 'transcode.fps', label: 'Transcode frames per second', unit: 'frames/s' });
    expect(nodeVitalFor('transcode.fps')).toEqual({ key: 'transcode.fps', label: 'Transcode frames per second', unit: 'frames/s' });

    registerNodeVital({ key: 'transcode.fps', label: 'FPS', unit: 'frames/s' });
    expect(nodeVitalFor('transcode.fps')?.label).toBe('FPS');
    expect(registeredNodeVitals().filter((def) => def.key === 'transcode.fps')).toHaveLength(1);
  });

  it('refuses a key the API would refuse, and a blank label or unit', () => {
    for (const key of ['', 'x', 'Bad Key', '1abc', 'has-dash', 'x'.repeat(49)]) {
      expect(() => registerNodeVital({ key, label: 'L', unit: 'count' })).toThrow(/not a vital key/);
    }
    expect(() => registerNodeVital({ key: 'good.key', label: ' ', unit: 'count' })).toThrow(/label is required/);
    expect(() => registerNodeVital({ key: 'good.key', label: 'L', unit: '' })).toThrow(/unit is required/);
  });

  it('freezes what it stores', () => {
    registerNodeVital({ key: 'frozen.one', label: 'L', unit: 'count' });
    expect(Object.isFrozen(nodeVitalFor('frozen.one'))).toBe(true);
  });
});

describe('formatNodeVital', () => {
  const def = (unit: string) => ({ key: 'k.x', label: 'L', unit });

  it('words a number in its unit', () => {
    expect(formatNodeVital(87.456, def('percent'))).toBe('87.46%');
    expect(formatNodeVital(1536, def('bytes'))).toBe('1.5 KB');
    expect(formatNodeVital(850, def('milliseconds'))).toBe('850 ms');
    expect(formatNodeVital(90, def('seconds'))).toBe('1m 30s');
    expect(formatNodeVital(1234.6, def('count'))).toBe('1,235');
    expect(formatNodeVital(29.97, def('frames/s'))).toBe('29.97 frames/s');
  });

  it('prints an unregistered key as a bare number, and a non-finite value as a dash', () => {
    expect(formatNodeVital(12.3456, undefined)).toBe('12.35');
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '5' as never, null as never]) expect(formatNodeVital(bad, def('count'))).toBe('—');
  });
});

describe('nodeVitalRows', () => {
  it('puts registered keys first in registration order, then the rest by key; an unregistered key still shows', () => {
    registerNodeVital({ key: 'rows.second', label: 'Second', unit: 'count' });
    registerNodeVital({ key: 'rows.first', label: 'First', unit: 'percent' });

    const rows = nodeVitalRows({ 'zzz.unregistered': 3, 'rows.first': 50, 'aaa.unregistered': 1, 'rows.second': 7 });

    expect(rows.map((row) => row.key)).toEqual(['rows.second', 'rows.first', 'aaa.unregistered', 'zzz.unregistered']);
    expect(rows.map((row) => [row.label, row.text])).toEqual([
      ['Second', '7'],
      ['First', '50%'],
      ['aaa.unregistered', '1'],
      ['zzz.unregistered', '3'],
    ]);
  });

  it('shows nothing for nothing, and drops a value that is not a finite number', () => {
    expect(nodeVitalRows(undefined)).toEqual([]);
    expect(nodeVitalRows(null as never)).toEqual([]);
    expect(nodeVitalRows({})).toEqual([]);
    expect(nodeVitalRows({ 'ok.key': 1, 'bad.nan': Number.NaN, 'bad.str': 'x' as never })).toHaveLength(1);
  });

  it('prints at most 16 rows, even if an older row held more', () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`many.k${String(i).padStart(2, '0')}`, i]));

    expect(nodeVitalRows(many)).toHaveLength(16);
  });
});

describe('nodeCapabilityItems', () => {
  it('lists the probe’s satisfied capabilities sorted, each with its version banner when the probe captured one', () => {
    const items = nodeCapabilityItems({
      probe: { capabilities: ['binary:psql', 'binary:ffmpeg', 'gpu:cuda'], versions: { ffmpeg: 'ffmpeg version 6.1' }, binaries: { ffmpeg: true } },
      other: 'ignored',
    });

    expect(items).toEqual([{ key: 'binary:ffmpeg', version: 'ffmpeg version 6.1' }, { key: 'binary:psql' }, { key: 'gpu:cuda' }]);
  });

  it('is empty for anything that is not the expected shape', () => {
    for (const capabilities of [null, undefined, 5, 'x', [], {}, { probe: null }, { probe: { capabilities: 'x' } }, { probe: [] }]) {
      expect(nodeCapabilityItems(capabilities)).toEqual([]);
    }
  });

  it('bounds the count and the text, strips control characters, drops non-strings and duplicates', () => {
    const many = Array.from({ length: 200 }, (_, i) => `binary:tool${i}`);
    expect(nodeCapabilityItems({ probe: { capabilities: many } })).toHaveLength(MAX_LISTED_CAPABILITIES);

    const [item] = nodeCapabilityItems({ probe: { capabilities: ['x'.repeat(500)] } });
    expect(item?.key).toHaveLength(MAX_CAPABILITY_TEXT_LENGTH);

    expect(nodeCapabilityItems({ probe: { capabilities: ['a\u0000b\nc', 5, null, {}, 'a b c', '   ', 'dup', 'dup'] } }).map((i) => i.key)).toEqual(['a b c', 'dup']);
  });

  it('never reads a prototype property as a version', () => {
    expect(nodeCapabilityItems({ probe: { capabilities: ['binary:constructor'], versions: {} } })).toEqual([{ key: 'binary:constructor' }]);
  });
});
