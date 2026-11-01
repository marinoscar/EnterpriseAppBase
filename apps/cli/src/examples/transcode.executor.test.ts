import { createCli } from '@marinoscar/platform-cli';
import { defaultExecutorRegistry, sanitizeExtraVitals, type JobExecutionContext } from '@marinoscar/platform-cli/node';
import { checkExecutorCredentialHygiene, resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';

import { TranscodeExecutor, type TranscodeRunner } from './transcode.executor.js';

// The PP-14.19 example: an executor that declares ffmpeg, emits a job.app.*
// span and reports an app vital. Nothing here spawns ffmpeg.

beforeEach(() => resetCliForTests());
afterEach(() => resetCliForTests());

const fakeRunner: TranscodeRunner = async () => ({ frames: 240, codec: 'h264' });

function context(overrides: Partial<JobExecutionContext> = {}): { context: JobExecutionContext; spans: Array<{ name: string; attributes: unknown }> } {
  const spans: Array<{ name: string; attributes: unknown }> = [];
  const base: JobExecutionContext = {
    job: { id: 'job-1', type: 'example.transcode', subjectType: null, subjectId: null, priority: 0, attempts: 1, startedAt: '', leaseExpiresAt: '' },
    params: {},
    inputPath: '/tmp/in.mp4',
    input: undefined,
    api: {} as never,
    nodeId: 'node-1',
    claimToken: undefined,
    signal: new AbortController().signal,
    log: () => undefined,
    async phase(name, work, attributes) {
      const result = await work();
      spans.push({ name, attributes: typeof attributes === 'function' ? attributes(result) : attributes });
      return result;
    },
    ...overrides,
  };

  return { context: base, spans };
}

describe('TranscodeExecutor', () => {
  it('is not run by the shipped worker, and is advertised once passed in nodeExecutors', () => {
    createCli(APP_CLI_OPTIONS);
    expect(defaultExecutorRegistry().types()).toEqual(['db.backup.run', 'example.checksum']);

    resetCliForTests();
    createCli({ ...APP_CLI_OPTIONS, nodeExecutors: [new TranscodeExecutor(fakeRunner)] });
    expect(defaultExecutorRegistry().types()).toEqual(['db.backup.run', 'example.checksum', 'example.transcode']);
  });

  it('emits its own job.app.transcode span carrying frames and codec, and returns the outcome', async () => {
    const { context: ctx, spans } = context();

    const result = await new TranscodeExecutor(fakeRunner).execute(ctx);

    expect(result).toEqual({ frames: 240, codec: 'h264', computedBy: 'node' });
    expect(spans).toEqual([{ name: 'job.app.transcode', attributes: { frames: 240, codec: 'h264' } }]);
  });

  it('works on a context without a phase recorder', async () => {
    const { context: ctx } = context();
    delete (ctx as { phase?: unknown }).phase;

    await expect(new TranscodeExecutor(fakeRunner).execute(ctx)).resolves.toMatchObject({ frames: 240 });
  });

  it('fails a job with no input, naming the job', async () => {
    const { context: ctx } = context({ inputPath: undefined });

    await expect(new TranscodeExecutor(fakeRunner).execute(ctx)).rejects.toThrow(/job-1/);
  });

  it('reports app vitals the node can send: active while running, frames after, within the server bounds', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const executor = new TranscodeExecutor(async () => {
      await gate;
      return { frames: 100, codec: 'h264' };
    });
    expect(executor.vitals()).toEqual({ 'transcode.active': 0, 'transcode.frames': 0 });

    const running = executor.execute(context().context);
    expect(executor.vitals()).toEqual({ 'transcode.active': 1, 'transcode.frames': 0 });

    release();
    await running;
    expect(executor.vitals()).toEqual({ 'transcode.active': 0, 'transcode.frames': 100 });
    // What the heartbeat sends: the sanitizer keeps both, so the server's schema accepts them.
    expect(sanitizeExtraVitals(executor.vitals())).toEqual(executor.vitals());
  });

  it('counts a failed run as no longer active', async () => {
    const executor = new TranscodeExecutor(async () => {
      throw new Error('ffmpeg exited 1');
    });

    await expect(executor.execute(context().context)).rejects.toThrow(/ffmpeg exited 1/);
    expect(executor.vitals()['transcode.active']).toBe(0);
  });

  it('never persists or logs a job-scoped credential (CLAUDE.md queue rule 3)', async () => {
    createCli(APP_CLI_OPTIONS);
    const report = await checkExecutorCredentialHygiene(new TranscodeExecutor(fakeRunner));

    expect(report.outcome).toBe('ok');
    expect(report.findings).toEqual([]);
  });
});
