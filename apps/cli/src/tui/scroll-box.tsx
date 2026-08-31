import { Box, Text, useInput } from 'ink';
import { useEffect, useState, type ReactNode } from 'react';

import { useTerminalSize } from './layout.js';

// =============================================================================
// A scrollable viewport  (issue #145, epic #110)
// =============================================================================
//
// #145 asks for the API response to be "rendered scrollably", and the reason is
// concrete: `GET /api/users` against a real installation is hundreds of lines
// of formatted JSON. Printing all of it inside a full-screen app is the one
// thing a full-screen app must not do — ink redraws its ENTIRE output on every
// state change, so a 400-line frame is 400 lines rewritten on each keypress,
// and anything above the terminal's height is pushed into scrollback where the
// redraw cannot reach it. The result is a screen full of overlapping fragments
// of previous frames.
//
// So the viewport is bounded to what fits, and the user moves it. That keeps
// the frame a fixed number of rows regardless of the payload, which is what
// makes redrawing cheap and correct.
//
// SLICING IS BY LINE, AND THE LINES ARE PLAIN TEXT — see the note on colour in
// screens/invoke.tsx. Slicing text that contains ANSI colour sequences by line
// is safe only if every sequence opens and closes within one line; a viewport
// that started mid-run of a colour would tint the rest of the frame.
// =============================================================================

export interface ScrollBoxProps {
  /** Already split into display lines. */
  lines: string[];
  /**
   * Rows the surrounding chrome needs. Subtracted from the terminal height so
   * the viewport plus the frame plus the hint line fit WITHOUT the terminal
   * scrolling — if the total exceeds the height, the terminal scrolls the top
   * of ink's frame off screen and every subsequent redraw leaves a copy behind.
   */
  reservedRows?: number | undefined;
  /** Arrow keys are ignored while false, so two screens cannot both scroll. */
  isActive?: boolean | undefined;
}

/** Never show fewer than this, even in a very short terminal. */
const MIN_VIEWPORT_ROWS = 3;

export function ScrollBox({ lines, reservedRows, isActive }: ScrollBoxProps): ReactNode {
  const { rows } = useTerminalSize();
  const [offset, setOffset] = useState(0);

  const viewportRows = Math.max(MIN_VIEWPORT_ROWS, rows - (reservedRows ?? 12));
  const maxOffset = Math.max(0, lines.length - viewportRows);

  // Clamped as a state EFFECT rather than only at render, because the terminal
  // can be made taller while scrolled to the bottom: the viewport grows, the
  // maximum offset shrinks, and an offset left past the new maximum renders a
  // window of blank lines below the end of the content. Resetting to the top
  // when the content itself changes is the other half — a new response must not
  // open already scrolled to where the previous one was being read.
  useEffect(() => {
    setOffset((current) => Math.min(current, Math.max(0, lines.length - viewportRows)));
  }, [lines, viewportRows]);

  useInput(
    (input, key) => {
      if (key.downArrow || input === 'j') setOffset((o) => Math.min(maxOffset, o + 1));
      else if (key.upArrow || input === 'k') setOffset((o) => Math.max(0, o - 1));
      else if (key.pageDown || input === ' ') setOffset((o) => Math.min(maxOffset, o + viewportRows));
      else if (key.pageUp) setOffset((o) => Math.max(0, o - viewportRows));
      else if (input === 'g') setOffset(0);
      else if (input === 'G') setOffset(maxOffset);
    },
    { isActive: isActive ?? true },
  );

  const visible = lines.slice(offset, offset + viewportRows);

  return (
    <Box flexDirection="column">
      {visible.map((line, index) => (
        // The index is part of the key because the SAME TEXT can legitimately
        // appear twice in formatted JSON (`  },` on consecutive lines is the
        // common case) and duplicate keys make React reuse the wrong node —
        // which shows up as lines that fail to update while scrolling.
        // The offset is included so a scroll actually remounts the row.
        <Text key={`${offset + index}:${line}`} wrap="truncate-end">
          {line.length === 0 ? ' ' : line}
        </Text>
      ))}

      {lines.length > viewportRows ? (
        <Text dimColor>
          {`— lines ${offset + 1}–${Math.min(lines.length, offset + viewportRows)} of ${lines.length}  (↑↓ scroll, g/G top/bottom) —`}
        </Text>
      ) : null}
    </Box>
  );
}
