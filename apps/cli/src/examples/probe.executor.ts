import { execFile } from 'node:child_process';

import {
  binaryCapability,
  registerJobRequirement,
  registerProbedBinary,
  type JobExecutionContext,
  type JobExecutor,
} from '@marinoscar/platform-cli/node';

// =============================================================================
// EXAMPLE, NOT WIRED: a node executor that reads its input by URL  (G2.3, #1073)
// =============================================================================
//
// `input: 'url'` is for a tool that range-seeks the object: ffprobe (like
// ffmpeg) asks for the container header and the bytes around each seek point,
// so probing a multi-GB video costs a few MB instead of a full download. The
// engine hands this executor `context.inputUrl` and downloads NOTHING, so no
// temp file exists for it to clean up.
//
//   - THE URL IS A BEARER CAPABILITY. It goes to ffprobe's argument list and
//     nowhere else: never logged, never in a span, never in the result or an
//     error message. `checkExecutorCredentialHygiene` fails an executor that
//     leaks it (see `probe.executor.test.ts`).
//   - THE URL EXPIRES. `context.refreshInputUrl()` returns the held URL while
//     it has more than 60 s left and asks the server again otherwise, so a
//     long job calls it before each tool invocation instead of holding one.
//   - NOT EVERY CONTAINER SEEKS. A non-faststart MP4 keeps its index at the
//     end of the file, and a store that ignores Range cannot serve a seek. The
//     robust pattern is a fallback: try the URL, and on failure fetch the
//     object yourself (`context.api.downloadUrl` + a streamed write) and probe
//     the file. This example only probes, so it reports the failure instead.
//
// Not in `app.ts`, so the worker claims exactly the platform's types. To use it:
//
//   declareProbeRequirements();
//   nodeExecutors: [new ProbeExecutor()],
// =============================================================================

/** What `example.probe` returns. */
export interface ProbeResult {
  /** Container format names, as ffprobe reports them (token-shaped). */
  format: string;
  /** Duration in whole milliseconds. */
  durationMs: number;
  computedBy: 'node';
}

/** Runs ffprobe over `url` (injectable). */
export type ProbeRunner = (url: string, signal: AbortSignal) => Promise<Omit<ProbeResult, 'computedBy'>>;

/** Declares that `example.probe` needs ffprobe on the machine. */
export function declareProbeRequirements(): void {
  registerProbedBinary('ffprobe', { versionArgs: ['-version'] });
  registerJobRequirement('example.probe', { required: [binaryCapability('ffprobe')] });
}

/** The default runner: `ffprobe -show_format` over the URL, a bounded run. */
export const runFfprobe: ProbeRunner = (url, signal) =>
  new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_format', url],
      { signal, timeout: 2 * 60_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          // execFile's message includes the command line, which holds the URL.
          return reject(new Error('ffprobe could not read the input (is the container seekable?)'));
        }
        const format = (JSON.parse(stdout) as { format?: { format_name?: string; duration?: string } }).format ?? {};
        resolve({
          format: /^[A-Za-z0-9_.+,-]{1,64}$/.test(format.format_name ?? '') ? (format.format_name as string) : 'unknown',
          durationMs: Math.round(Number(format.duration ?? 0) * 1000) || 0,
        });
      },
    );
  });

/** Probes the job's input object by URL, downloading none of it. */
export class ProbeExecutor implements JobExecutor {
  readonly type = 'example.probe';
  readonly input = 'url' as const;

  constructor(private readonly run: ProbeRunner = runFfprobe) {}

  async execute(context: JobExecutionContext): Promise<ProbeResult> {
    if (context.inputUrl === undefined) throw new Error(`Job ${context.job.id} has no input URL to probe`);
    // Fresh for this invocation: reuses the held URL unless it is about to expire.
    const url = await context.refreshInputUrl();
    const probed = await this.run(url, context.signal);
    context.log('probed', { jobId: context.job.id, format: probed.format });
    return { ...probed, computedBy: 'node' };
  }
}
