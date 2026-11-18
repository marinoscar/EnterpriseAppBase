import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

import { useTuiTheme } from '../context.js';
import { useTerminalSize } from '../layout.js';
import type { TuiTheme } from '../theme.js';
import { toneProps, type TuiTone } from './tone.js';

/**
 * One category of a {@link SegmentMeter}.
 *
 * @stability experimental
 */
export interface TuiMeterSegment<C extends string = string> {
  /** A stable id, also the legend label unless `label` is set. */
  id: C;
  /** How many items fall in this category. */
  count: number;
  /** The colour role. */
  tone: TuiTone;
  /**
   * The block drawn for this category. Defaults to a theme meter glyph chosen by
   * position, so categories stay distinguishable under `NO_COLOR`.
   */
  glyph?: string | undefined;
  /** The legend text; defaults to `id`. */
  label?: string | undefined;
  /** True when the category counts as finished work (drives the percentage). */
  done?: boolean | undefined;
}

/**
 * Props of {@link SegmentMeter}.
 *
 * @stability experimental
 */
export interface SegmentMeterProps<C extends string> {
  /** The categories, in drawing order. */
  segments: readonly TuiMeterSegment<C>[];
  /** The number of items the full bar stands for. */
  total: number;
  /** Cells to draw; default 56, always cut to fit the terminal. */
  width?: number | undefined;
}

const DEFAULT_METER_WIDTH = 56;
const MIN_METER_WIDTH = 8;
const PERCENT_COLUMNS = 5;

/**
 * Split `width` cells across categories, by largest remainder.
 *
 * Returns one entry per count plus a final entry for the unfilled share
 * (`total` minus the counts, never negative), so the result always sums to
 * exactly `width`. A category with a non-zero count always gets at least one
 * cell, so a single failure among thousands of successes stays visible; the
 * cells come out of the largest categories. When more categories are non-zero
 * than there are cells, the smallest ones are dropped.
 *
 * @param counts - Items per category (negative and non-finite values count as 0).
 * @param total - Items the whole bar stands for; raised to the sum of the counts when smaller.
 * @param width - Cells available; below 1 yields all zeros.
 * @returns `counts.length + 1` whole numbers summing to `width`.
 * @stability experimental
 */
export function allocateMeterCells(counts: readonly number[], total: number, width: number): number[] {
  const cells = Math.max(0, Math.floor(Number.isFinite(width) ? width : 0));
  const shares = counts.map((count) => (Number.isFinite(count) && count > 0 ? count : 0));
  const filled = shares.reduce((sum, share) => sum + share, 0);
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
  const denominator = Math.max(safeTotal, filled);
  shares.push(Math.max(0, denominator - filled));

  const result = shares.map(() => 0);
  if (cells === 0) return result;
  if (denominator === 0) {
    result[result.length - 1] = cells;
    return result;
  }

  const exact = shares.map((share) => (share / denominator) * cells);
  for (let i = 0; i < shares.length; i += 1) result[i] = Math.floor(exact[i] ?? 0);

  // Never lose a non-zero category: lift each empty one to a single cell, largest first.
  const empties = shares
    .map((share, index) => ({ share, index }))
    .filter(({ share, index }) => share > 0 && result[index] === 0)
    .sort((a, b) => b.share - a.share || a.index - b.index);
  for (const { index } of empties) result[index] = 1;

  let allocated = result.reduce((sum, cell) => sum + cell, 0);

  // Over budget (lifts, or more non-zero categories than cells): take from the
  // most over-served cell above one; when none is above one, drop the smallest category.
  while (allocated > cells) {
    let pick = -1;
    let overshoot = -Infinity;
    for (let i = 0; i < result.length; i += 1) {
      const cell = result[i] ?? 0;
      if (cell > 1 && cell - (exact[i] ?? 0) > overshoot) {
        overshoot = cell - (exact[i] ?? 0);
        pick = i;
      }
    }
    if (pick === -1) {
      let smallest = Infinity;
      for (let i = 0; i < result.length; i += 1) {
        if ((result[i] ?? 0) > 0 && (shares[i] ?? 0) < smallest) {
          smallest = shares[i] ?? 0;
          pick = i;
        }
      }
    }
    result[pick] = (result[pick] ?? 0) - 1;
    allocated -= 1;
  }

  // Under budget: hand the leftovers to the largest remainders.
  while (allocated < cells) {
    let pick = 0;
    let deficit = -Infinity;
    for (let i = 0; i < result.length; i += 1) {
      if ((shares[i] ?? 0) <= 0) continue;
      const gap = (exact[i] ?? 0) - (result[i] ?? 0);
      if (gap > deficit) {
        deficit = gap;
        pick = i;
      }
    }
    result[pick] = (result[pick] ?? 0) + 1;
    allocated += 1;
  }

  return result;
}

/** The block for a segment: its own, else a theme meter glyph by position. */
export function segmentGlyph(theme: TuiTheme, segment: TuiMeterSegment, index: number): string {
  if (segment.glyph !== undefined) return segment.glyph;
  const { full, dense, medium, light } = theme.glyphs.meter;
  const cycle = [full, dense, medium, light];
  return cycle[index % cycle.length] ?? full;
}

/**
 * A one-row segmented progress bar.
 *
 * Each category is a run of cells in its own tone and glyph; the share not yet
 * accounted for is drawn with the theme's light block, dimmed. The width is cut
 * to the terminal, and a percentage of the `done` categories follows the bar
 * when at least one is flagged and there is room.
 *
 * @typeParam C - The category ids the app uses.
 * @param props - The categories and the total.
 * @returns The bar.
 * @stability experimental
 */
export function SegmentMeter<C extends string>({ segments, total, width }: SegmentMeterProps<C>): ReactNode {
  const theme = useTuiTheme();
  const { columns } = useTerminalSize();

  const hasDone = segments.some((segment) => segment.done === true);
  const showPercent = hasDone && columns >= 30;
  const available = Math.max(MIN_METER_WIDTH, columns - 2 - (showPercent ? PERCENT_COLUMNS : 0));
  const cells = Math.min(Math.max(1, Math.floor(width ?? DEFAULT_METER_WIDTH)), available);

  const allocation = allocateMeterCells(
    segments.map((segment) => segment.count),
    total,
    cells,
  );

  const finished = segments.reduce((sum, segment) => sum + (segment.done === true ? Math.max(0, segment.count) : 0), 0);
  const percent = total > 0 ? Math.min(100, Math.round((finished / total) * 100)) : 0;

  return (
    <Box>
      <Text>
        {segments.map((segment, index) => {
          const run = allocation[index] ?? 0;
          return run === 0 ? null : (
            <Text key={segment.id} {...toneProps(theme, segment.tone)}>
              {segmentGlyph(theme, segment, index).repeat(run)}
            </Text>
          );
        })}
        {(allocation[segments.length] ?? 0) === 0 ? null : (
          <Text dimColor>{theme.glyphs.meter.light.repeat(allocation[segments.length] ?? 0)}</Text>
        )}
      </Text>
      {showPercent ? <Text dimColor>{` ${String(percent).padStart(3)}%`}</Text> : null}
    </Box>
  );
}
