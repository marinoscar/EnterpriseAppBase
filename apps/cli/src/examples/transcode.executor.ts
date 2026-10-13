import { execFile } from 'node:child_process';

import {
  binaryCapability,
  registerJobRequirement,
  registerProbedBinary,
  type JobExecutionContext,
  type JobExecutor,
} from '@marinoscar/platform-cli/node';

// =============================================================================
// EXAMPLE, NOT WIRED: a node executor that needs ffmpeg  (PP-14.19, #937)
// =============================================================================
//
// What an app executor with a REAL dependency declares, beyond `echo.executor.ts`:
//
//   1. THE DEPENDENCY. `declareTranscodeRequirements()` calls
//      `registerProbedBinary('ffmpeg', { versionArgs: ['-version'] })` and
//      `registerJobRequirement('example.transcode', { required: [binary:ffmpeg] })`.
//      The node's startup self-test then refuses to claim the type on a machine
//      without ffmpeg (instead of failing every job and charging each an
//      attempt), `node doctor` lists the tool and its version, and the version
//      banner rides the node's reported capabilities onto the fleet page.
//
//   2. ITS OWN SPAN. The transcode runs inside `context.phase('job.app.transcode', ...)`:
//      the node relays it, the server re-emits it under the job's trace, and
//      the attributes ride along as `job.app.frames` and `job.app.codec` once
//      the API registers them (`registerNodeSpanAttribute`, see
//      apps/api/src/platform-extensions/nodes/). The name must be
//      `job.app.<name>`; any other name is dropped on this side.
//
//   3. AN APP VITAL. `vitals()` reports `transcode.active` and `transcode.frames`
//      on every heartbeat as `vitals.extra`; the fleet page labels them when the
//      web app calls `registerNodeVital` for those keys. They are plain numbers:
//      no strings, at most 16 keys fleet-wide.
//
// CLAUDE.md queue rule 3 holds as for every executor: this one needs no
// job-scoped credential, and `transcode.executor.test.ts` still runs
// `checkExecutorCredentialHygiene` over it.
//
// The ffmpeg call is injectable (`TranscodeRunner`) so the tests, and a CI box
// without ffmpeg, never spawn it. The default runner is the real thing: an
// argument ARRAY (never a shell), a bounded run, the abort signal honoured.
//
// Not in `app.ts`, so the worker claims exactly the platform's types. To use it:
//
//   declareTranscodeRequirements();
//   nodeExecutors: [new TranscodeExecutor()],
// =============================================================================

/** What the transcode reports back. */
export interface TranscodeOutcome {
  /** Frames written. */
  frames: number;
  /** The output codec's name (token-shaped). */
  codec: string;
}

/** Runs ffmpeg over `inputPath` (injectable). */
export type TranscodeRunner = (inputPath: string, params: Record<string, unknown>, signal: AbortSignal) => Promise<TranscodeOutcome>;

/** What `example.transcode` returns. */
export interface TranscodeResult extends TranscodeOutcome {
  computedBy: 'node';
}

/** A codec name an app accepts: letters, digits and `_ . + -`, short. */
const CODEC_PATTERN = /^[A-Za-z0-9_.+-]{1,32}$/;

/**
 * Declares what `example.transcode` needs from the machine. Call it once, at
 * module scope, before the node starts.
 */
export function declareTranscodeRequirements(): void {
  registerProbedBinary('ffmpeg', { versionArgs: ['-version'] });
  registerJobRequirement('example.transcode', {
    required: [binaryCapability('ffmpeg')],
    // exiftool would only add metadata: its absence reduces function, never the work.
    degradable: [binaryCapability('exiftool')],
  });
}

/** The default runner: `ffmpeg -i <input> -f null -`, counting the frames it reports. */
export const runFfmpeg: TranscodeRunner = (inputPath, params, signal) =>
  new Promise<TranscodeOutcome>((resolve, reject) => {
    const codec = typeof params['codec'] === 'string' && CODEC_PATTERN.test(params['codec']) ? params['codec'] : 'libx264';
    execFile(
      'ffmpeg',
      ['-v', 'error', '-nostats', '-progress', 'pipe:1', '-i', inputPath, '-c:v', codec, '-f', 'null', '-'],
      { signal, timeout: 10 * 60_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(error);
        const frames = [...stdout.matchAll(/^frame=(\d+)$/gm)].map((match) => Number(match[1])).pop() ?? 0;
        resolve({ frames, codec });
      },
    );
  });

/** Transcodes the job's input with ffmpeg. */
export class TranscodeExecutor implements JobExecutor {
  readonly type = 'example.transcode';
  readonly requiresInput = true;

  private active = 0;
  private frames = 0;

  constructor(private readonly run: TranscodeRunner = runFfmpeg) {}

  /** Read on every heartbeat: cheap, synchronous, plain numbers. */
  vitals(): Record<string, number> {
    return { 'transcode.active': this.active, 'transcode.frames': this.frames };
  }

  async execute(context: JobExecutionContext): Promise<TranscodeResult> {
    if (context.inputPath === undefined) throw new Error(`Job ${context.job.id} has no input to transcode`);
    const inputPath = context.inputPath;

    this.active += 1;
    try {
      // `phase` is optional on the context (a hand-built test context has none): fall through.
      const outcome = context.phase
        ? await context.phase('job.app.transcode', () => this.run(inputPath, context.params, context.signal), (done) => ({
            frames: done.frames,
            codec: done.codec,
          }))
        : await this.run(inputPath, context.params, context.signal);

      this.frames += outcome.frames;
      context.log('transcoded', { jobId: context.job.id, frames: outcome.frames });

      return { ...outcome, computedBy: 'node' };
    } finally {
      this.active -= 1;
    }
  }
}
