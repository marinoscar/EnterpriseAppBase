import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { EXIT } from '../errors.js';
import { startTui } from './index.js';

// =============================================================================
// startTui on a console with no usable terminal  (RETRO-G1.2, #1066)
// =============================================================================

afterEach(() => vi.restoreAllMocks());

describe('startTui without a usable terminal', () => {
  it('exits through the refusal path with a message, not a stack trace', async () => {
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    const stdin = Object.assign(new PassThrough(), {
      isTTY: true,
      setRawMode: () => {
        throw Object.assign(new Error('setRawMode EIO'), { code: 'EIO' });
      },
    }) as unknown as NodeJS.ReadStream;

    const code = await startTui({ stdin, openTerminal: () => undefined });

    expect(code).toBe(EXIT.USAGE);
    const text = written.join('');
    expect(text).toContain('cannot run the interactive interface');
    expect(text).not.toContain('EIO');
    expect(text).not.toMatch(/\n\s+at /);
  });
});
