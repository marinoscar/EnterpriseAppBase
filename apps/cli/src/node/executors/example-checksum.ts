import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

import { MissingJobInputError } from '../node-errors.js';
import type { JobExecutionContext, JobExecutor } from './index.js';

// =============================================================================
// `example.checksum` — the node counterpart of the server handler  (issue #274)
// =============================================================================
//
// The other half of #269's `ExampleChecksumHandler`. Both paths must reach the
// SAME result for the same object, and this file exists so a fork has a worked
// example of what "the same" means in practice: the same field names, the same
// hash, and `computedBy: 'node'` so a result that looks wrong can be traced to
// the executor that produced it.
//
// It hashes over a STREAM, never a buffer. A 10 GB input costs a hash context
// here just as it does on the server — and streaming is the property that made
// this type worth moving to a node at all: pure CPU over bytes, with no
// database access in the middle.
// =============================================================================

/** Mirrors `ExampleChecksumResult` in `apps/api/src/jobs/contracts/`. */
export interface ExampleChecksumResult {
  sha256: string;
  bytes: number;
  computedAt: string;
  computedBy: 'node';
}

export class ExampleChecksumExecutor implements JobExecutor {
  readonly type = 'example.checksum';

  /** The input IS the work. Without it there is nothing to hash. */
  readonly requiresInput = true;

  async execute(context: JobExecutionContext): Promise<ExampleChecksumResult> {
    // Belt and braces: the engine already refuses a `requiresInput` job with
    // no download URL. Asserting it here too means the executor is safe to
    // call directly — which #279's TUI and a fork's own tests will do.
    if (context.inputPath === undefined || context.inputPath.length === 0) {
      throw new MissingJobInputError(context.job.id, this.type);
    }

    const hash = createHash('sha256');
    let bytes = 0;

    const stream = createReadStream(context.inputPath);
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      hash.update(buffer);
      bytes += buffer.length;
      // Cooperative cancellation: a drain or a lost lease should stop a
      // multi-gigabyte hash rather than finishing work nobody will accept.
      if (context.signal.aborted) {
        stream.destroy();
        throw new Error(`Checksum of job ${context.job.id} was aborted after ${bytes} bytes`);
      }
    }

    context.log('checksum computed', { jobId: context.job.id, bytes });

    return {
      sha256: hash.digest('hex'),
      bytes,
      computedAt: new Date().toISOString(),
      computedBy: 'node',
    };
  }
}

/** Every executor this template ships. A fork appends to this list. */
export function defaultExecutors(): JobExecutor[] {
  return [new ExampleChecksumExecutor()];
}
