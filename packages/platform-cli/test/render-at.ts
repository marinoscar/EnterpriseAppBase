import type { ReactElement } from 'react';
import { render, cleanup } from 'ink-testing-library';

// =============================================================================
// Rendering at a chosen terminal width  (RETRO-G1.4, #1068)
// =============================================================================
//
// ink-testing-library's fake stdout is always 100 columns wide. The component
// kit degrades by width, so a test needs to pick one: this shadows `columns`
// on the fake stream and emits `resize`, which both ink's layout and
// `useTerminalSize` listen for.
// =============================================================================

export { cleanup };

export interface RenderedAt {
  /** The latest frame without trailing newline noise. */
  frame: () => string;
  /** Every line of the latest frame. */
  lines: () => string[];
  unmount: () => void;
}

/**
 * Render a component at `columns` wide.
 *
 * The kit reads its theme from `useTuiTheme()`, which outside a provider
 * resolves the default theme from the environment at first render, so
 * monochrome is requested by setting `NO_COLOR` around that render.
 *
 * @param node - The element.
 * @param columns - The terminal width.
 * @param options - `noColor` renders as under `NO_COLOR`.
 * @returns Accessors for the latest frame.
 */
export async function renderAt(
  node: ReactElement,
  columns: number,
  options: { noColor?: boolean } = {},
): Promise<RenderedAt> {
  const before = process.env['NO_COLOR'];
  if (options.noColor === true) process.env['NO_COLOR'] = '1';
  else delete process.env['NO_COLOR'];
  let result: ReturnType<typeof render>;
  try {
    result = render(node);
  } finally {
    if (before === undefined) delete process.env['NO_COLOR'];
    else process.env['NO_COLOR'] = before;
  }
  Object.defineProperty(result.stdout, 'columns', { value: columns, configurable: true });
  result.stdout.emit('resize');
  await new Promise((resolve) => setTimeout(resolve, 30));
  const frame = (): string => result.lastFrame() ?? '';
  return { frame, lines: () => frame().split('\n'), unmount: result.unmount };
}

/** Strip ANSI colour sequences. */
export function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001B\[[0-9;]*m/g, '');
}

/** True when the text contains an ANSI colour sequence. */
export function hasAnsi(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /\u001B\[[0-9;]*m/.test(value);
}
