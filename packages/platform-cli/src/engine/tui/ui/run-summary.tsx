import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

import { formatDuration } from '../../node/node-dashboard-source.js';
import { useTuiTheme } from '../context.js';
import { useTerminalSize } from '../layout.js';
import { textColor } from '../theme.js';
import { middleTruncate, toneProps, type TuiTone } from './tone.js';

/**
 * One headline number of a {@link RunSummary}.
 *
 * @stability experimental
 */
export interface TuiSummaryStat {
  /** What it counts. Dim. */
  label: string;
  /** The value, already formatted. */
  value: string;
  /** The value's colour role. */
  tone?: TuiTone | undefined;
}

/**
 * One failed item listed by a {@link RunSummary}.
 *
 * @stability experimental
 */
export interface TuiSummaryFailure {
  /** A stable key. */
  id: string | number;
  /** What failed, e.g. a path. */
  label: string;
  /** Why. */
  error: string;
}

/**
 * Props of {@link RunSummary}.
 *
 * @stability experimental
 */
export interface RunSummaryProps {
  /** The heading, e.g. `Run complete`. */
  title: string;
  /** The headline numbers, left to right. */
  stats: readonly TuiSummaryStat[];
  /** How long the run took; shown as a final stat. */
  durationMs: number;
  /** Items to list as failed; the first ten are drawn. */
  failures?: readonly TuiSummaryFailure[] | undefined;
  /** Anything below, e.g. key hints or an export path. */
  footer?: ReactNode;
}

const MAX_FAILURES = 10;

/**
 * The end-of-run panel: headline stats, duration, a failures list and a footer.
 *
 * Bordered when there is room; below the narrow threshold the border and
 * padding go, so the content keeps every column. Draws no keys of its own, the
 * screen decides what Enter or `r` mean.
 *
 * @param props - The title, stats, duration, failures and footer.
 * @returns The panel.
 * @stability experimental
 */
export function RunSummary({ title, stats, durationMs, failures, footer }: RunSummaryProps): ReactNode {
  const theme = useTuiTheme();
  const { columns, narrow } = useTerminalSize();

  const failed = failures ?? [];
  const shown = failed.slice(0, MAX_FAILURES);
  const labelBudget = Math.max(8, Math.floor(columns * 0.35));

  const panel = (
    <Box flexDirection="column" gap={narrow ? 0 : 1}>
      <Text bold {...textColor(theme.primary)}>
        {title}
      </Text>
      <Box flexWrap="wrap" columnGap={narrow ? 2 : 4}>
        {stats.map((stat) => (
          <Box key={stat.label} flexDirection="column">
            <Text dimColor>{stat.label}</Text>
            <Text bold {...toneProps(theme, stat.tone)}>
              {stat.value}
            </Text>
          </Box>
        ))}
        <Box flexDirection="column">
          <Text dimColor>Duration</Text>
          <Text bold>{formatDuration(durationMs)}</Text>
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box flexDirection="column" gap={narrow ? 0 : 1}>
      {narrow ? (
        panel
      ) : (
        <Box borderStyle="round" {...(theme.primary === undefined ? {} : { borderColor: theme.primary })} flexDirection="column" paddingX={2} paddingY={1}>
          {panel}
        </Box>
      )}

      {shown.length === 0 ? null : (
        <Box
          flexDirection="column"
          {...(narrow ? {} : { borderStyle: 'round' as const, paddingX: 2, paddingY: 1 })}
          {...(narrow || theme.error === undefined ? {} : { borderColor: theme.error })}
        >
          <Text bold {...textColor(theme.error)}>{`Failed (${failed.length})`}</Text>
          {shown.map((failure) => (
            <Text key={failure.id} wrap="truncate-end">
              <Text {...textColor(theme.error)}>{theme.glyphs.cross}</Text>
              <Text>{` ${middleTruncate(failure.label, labelBudget, theme.glyphs.ellipsis)}`}</Text>
              <Text dimColor>{`: ${failure.error}`}</Text>
            </Text>
          ))}
          {failed.length > shown.length ? (
            <Text dimColor>{`${theme.glyphs.ellipsis} and ${failed.length - shown.length} more`}</Text>
          ) : null}
        </Box>
      )}

      {footer === undefined || footer === null ? null : <Box flexDirection="column">{footer}</Box>}
    </Box>
  );
}
