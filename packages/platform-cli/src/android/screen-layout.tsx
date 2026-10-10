// Minimal layout pieces for the Android TUI screen (#746). The engine's own
// Frame/Field/ScrollBox are internal to the engine slice; a slice screen
// draws with plain ink, as an app's screen does.

import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

import { cliDisplayName } from '../engine/index.js';

/** A titled frame with key hints. */
export function Frame({ title, hints, children }: { title: string; hints?: string[]; children: ReactNode }): ReactNode {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column" gap={1}>
      <Box>
        <Text bold color="cyan">
          {cliDisplayName()}
        </Text>
        <Text dimColor> · </Text>
        <Text bold>{title}</Text>
      </Box>
      <Box flexDirection="column">{children}</Box>
      {hints !== undefined && hints.length > 0 ? <Text dimColor>{hints.join('  ·  ')}</Text> : null}
    </Box>
  );
}

/** A label and a value on one line. */
export function Field({ label, value, color }: { label: string; value: string; color?: string | undefined }): ReactNode {
  return (
    <Box>
      <Text dimColor>{label.padEnd(10)}</Text>
      <Text {...(color === undefined ? {} : { color })}>{value}</Text>
    </Box>
  );
}

/** An error and an optional hint. */
export function ErrorNotice({ message, hint }: { message: string; hint?: string | undefined }): ReactNode {
  return (
    <Box flexDirection="column">
      <Text color="red">✗ {message}</Text>
      {hint !== undefined ? <Text dimColor>{hint}</Text> : null}
    </Box>
  );
}

/** The last lines of a log that fit the terminal (it follows the tail). */
export function ScrollBox({ lines, reservedRows = 10 }: { lines: readonly string[]; reservedRows?: number; followTail?: boolean; isActive?: boolean }): ReactNode {
  const rows = Math.max(3, (process.stdout.rows ?? 24) - reservedRows);
  return (
    <Box flexDirection="column">
      {lines.slice(-rows).map((line, index) => (
        <Text key={`${index}-${line}`}>{line}</Text>
      ))}
    </Box>
  );
}
