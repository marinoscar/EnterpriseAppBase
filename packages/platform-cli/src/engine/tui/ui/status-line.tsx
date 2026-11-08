import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useEffect, useState, type ReactNode } from 'react';

import { formatDuration } from '../../node/node-dashboard-source.js';
import { useTuiTheme } from '../context.js';
import { useTerminalSize } from '../layout.js';
import { textColor } from '../theme.js';
import { toneProps, type TuiTone } from './tone.js';

/**
 * One labelled value of a {@link StatusLine}.
 *
 * @stability experimental
 */
export interface TuiStatusItem {
  /** What the value is, e.g. `server`. Dim. */
  label: string;
  /** The value. */
  value: string;
  /** The value's colour role. */
  tone?: TuiTone | undefined;
}

/**
 * Props of {@link StatusLine}.
 *
 * @stability experimental
 */
export interface StatusLineProps {
  /** The run's name, bold at the start. */
  title: string;
  /** Labelled values shown after the title. */
  items: readonly TuiStatusItem[];
  /** True once the run has finished; stops the clock and the spinner. */
  done?: boolean | undefined;
  /** The final duration shown when `done`; without it the live clock's last value stays. */
  durationMs?: number | undefined;
}

/**
 * A header line: title, labelled values, elapsed time and a running or done mark.
 *
 * Runs its own one-second clock while not `done`, and clears it on unmount.
 * Wraps below the narrow threshold, where the separators are dropped.
 *
 * @param props - The title, items and run state.
 * @returns The line.
 * @stability experimental
 */
export function StatusLine({ title, items, done, durationMs }: StatusLineProps): ReactNode {
  const theme = useTuiTheme();
  const { narrow } = useTerminalSize();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (done === true) return;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000)), 1_000);
    return () => clearInterval(timer);
  }, [done]);

  const elapsed = formatDuration(done === true && durationMs !== undefined ? durationMs : elapsedSeconds * 1_000);
  const separator = narrow ? null : <Text dimColor>│</Text>;

  return (
    <Box flexWrap="wrap" columnGap={narrow ? 2 : 1}>
      <Text bold {...textColor(theme.primary)}>
        {title}
      </Text>
      {items.map((item) => (
        <Box key={item.label} columnGap={1}>
          {separator}
          <Text dimColor>{item.label}</Text>
          <Text {...toneProps(theme, item.tone)}>{item.value}</Text>
        </Box>
      ))}
      <Box columnGap={1}>
        {separator}
        <Text dimColor>elapsed</Text>
        <Text>{elapsed}</Text>
      </Box>
      <Box columnGap={1}>
        {separator}
        {done === true ? (
          <Text {...textColor(theme.success)}>{`${theme.glyphs.check} done`}</Text>
        ) : (
          <>
            <Text {...textColor(theme.primary)}>
              <Spinner type="dots" />
            </Text>
            <Text {...textColor(theme.primary)}>running</Text>
          </>
        )}
      </Box>
    </Box>
  );
}
