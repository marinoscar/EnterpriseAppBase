import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanup, hasAnsi, renderAt, stripAnsi } from '../../../../test/render-at.js';
import { ActiveItems } from './active-items.js';
import { EventLog } from './event-log.js';
import { MeterLegend } from './meter-legend.js';
import { RunSummary } from './run-summary.js';
import { SegmentMeter, type TuiMeterSegment } from './segment-meter.js';
import { StatusLine } from './status-line.js';

// ink-testing-library renders to a fake stream, where chalk would normally turn
// colour off; force it on (before ink loads) so the colour/NO_COLOR difference
// is observable.
vi.hoisted(() => {
  process.env['FORCE_COLOR'] = '1';
});
afterEach(() => cleanup());

const WIDTHS = [30, 56, 120] as const;
const widest = (lines: string[]): number => Math.max(0, ...lines.map((line) => Array.from(stripAnsi(line)).length));

type Kind = 'done' | 'skipped' | 'failed';
const KINDS = {
  done: { glyph: '✔', tone: 'success' },
  skipped: { glyph: '↷', tone: 'info' },
  failed: { glyph: '✖', tone: 'error' },
} as const;

const SEGMENTS: TuiMeterSegment<'ok' | 'busy' | 'bad'>[] = [
  { id: 'ok', count: 60, tone: 'success', done: true },
  { id: 'busy', count: 20, tone: 'primary' },
  { id: 'bad', count: 1, tone: 'error', done: true },
];

describe('EventLog', () => {
  const events = [
    { id: 1, kind: 'done' as Kind, text: '/photos/2024/holiday/IMG_0001.jpg' },
    { id: 2, kind: 'skipped' as Kind, text: '/photos/2024/holiday/IMG_0002.jpg', detail: 'out of range' },
    { id: 3, kind: 'failed' as Kind, text: '/photos/2024/holiday/IMG_0003.jpg', detail: 'connection reset by peer', retrying: true },
  ];

  it('renders nothing for no events', async () => {
    const out = await renderAt(<EventLog events={[]} kinds={KINDS} />, 80);
    expect(out.frame()).toBe('');
  });

  it('shows the newest maxVisible lines, newest last', async () => {
    const out = await renderAt(<EventLog events={events} kinds={KINDS} maxVisible={2} title="Recent" />, 120);
    const frame = stripAnsi(out.frame());
    expect(frame).toContain('Recent');
    expect(frame).not.toContain('IMG_0001');
    expect(frame.indexOf('IMG_0002')).toBeLessThan(frame.indexOf('IMG_0003'));
    expect(frame).toContain('out of range');
    expect(frame).toContain('(retrying)');
  });

  it('tolerates an unknown kind', async () => {
    const out = await renderAt(<EventLog events={[{ id: 1, kind: 'mystery', text: 'x' }]} kinds={{} as never} />, 80);
    expect(stripAnsi(out.frame())).toContain('x');
  });

  it.each(WIDTHS)('keeps one row per event at %i columns', async (columns) => {
    const out = await renderAt(<EventLog events={events} kinds={KINDS} />, columns);
    expect(out.lines()).toHaveLength(3);
    expect(widest(out.lines())).toBeLessThanOrEqual(columns);
  });

  it('is colourless under NO_COLOR but keeps the glyphs', async () => {
    const colour = await renderAt(<EventLog events={events} kinds={KINDS} />, 80);
    expect(hasAnsi(colour.frame())).toBe(true);
    const mono = await renderAt(<EventLog events={events} kinds={KINDS} />, 80, { noColor: true });
    expect(hasAnsi(mono.frame().replace(/\u001B\[2m|\u001B\[22m/g, ''))).toBe(false);
    expect(mono.frame()).toContain('✖');
  });
});

describe('SegmentMeter', () => {
  it('draws one row of exactly `width` cells with a percentage', async () => {
    const out = await renderAt(<SegmentMeter segments={SEGMENTS} total={100} width={40} />, 120);
    const frame = stripAnsi(out.frame());
    expect(out.lines()).toHaveLength(1);
    expect(Array.from(frame.replace(/\s*\d+%$/, ''))).toHaveLength(40);
    expect(frame).toMatch(/61%$/);
  });

  it('shows the single failure even when it is a rounding error', async () => {
    const out = await renderAt(<SegmentMeter segments={[{ id: 'ok', count: 9_999, tone: 'success' }, { id: 'bad', count: 1, tone: 'error', glyph: '!' }]} total={10_000} width={30} />, 120);
    expect(stripAnsi(out.frame())).toContain('!');
  });

  it.each(WIDTHS)('fits %i columns', async (columns) => {
    const out = await renderAt(<SegmentMeter segments={SEGMENTS} total={100} />, columns);
    expect(out.lines()).toHaveLength(1);
    expect(widest(out.lines())).toBeLessThanOrEqual(columns);
  });

  it('uses distinct glyphs per category so NO_COLOR still reads', async () => {
    const out = await renderAt(<SegmentMeter segments={SEGMENTS} total={100} width={40} />, 120, { noColor: true });
    const bar = stripAnsi(out.frame());
    expect(new Set(Array.from(bar.replace(/[\s\d%]/g, ''))).size).toBeGreaterThanOrEqual(3);
  });
});

describe('MeterLegend', () => {
  it('lists each category with its count and share', async () => {
    const out = await renderAt(<MeterLegend segments={SEGMENTS} total={100} />, 120);
    const frame = stripAnsi(out.frame());
    expect(frame).toContain('ok 60 (60%)');
    expect(frame).toContain('bad 1 (1%)');
    expect(frame).toContain('81 / 100');
  });

  it('stacks one entry per line below the narrow threshold', async () => {
    const out = await renderAt(<MeterLegend segments={SEGMENTS} total={100} />, 30);
    expect(out.lines().length).toBeGreaterThanOrEqual(4);
    expect(widest(out.lines())).toBeLessThanOrEqual(30);
  });
});

describe('StatusLine', () => {
  const items = [
    { label: 'server', value: 'https://example.test', tone: 'info' as const },
    { label: 'items', value: '3' },
  ];

  it('shows the running mark while not done', async () => {
    const out = await renderAt(<StatusLine title="Sync" items={items} />, 120);
    const frame = stripAnsi(out.frame());
    expect(frame).toContain('Sync');
    expect(frame).toContain('server');
    expect(frame).toContain('running');
    expect(frame).toContain('elapsed 0s');
    out.unmount();
  });

  it('shows done and the final duration', async () => {
    const out = await renderAt(<StatusLine title="Sync" items={items} done durationMs={65_000} />, 120);
    const frame = stripAnsi(out.frame());
    expect(frame).toContain('done');
    expect(frame).toContain('1m 05s');
    expect(frame).not.toContain('running');
  });

  it.each([30, 55])('wraps at %i columns without separators or overflow', async (columns) => {
    const out = await renderAt(<StatusLine title="Sync" items={items} done durationMs={1_000} />, columns);
    expect(stripAnsi(out.frame())).not.toContain('│');
    expect(widest(out.lines())).toBeLessThanOrEqual(columns);
  });
});

describe('ActiveItems', () => {
  const items = Array.from({ length: 7 }, (_, index) => ({
    id: index,
    label: `/photos/2024/holiday/a-rather-long-name-${index}.jpg`,
    fraction: index / 6,
  }));

  it('renders nothing when empty', async () => {
    const out = await renderAt(<ActiveItems items={[]} />, 80);
    expect(out.frame()).toBe('');
  });

  it('caps the rows and counts the rest', async () => {
    const out = await renderAt(<ActiveItems items={items} maxVisible={3} />, 120);
    const frame = stripAnsi(out.frame());
    expect(frame).toContain('Active (7)');
    expect(frame).toContain('and 4 more');
  });

  it('clamps a bad fraction', async () => {
    const out = await renderAt(<ActiveItems items={[{ id: 1, label: 'a', fraction: Number.NaN }, { id: 2, label: 'b', fraction: 7 }]} />, 80);
    const frame = stripAnsi(out.frame());
    expect(frame).toContain('  0% a');
    expect(frame).toContain('100% b');
  });

  it.each(WIDTHS)('middle-truncates labels at %i columns', async (columns) => {
    const out = await renderAt(<ActiveItems items={items} />, columns);
    expect(widest(out.lines())).toBeLessThanOrEqual(columns);
    if (columns === 30) expect(stripAnsi(out.frame())).toContain('…');
  });
});

describe('RunSummary', () => {
  const failures = Array.from({ length: 12 }, (_, index) => ({ id: index, label: `/photos/broken/file-${index}.jpg`, error: 'checksum mismatch' }));
  const stats = [
    { label: 'Done', value: '10', tone: 'success' as const },
    { label: 'Failed', value: '12', tone: 'error' as const },
  ];

  it('shows the stats, duration, failures and footer', async () => {
    const out = await renderAt(<RunSummary title="Run complete" stats={stats} durationMs={3_661_000} failures={failures} footer={<span />} />, 120);
    const frame = stripAnsi(out.frame());
    expect(frame).toContain('Run complete');
    expect(frame).toContain('Done');
    expect(frame).toContain('1h 01m');
    expect(frame).toContain('Failed (12)');
    expect(frame).toContain('and 2 more');
    expect(frame).toContain('checksum mismatch');
  });

  it('omits the failures panel when there are none', async () => {
    const out = await renderAt(<RunSummary title="Run complete" stats={stats} durationMs={1_000} />, 120);
    expect(stripAnsi(out.frame())).not.toContain('Failed (');
  });

  it('draws a border only when there is room', async () => {
    const wide = await renderAt(<RunSummary title="Run complete" stats={stats} durationMs={1_000} />, 120);
    expect(wide.frame()).toContain('╭');
    const narrow = await renderAt(<RunSummary title="Run complete" stats={stats} durationMs={1_000} />, 30);
    expect(narrow.frame()).not.toContain('╭');
  });

  it.each(WIDTHS)('fits %i columns', async (columns) => {
    const out = await renderAt(<RunSummary title="Run complete" stats={stats} durationMs={1_000} failures={failures} />, columns);
    expect(widest(out.lines())).toBeLessThanOrEqual(columns);
  });

  it('is colourless under NO_COLOR', async () => {
    const out = await renderAt(<RunSummary title="Run complete" stats={stats} durationMs={1_000} failures={failures} />, 80, { noColor: true });
    expect(hasAnsi(out.frame().replace(/\u001B\[(1|2|22)m/g, ''))).toBe(false);
  });
});
