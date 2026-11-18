import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { canUseRawMode, hasInteractiveStdin, resolveInteractiveStdin } from './raw-mode.js';

// =============================================================================
// Raw-mode resolution  (RETRO-G1.2, #1066)
// =============================================================================

function fakeTty(setRawMode: (mode: boolean) => unknown): NodeJS.ReadStream {
  const stream = Object.assign(new PassThrough(), { isTTY: true, setRawMode });
  return stream as unknown as NodeJS.ReadStream;
}

const works = (): NodeJS.ReadStream => fakeTty(() => undefined);
const eio = (): NodeJS.ReadStream =>
  fakeTty(() => {
    throw Object.assign(new Error('setRawMode EIO'), { code: 'EIO' });
  });

describe('canUseRawMode', () => {
  it('is true for a TTY whose setRawMode works, and leaves raw mode off', () => {
    const calls: boolean[] = [];
    expect(canUseRawMode(fakeTty((mode) => calls.push(mode)))).toBe(true);
    expect(calls).toEqual([true, false]);
  });

  it('is false when setRawMode throws EIO (serial, hypervisor and LXC consoles)', () => {
    expect(canUseRawMode(eio())).toBe(false);
  });

  it('is false for a stream that is not a TTY, has no setRawMode, or is missing', () => {
    expect(canUseRawMode(new PassThrough())).toBe(false);
    expect(canUseRawMode(Object.assign(new PassThrough(), { isTTY: true }))).toBe(false);
    expect(canUseRawMode(undefined)).toBe(false);
    expect(canUseRawMode(null)).toBe(false);
  });
});

describe('resolveInteractiveStdin', () => {
  it('prefers the given stdin and never opens the terminal', () => {
    const stdin = works();
    const openTerminal = vi.fn();
    const handle = resolveInteractiveStdin({ stdin, openTerminal });
    expect(handle?.stream).toBe(stdin);
    expect(handle?.fromControllingTerminal).toBe(false);
    expect(openTerminal).not.toHaveBeenCalled();
  });

  it('falls back to the controlling terminal when setRawMode throws EIO, and release destroys it', () => {
    const terminal = works();
    const handle = resolveInteractiveStdin({ stdin: eio(), openTerminal: () => terminal });
    expect(handle?.stream).toBe(terminal);
    expect(handle?.fromControllingTerminal).toBe(true);
    handle?.release();
    handle?.release();
    expect(terminal.destroyed).toBe(true);
  });

  it('falls back when stdin is redirected (not a TTY)', () => {
    const terminal = works();
    expect(resolveInteractiveStdin({ stdin: new PassThrough(), openTerminal: () => terminal })?.stream).toBe(terminal);
  });

  it('returns null, without throwing, when /dev/tty cannot be opened', () => {
    const handle = resolveInteractiveStdin({
      stdin: eio(),
      openTerminal: () => {
        throw Object.assign(new Error('ENXIO: no such device or address'), { code: 'ENXIO' });
      },
    });
    expect(handle).toBeNull();
  });

  it('returns null and destroys a controlling terminal that cannot take raw mode either', () => {
    const terminal = eio();
    expect(resolveInteractiveStdin({ stdin: eio(), openTerminal: () => terminal })).toBeNull();
    expect(terminal.destroyed).toBe(true);
  });

  it('returns null when there is no terminal at all', () => {
    expect(resolveInteractiveStdin({ stdin: undefined, openTerminal: () => undefined })).toBeNull();
  });
});

describe('hasInteractiveStdin', () => {
  it('answers the gate question and gives the opened terminal back', () => {
    const terminal = works();
    expect(hasInteractiveStdin({ stdin: null, openTerminal: () => terminal })).toBe(true);
    expect(terminal.destroyed).toBe(true);
    expect(hasInteractiveStdin({ stdin: null, openTerminal: () => undefined })).toBe(false);
  });
});
