import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExecutorRegistry, type JobExecutionContext, type JobExecutor } from './executors/index.js';
import type { DownloadUrlResult, JobFailureReport, NodeApi, NodeJobAssignment, NodeSpan } from './node-api.js';
import { NodeEngine, type EngineScheduler } from './node-engine.js';
import { ProviderRateLimitError } from './node-errors.js';

// =============================================================================
// Input modes: `input: 'url'` hands over the presigned URL and downloads
// nothing (RETRO-G2.3, #1073); rate-limit forwarding parity.
// =============================================================================

const SECRET_URL = 'https://storage.example/object?X-Amz-Signature=very-secret';
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1));

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'appctl-input-url-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const scheduler: EngineScheduler = { setInterval: () => 1, clearInterval: () => undefined } as unknown as EngineScheduler;

function assignment(id: string, type: string): NodeJobAssignment {
  return {
    job: {
      id,
      type,
      subjectType: null,
      subjectId: null,
      priority: 0,
      attempts: 1,
      startedAt: '2026-01-01T00:00:00.000Z',
      leaseExpiresAt: '2026-01-01T00:05:00.000Z',
    },
    params: {},
  };
}

interface Harness {
  failures: JobFailureReport[];
  results: unknown[];
  spans: NodeSpan[];
}

function build(
  executor: JobExecutor,
  jobId: string,
  downloadUrl: NodeApi['downloadUrl'],
  extra: { now?: () => number; fetch?: typeof globalThis.fetch } = {},
): { engine: NodeEngine; h: Harness } {
  const h: Harness = { failures: [], results: [], spans: [] };
  const queue: NodeJobAssignment[][] = [[assignment(jobId, executor.type)]];
  const api = {
    claim: async () => queue.shift() ?? [],
    submitResult: async (_n: string, id: string, _t: string, result: unknown) => {
      h.results.push(result);
      return { jobId: id, outcome: 'succeeded', willRetry: false };
    },
    reportJobFailure: async (_n: string, id: string, body: JobFailureReport) => {
      h.failures.push(body);
      return { jobId: id, outcome: 'failed', willRetry: true };
    },
    heartbeat: async () => ({}),
    renewLease: async (_n: string, id: string) => ({ jobId: id, leaseExpiresAt: '2026-01-01T00:10:00.000Z' }),
    deregister: async () => undefined,
    telemetry: async (_n: string, body: { spans: NodeSpan[] }) => {
      h.spans.push(...body.spans);
      return { accepted: body.spans.length, dropped: 0 };
    },
    downloadUrl,
  } as unknown as NodeApi;
  const engine = new NodeEngine({
    api,
    nodeId: 'node-1',
    concurrency: 1,
    executors: new ExecutorRegistry().register(executor),
    scheduler,
    tmpDir: join(tmp, 'work'),
    sleep: tick,
    pollIntervalMs: 1,
    ...(extra.now !== undefined ? { now: extra.now } : {}),
    fetch: extra.fetch ?? ((async () => {
      throw new Error('fetch must not be called');
    }) as typeof globalThis.fetch),
  });
  return { engine, h };
}

function signed(overrides: Partial<DownloadUrlResult> = {}): DownloadUrlResult {
  return {
    url: SECRET_URL,
    expiresIn: 600,
    expiresAt: '2026-01-01T00:10:00.000Z',
    objectId: 'obj-1',
    size: '123456789',
    mimeType: 'video/mp4',
    ...overrides,
  };
}

function urlExecutor(seen: JobExecutionContext[], onRun?: (c: JobExecutionContext) => Promise<unknown>): JobExecutor {
  return {
    type: 'test.url',
    input: 'url',
    execute: async (context) => {
      seen.push(context);
      return onRun ? onRun(context) : { ok: true };
    },
  };
}

async function runOnce(engine: NodeEngine, done: () => boolean): Promise<void> {
  const run = engine.run();
  await vi.waitFor(() => expect(done()).toBe(true));
  await engine.drain();
  await run;
}

describe("input: 'url'", () => {
  it('hands over the URL and metadata, downloads nothing and writes no file', async () => {
    const seen: JobExecutionContext[] = [];
    const { engine, h } = build(urlExecutor(seen), 'j1', async () => signed());
    await runOnce(engine, () => h.results.length === 1 && h.spans.length >= 3);

    expect(seen[0]?.inputUrl).toBe(SECRET_URL);
    expect(seen[0]?.inputPath).toBeUndefined();
    expect(seen[0]?.input).toEqual({ objectId: 'obj-1', size: '123456789', mimeType: 'video/mp4' });
    // The work directory is never even created.
    expect(readdirSync(tmp)).toEqual([]);

    const download = h.spans.find((s) => s.name === 'job.download');
    expect(download?.attributes).toEqual({ inputMode: 'url' });
    // The URL is a bearer capability: not in any span.
    expect(JSON.stringify(h.spans)).not.toContain('very-secret');
  });

  it('fails with the named MissingJobInputError when the server gives no URL', async () => {
    const seen: JobExecutionContext[] = [];
    const { engine, h } = build(urlExecutor(seen), 'j2', async () => signed({ url: '' }));
    await runOnce(engine, () => h.failures.length === 1);

    expect(seen).toHaveLength(0);
    expect(h.failures[0]?.error).toContain('j2');
    expect(h.failures[0]?.error).toContain('test.url');
    expect(h.failures[0]?.error).toContain('requires an input object');
  });

  it('refreshInputUrl reuses a URL with time left and re-requests near expiry, single-flight', async () => {
    let clock = Date.parse('2026-01-01T00:00:00.000Z');
    let calls = 0;
    const urls = [SECRET_URL, `${SECRET_URL}-2`];
    const downloadUrl = vi.fn(async () => {
      const url = urls[Math.min(calls, urls.length - 1)] as string;
      calls += 1;
      return signed({ url });
    });
    const outcomes: string[] = [];
    const seen: JobExecutionContext[] = [];
    const executor = urlExecutor(seen, async (context) => {
      outcomes.push(await context.refreshInputUrl()); // 10 min left: reused
      clock = Date.parse('2026-01-01T00:09:30.000Z'); // 30 s left: refresh
      const [a, b] = await Promise.all([context.refreshInputUrl(), context.refreshInputUrl()]);
      outcomes.push(a, b);
      return { ok: true };
    });
    const { engine, h } = build(executor, 'j3', downloadUrl, { now: () => clock });
    await runOnce(engine, () => h.results.length === 1);

    expect(outcomes).toEqual([SECRET_URL, `${SECRET_URL}-2`, `${SECRET_URL}-2`]);
    expect(downloadUrl).toHaveBeenCalledTimes(2); // first + exactly one refresh
  });

  it('leaves legacy requiresInput executors on the download path, with no inputUrl', async () => {
    const seen: JobExecutionContext[] = [];
    const executor: JobExecutor = {
      type: 'test.legacy',
      requiresInput: true,
      execute: async (context) => {
        seen.push(context);
        await expect(context.refreshInputUrl()).rejects.toThrow(/no input URL/);
        return { ok: true };
      },
    };
    const { engine, h } = build(executor, 'j4', async () => signed({ size: '5' }), {
      fetch: (async () => new Response('hello', { status: 200 })) as typeof globalThis.fetch,
    });
    await runOnce(engine, () => h.results.length === 1);

    expect(seen[0]?.inputUrl).toBeUndefined();
    expect(seen[0]?.inputPath).toBeDefined();
    expect(h.spans.find((s) => s.name === 'job.download')?.attributes).toEqual({ bytes: 5, inputMode: 'download' });
  });
});

describe('rate-limit forwarding parity', () => {
  async function throttled(error: unknown): Promise<{ failure: JobFailureReport; rateLimited: number }> {
    const executor: JobExecutor = {
      type: 'test.limited',
      input: 'none',
      execute: async () => {
        throw error;
      },
    };
    const { engine, h } = build(executor, 'rl', async () => signed());
    await runOnce(engine, () => h.failures.length === 1);
    return { failure: h.failures[0] as JobFailureReport, rateLimited: engine.getSnapshot().counters.rateLimited };
  }

  it('forwards a 429 with its retry-after as a deferral', async () => {
    const { failure, rateLimited } = await throttled(
      new ProviderRateLimitError('HTTP 429', { retryAfterMs: 12_000, provider: 'example' }),
    );
    expect(failure).toMatchObject({ rateLimited: true, retryAfterMs: 12_000 });
    expect(rateLimited).toBe(1);
  });

  it('forwards a 529 (overloaded) with no retry-after hint as a deferral with a zero floor', async () => {
    const { failure } = await throttled(new ProviderRateLimitError('HTTP 529', { retryAfterMs: 0 }));
    expect(failure).toMatchObject({ rateLimited: true, retryAfterMs: 0 });
  });

  it('does not defer a plain error that merely mentions a rate limit', async () => {
    const { failure, rateLimited } = await throttled(new Error('HTTP 429 rate limited'));
    expect(failure.rateLimited).toBeUndefined();
    expect(rateLimited).toBe(0);
  });
});
