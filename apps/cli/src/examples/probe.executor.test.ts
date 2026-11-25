import { createCli } from '@marinoscar/platform-cli';
import { defaultExecutorRegistry, resolveInputMode, type JobExecutionContext } from '@marinoscar/platform-cli/node';
import { checkExecutorCredentialHygiene, resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';

import { ProbeExecutor, type ProbeRunner } from './probe.executor.js';

// The G2.3 example: an executor that reads its input by URL. Nothing here
// spawns ffprobe.

beforeEach(() => resetCliForTests());
afterEach(() => resetCliForTests());

const URL_IN = 'https://storage.example/o?X-Amz-Signature=secret';
const fakeRunner: ProbeRunner = async () => ({ format: 'mov,mp4', durationMs: 61_000 });

function context(overrides: Partial<JobExecutionContext> = {}): JobExecutionContext {
  return {
    job: { id: 'job-1', type: 'example.probe', subjectType: null, subjectId: null, priority: 0, attempts: 1, startedAt: '', leaseExpiresAt: '' },
    params: {},
    inputPath: undefined,
    inputUrl: URL_IN,
    refreshInputUrl: async () => URL_IN,
    input: undefined,
    api: {} as never,
    nodeId: 'node-1',
    claimToken: undefined,
    signal: new AbortController().signal,
    log: () => undefined,
    ...overrides,
  };
}

describe('ProbeExecutor', () => {
  it("declares input: 'url' and is advertised once passed in nodeExecutors", () => {
    expect(resolveInputMode(new ProbeExecutor(fakeRunner))).toBe('url');
    createCli({ ...APP_CLI_OPTIONS, nodeExecutors: [new ProbeExecutor(fakeRunner)] });
    expect(defaultExecutorRegistry().types()).toContain('example.probe');
  });

  it('probes the refreshed URL and returns the outcome', async () => {
    const seen: string[] = [];
    const executor = new ProbeExecutor(async (url) => {
      seen.push(url);
      return { format: 'mov,mp4', durationMs: 61_000 };
    });

    const result = await executor.execute(context({ refreshInputUrl: async () => `${URL_IN}-fresh` }));

    expect(seen).toEqual([`${URL_IN}-fresh`]);
    expect(result).toEqual({ format: 'mov,mp4', durationMs: 61_000, computedBy: 'node' });
  });

  it('fails a job with no input URL, naming the job', async () => {
    await expect(new ProbeExecutor(fakeRunner).execute(context({ inputUrl: undefined }))).rejects.toThrow(/job-1/);
  });

  it('never leaks the signed input URL (credential hygiene)', async () => {
    createCli(APP_CLI_OPTIONS);
    const report = await checkExecutorCredentialHygiene(new ProbeExecutor(fakeRunner));
    expect(report.outcome).toBe('ok');
    expect(report.findings).toEqual([]);
  });

  it('is flagged by the hygiene check when an executor logs inputUrl', async () => {
    createCli(APP_CLI_OPTIONS);
    const leaky = new ProbeExecutor(async (url) => {
      throw new Error(`failed on ${url}`);
    });
    const report = await checkExecutorCredentialHygiene(leaky);
    expect(report.findings.join(' ')).toMatch(/signed input URL/);
  });
});
