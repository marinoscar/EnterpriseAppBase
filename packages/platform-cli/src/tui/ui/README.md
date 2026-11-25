# `@marinoscar/platform-cli/tui/ui`

The ink component kit: an event log, a segmented progress meter with its legend, a status line, in-flight item bars and an end-of-run summary, plus the platform's own screen building blocks. It is catalogued in the [`tui` slice README](../README.md#component-kit-tuiui) (the `tui` slice's second subpath); this page is the reference for the components.

## Purpose and scope

App-neutral and theme-aware: every component takes its colours from `useTuiTheme()` as a tone (`primary`, `success`, `warning`, `error`, `info`, `dim`, `accent`) and draws plain text under `NO_COLOR`, so meaning never depends on colour (a glyph or a label always carries it). Every component narrows below `NARROW_COLUMNS` (56) and `TINY_COLUMNS` (30): borders and separators go, rows truncate in the middle instead of wrapping. Product vocabulary (uploads, folders) is supplied by the app as labels, kinds and glyphs.

## Install and peer dependencies

Ships inside `@marinoscar/platform-cli`. Importing this subpath loads ink; `@marinoscar/platform-cli/tui` stays ink-free.

```tsx
import { EventLog, SegmentMeter, MeterLegend, StatusLine, ActiveItems, RunSummary, Frame } from '@marinoscar/platform-cli/tui/ui';
```

## Components

| Component | Props | Draws |
|---|---|---|
| `EventLog<K>` | `events: TuiLogEvent<K>[]`, `kinds: Record<K, { glyph, tone }>`, `maxVisible?` (8), `title?` | The newest lines, newest last: glyph, text (middle-truncated), dim detail, `(retrying)`. Nothing when empty |
| `SegmentMeter<C>` | `segments: { id, count, tone, glyph?, label?, done? }[]`, `total`, `width?` (56, cut to the terminal) | One row of cells per category, the unfilled share in a light block, and a percentage of the `done` categories |
| `MeterLegend<C>` | the same `segments` and `total` | Glyph, label, count and share per category plus `sum / total`; stacked one per line when narrow |
| `StatusLine` | `title`, `items: { label, value, tone? }[]`, `done?`, `durationMs?` | Title, labelled values, a one-second elapsed clock (stopped when `done`), a spinner and `running`, or a check and `done` |
| `ActiveItems` | `items: { id, label, fraction }[]`, `maxVisible?` (5), `title?` | A mini bar, percentage and middle-truncated label per item, and `and N more` |
| `RunSummary` | `title`, `stats: { label, value, tone? }[]`, `durationMs`, `failures?: { id, label, error }[]`, `footer?` | A bordered panel of stats and duration, a failures panel (first ten), and the footer; unbordered when narrow |

`allocateMeterCells(counts, total, width)` is the pure rounding behind the meter: largest-remainder allocation that returns `counts.length + 1` cells (the last is the unfilled share), always summing to `width`, and never giving a non-zero category fewer than one cell. `middleTruncate(text, max)` and `toneProps(theme, tone)` are exported for screens that draw their own rows.

Promoted from the platform's internals (stability `experimental`): `Frame`, `KeyHints`, `Field`, `ErrorNotice`, `ScrollBox`, `useTerminalSize`, `NARROW_COLUMNS`, `TINY_COLUMNS` and `formatDuration`.

## Quick start

```tsx
const KINDS = {
  done: { glyph: '✔', tone: 'success' },
  failed: { glyph: '✖', tone: 'error' },
} as const;

<Frame title="Import" hints={['esc back']}>
  <StatusLine title="Import" items={[{ label: 'files', value: String(total) }]} done={finished} durationMs={ms} />
  <SegmentMeter segments={segments} total={total} />
  <MeterLegend segments={segments} total={total} />
  <ActiveItems items={inFlight} />
  <EventLog events={events} kinds={KINDS} title="Recent" />
</Frame>
```

## Testing

Render at a chosen width with `ink-testing-library` (a dev dependency here): its fake stdout is 100 columns, so shadow `columns` and emit `resize`, as `test/render-at.ts` does.

## Security notes

Components render only the strings they are given; pass no secrets. Paths are truncated for display, never resolved or normalised.

## Links

- [`tui` slice README](../README.md)
- [Package README](../../../README.md)
