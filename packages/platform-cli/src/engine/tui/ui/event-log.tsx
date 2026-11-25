import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

import { useTuiTheme } from '../context.js';
import { useTerminalSize } from '../layout.js';
import { middleTruncate, toneProps, type TuiTone } from './tone.js';

/**
 * One line of an {@link EventLog}.
 *
 * @stability experimental
 */
export interface TuiLogEvent<K extends string = string> {
  /** A stable key; a new event must never reuse one. */
  id: string | number;
  /** Selects the glyph and tone from the log's `kinds`. */
  kind: K;
  /** The main text, e.g. a path; shortened in the middle when the line is full. */
  text: string;
  /** A trailing explanation, e.g. a reason or an error; dim, cut at the end. */
  detail?: string | undefined;
  /** True when the item will be tried again. */
  retrying?: boolean | undefined;
}

/**
 * How one event kind is drawn.
 *
 * @stability experimental
 */
export interface TuiLogKind {
  /** A short mark, normally one cell. It carries the meaning when colour is off. */
  glyph: string;
  /** The colour role. */
  tone: TuiTone;
}

/**
 * Props of {@link EventLog}.
 *
 * @stability experimental
 */
export interface EventLogProps<K extends string> {
  /** Oldest first; the newest `maxVisible` are drawn. */
  events: readonly TuiLogEvent<K>[];
  /** The glyph and tone of each kind. An unknown kind is drawn as a dim bullet. */
  kinds: Readonly<Record<K, TuiLogKind>>;
  /** How many lines to show; default 8. */
  maxVisible?: number | undefined;
  /** An optional heading above the lines. */
  title?: string | undefined;
}

const DEFAULT_MAX_VISIBLE = 8;

/**
 * A rolling log: the newest lines, newest last.
 *
 * Draws nothing when there are no events. Each line is one terminal row; text is
 * shortened in the middle and the detail at the end, so a long path never wraps.
 *
 * @typeParam K - The event kinds the app uses.
 * @param props - The events and how each kind looks.
 * @returns The log, or nothing when empty.
 * @stability experimental
 */
export function EventLog<K extends string>({
  events,
  kinds,
  maxVisible,
  title,
}: EventLogProps<K>): ReactNode {
  const theme = useTuiTheme();
  const { columns, tiny } = useTerminalSize();

  if (events.length === 0) return null;

  const limit = Math.max(1, Math.floor(maxVisible ?? DEFAULT_MAX_VISIBLE));
  const visible = events.slice(-limit);
  // Roughly two thirds of the row for the text, the rest for the detail.
  const textBudget = Math.max(8, Math.floor(columns * (tiny ? 0.8 : 0.55)));

  return (
    <Box flexDirection="column">
      {title === undefined ? null : (
        <Text bold dimColor>
          {title}
        </Text>
      )}
      {visible.map((event) => {
        const style: TuiLogKind = kinds[event.kind] ?? { glyph: theme.glyphs.bullet, tone: 'dim' };
        return (
          <Text key={event.id} wrap="truncate-end">
            <Text {...toneProps(theme, style.tone)}>{style.glyph}</Text>
            <Text> </Text>
            <Text {...(style.tone === 'dim' ? { dimColor: true } : {})}>{middleTruncate(event.text, textBudget, theme.glyphs.ellipsis)}</Text>
            {event.detail === undefined || event.detail === '' ? null : <Text dimColor>{` ${event.detail}`}</Text>}
            {event.retrying === true ? <Text dimColor>{' (retrying)'}</Text> : null}
          </Text>
        );
      })}
    </Box>
  );
}
