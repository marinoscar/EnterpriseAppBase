// =============================================================================
// Writing to an export's `out`, with backpressure (from kvox `export-stream.ts`,
// issue #28; packaged by #744)
// =============================================================================
//
// `Writable.write()` returning `false` means the stream's buffer is full. A
// loop that ignores it does not fail: it buffers the ENTIRE file in memory
// inside the stream and then flushes it, which is exactly the "builds the
// whole document in memory" behaviour every writer here must avoid. The
// difference between streaming and not streaming is the `await` below.
// =============================================================================

import { once } from 'node:events';
import type { Writable } from 'node:stream';

/**
 * Writes one chunk, waiting for `drain` when the stream asks for it. Rejects
 * when `out` errors or closes before draining.
 *
 * @param out - the destination.
 * @param chunk - the text or bytes to write.
 * @returns once the chunk is accepted.
 *
 * @example
 * ```ts
 * for await (const row of table.rows) await writeChunk(out, JSON.stringify(row) + '\n');
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export async function writeChunk(out: Writable, chunk: string | Uint8Array): Promise<void> {
  if (out.destroyed) throw out.errored ?? new Error('The export stream was closed');
  if (!out.write(chunk)) {
    // Both waits are cancelled once one settles, so no listener piles up.
    const settled = new AbortController();
    try {
      await Promise.race([
        once(out, 'drain', { signal: settled.signal }),
        once(out, 'close', { signal: settled.signal }).then(() => {
          throw out.errored ?? new Error('The export stream was closed');
        }),
      ]);
    } finally {
      settled.abort();
    }
  }
}

/**
 * Ends the stream and resolves once it has finished; rejects on its error.
 *
 * @param out - the destination.
 * @returns once every byte has been handed on.
 *
 * @example
 * ```ts
 * await endStream(out);
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export async function endStream(out: Writable): Promise<void> {
  if (out.writableFinished) return;
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    out.once('error', onError);
    out.end(() => {
      out.off('error', onError);
      resolve();
    });
  });
}

/** Marks a stream whose `error` events a failed writer already reported. */
const SWALLOWED = Symbol('export-stream-error-swallowed');

/**
 * Destroys `out` with `error` (when it is not already destroyed) and returns
 * the error, for a writer's `catch`: the contract says a failure rejects AND
 * destroys the destination.
 *
 * @param out - the destination.
 * @param error - what went wrong.
 * @returns `error` as an `Error`.
 *
 * @stability experimental
 */
export function failStream(out: Writable, error: unknown): Error {
  const err = error instanceof Error ? error : new Error(String(error));
  // The writer reports the failure by rejecting; the `error` event the
  // destroy emits (on the next tick) must not become an uncaught exception.
  if (!(out as { [SWALLOWED]?: true })[SWALLOWED]) {
    (out as { [SWALLOWED]?: true })[SWALLOWED] = true;
    out.on('error', () => undefined);
  }
  if (!out.destroyed) out.destroy(err);
  return err;
}
