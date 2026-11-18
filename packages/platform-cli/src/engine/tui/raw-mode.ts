import { closeSync, openSync } from 'node:fs';
import { ReadStream } from 'node:tty';

// =============================================================================
// Raw-mode resolution  (RETRO-G1.2, #1066)
// =============================================================================
//
// ink puts stdin into raw mode to read keystrokes. On serial, hypervisor and
// LXC consoles, or when fd 0 is redirected while stdout is still a terminal,
// `setRawMode` throws EIO, and ink surfaces that synchronously from `render`:
// the whole CLI dies with a stack trace. The controlling terminal (`/dev/tty`)
// often still works in those cases, so the TUI falls back to it.
//
// PURE ON PURPOSE: node built-ins only, no ink and no React, so the TTY gate
// (tty.ts) can ask "could the TUI start?" without loading the renderer.
// =============================================================================

/**
 * True only when `stream` is a TTY whose `setRawMode` works. The probe turns
 * raw mode on and straight off again; any throw (EIO on a serial or LXC
 * console, a redirected fd) means the terminal cannot support it.
 *
 * @param stream - A candidate stdin.
 * @returns Whether ink can drive it.
 * @stability experimental
 */
export function canUseRawMode(stream: unknown): stream is NodeJS.ReadStream {
  const candidate = stream as Partial<NodeJS.ReadStream> | null | undefined;
  if (!candidate || candidate.isTTY !== true || typeof candidate.setRawMode !== 'function') return false;
  try {
    candidate.setRawMode(true);
    candidate.setRawMode(false);
    return true;
  } catch {
    return false;
  }
}

/**
 * A stdin ink can drive, and how to let go of it.
 *
 * @stability experimental
 */
export interface InteractiveStdin {
  /** The stream to hand to ink. */
  readonly stream: NodeJS.ReadStream;
  /** True when it is the controlling terminal opened here rather than the given stdin. */
  readonly fromControllingTerminal: boolean;
  /** Destroys a stream this module opened; a no-op for the given stdin. Idempotent. */
  release(): void;
}

/**
 * Seams of {@link resolveInteractiveStdin}; each defaults to the real process.
 *
 * @stability experimental
 */
export interface ResolveInteractiveStdinOptions {
  /** The preferred stdin. Defaults to `process.stdin`. */
  stdin?: unknown;
  /** Opens the controlling terminal read-only. Defaults to `/dev/tty`. Return `undefined` or throw for none. */
  openTerminal?: (() => NodeJS.ReadStream | undefined) | undefined;
}

function openControllingTerminal(): NodeJS.ReadStream | undefined {
  const fd = openSync('/dev/tty', 'r');
  try {
    return new ReadStream(fd) as unknown as NodeJS.ReadStream;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

/**
 * Finds a stdin ink can drive in raw mode. Prefers the given stdin; when it
 * cannot (fd 0 redirected or broken) opens the controlling terminal read-only.
 * Never throws.
 *
 * @param options - Test seams.
 * @returns A handle, or `null` when no usable terminal exists.
 * @stability experimental
 */
export function resolveInteractiveStdin(options: ResolveInteractiveStdinOptions = {}): InteractiveStdin | null {
  try {
    const stdin = 'stdin' in options ? options.stdin : process.stdin;
    if (canUseRawMode(stdin)) {
      return { stream: stdin, fromControllingTerminal: false, release: () => undefined };
    }

    let opened: NodeJS.ReadStream | undefined;
    try {
      opened = (options.openTerminal ?? openControllingTerminal)();
    } catch {
      return null; // No /dev/tty (Windows, a daemon without a controlling terminal).
    }
    if (opened === undefined) return null;

    const terminal = opened;
    if (!canUseRawMode(terminal)) {
      (terminal as unknown as { destroy?: () => void }).destroy?.();
      return null;
    }
    let released = false;
    return {
      stream: terminal,
      fromControllingTerminal: true,
      release: () => {
        if (released) return;
        released = true;
        (terminal as unknown as { destroy?: () => void }).destroy?.();
      },
    };
  } catch {
    return null;
  }
}

/**
 * Whether a stdin ink can drive exists, without keeping it: the TTY gate's
 * question. Opens and closes the controlling terminal when it has to.
 *
 * @param options - Test seams.
 * @returns True when {@link resolveInteractiveStdin} would succeed.
 * @stability experimental
 */
export function hasInteractiveStdin(options: ResolveInteractiveStdinOptions = {}): boolean {
  const handle = resolveInteractiveStdin(options);
  handle?.release();
  return handle !== null;
}
