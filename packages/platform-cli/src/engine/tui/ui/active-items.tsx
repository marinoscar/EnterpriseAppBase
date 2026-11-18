import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

import { useTuiTheme } from '../context.js';
import { useTerminalSize } from '../layout.js';
import { textColor } from '../theme.js';
import { middleTruncate } from './tone.js';

/**
 * One in-flight item of {@link ActiveItems}.
 *
 * @stability experimental
 */
export interface TuiActiveItem {
  /** A stable key. */
  id: string | number;
  /** What the item is, e.g. a path; shortened in the middle to fit. */
  label: string;
  /** Progress from 0 to 1; out-of-range and non-finite values are clamped. */
  fraction: number;
}

/**
 * Props of {@link ActiveItems}.
 *
 * @stability experimental
 */
export interface ActiveItemsProps {
  /** Everything in flight; the first `maxVisible` are drawn. */
  items: readonly TuiActiveItem[];
  /** How many rows to show; default 5. */
  maxVisible?: number | undefined;
  /** A heading; default `Active`. The count is appended. */
  title?: string | undefined;
}

const DEFAULT_MAX_VISIBLE = 5;

function clampFraction(fraction: number): number {
  return Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
}

/**
 * Mini progress bars for the items currently in flight.
 *
 * Each row is a bar, a percentage and the label. The bar shrinks with the
 * terminal and the label takes what is left, cut in the middle, so a row never
 * wraps. Draws nothing when there are no items.
 *
 * @param props - The items and how many to show.
 * @returns The rows, or nothing when empty.
 * @stability experimental
 */
export function ActiveItems({ items, maxVisible, title }: ActiveItemsProps): ReactNode {
  const theme = useTuiTheme();
  const { columns, narrow, tiny } = useTerminalSize();

  if (items.length === 0) return null;

  const limit = Math.max(1, Math.floor(maxVisible ?? DEFAULT_MAX_VISIBLE));
  const visible = items.slice(0, limit);
  const barWidth = tiny ? 6 : narrow ? 10 : 20;
  // bar + space + "100%" + space.
  const labelBudget = Math.max(6, columns - barWidth - 7);

  return (
    <Box flexDirection="column">
      <Text bold dimColor>{`${title ?? 'Active'} (${items.length})`}</Text>
      {visible.map((item) => {
        const fraction = clampFraction(item.fraction);
        const filled = Math.round(fraction * barWidth);
        return (
          <Text key={item.id} wrap="truncate-end">
            <Text {...textColor(theme.primary)}>{theme.glyphs.meter.full.repeat(filled)}</Text>
            <Text dimColor>{theme.glyphs.meter.light.repeat(barWidth - filled)}</Text>
            <Text dimColor>{` ${String(Math.round(fraction * 100)).padStart(3)}% `}</Text>
            <Text>{middleTruncate(item.label, labelBudget, theme.glyphs.ellipsis)}</Text>
          </Text>
        );
      })}
      {items.length > limit ? <Text dimColor>{`  ${theme.glyphs.ellipsis} and ${items.length - limit} more`}</Text> : null}
    </Box>
  );
}
