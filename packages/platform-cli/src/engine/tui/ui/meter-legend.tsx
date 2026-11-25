import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

import { useTuiTheme } from '../context.js';
import { useTerminalSize } from '../layout.js';
import { segmentGlyph, type TuiMeterSegment } from './segment-meter.js';
import { toneProps } from './tone.js';

/**
 * Props of {@link MeterLegend}.
 *
 * @stability experimental
 */
export interface MeterLegendProps<C extends string> {
  /** The same list the {@link SegmentMeter} draws, so glyphs and tones match. */
  segments: readonly TuiMeterSegment<C>[];
  /** The number of items the full bar stands for; drives the percentages. */
  total: number;
}

/**
 * Swatches with a label, count and share for each meter category.
 *
 * Wide terminals wrap the entries in a row; below the narrow threshold they
 * stack one per line so nothing is cut.
 *
 * @typeParam C - The category ids the app uses.
 * @param props - The categories and the total.
 * @returns The legend.
 * @stability experimental
 */
export function MeterLegend<C extends string>({ segments, total }: MeterLegendProps<C>): ReactNode {
  const theme = useTuiTheme();
  const { narrow } = useTerminalSize();

  const sum = segments.reduce((acc, segment) => acc + Math.max(0, segment.count), 0);
  const share = (count: number): string => (total > 0 ? `${Math.round((Math.max(0, count) / total) * 100)}%` : '0%');

  return (
    <Box {...(narrow ? { flexDirection: 'column' as const } : { flexDirection: 'row' as const, flexWrap: 'wrap' as const, columnGap: 2 })}>
      {segments.map((segment, index) => (
        <Text key={segment.id} wrap="truncate-end">
          <Text {...toneProps(theme, segment.tone)}>{segmentGlyph(theme, segment, index)}</Text>
          <Text dimColor>{` ${segment.label ?? segment.id} `}</Text>
          <Text>{segment.count}</Text>
          <Text dimColor>{` (${share(segment.count)})`}</Text>
        </Text>
      ))}
      <Text dimColor>{`${sum} / ${total}`}</Text>
    </Box>
  );
}
