import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import { NodeLogger } from '../logger.js';
import type { JobSecret, NodeApi, UploadUrlResult } from '../node-api.js';
import { workerEnv } from '../worker-env.js';

import type { JobExecutionContext, JobExecutor } from './index.js';

// =============================================================================
// "A node never persists a job-scoped credential", as a reusable check  (#715)
// =============================================================================
//
// CLAUDE.md queue rule 3: a per-job secret is issued through the broker, held
// in node memory for the job, and never written or logged. `db-backup-run`'s
// tests prove it for `db.backup.run`; this is the same proof packaged so an
// app runs it over ITS executors (`/testing`, and the `cli` conformance
// suite's executor case).
//
// It runs the executor ONCE against a fake job whose broker hands out a
// credential carrying a unique marker, with the node's state directory and
// HOME pointed at fresh directories, its log going through the real
// `NodeLogger`, and `fetch` answered locally (an upload is drained, never
// sent). Then it looks for the marker everywhere it must not be: the log
// file, every file under the state directory and HOME, the returned result
// and the error message. The executor may fail (a `pg_dump` that cannot
// reach the fake host is expected to); what it may not do is leave the
// credential behind.
// =============================================================================

/**
 * Options of {@link checkExecutorCredentialHygiene}.
 *
 * @stability experimental
 */
export interface CredentialHygieneOptions {
  /** The job's `params`. Defaults to `{}`. */
  params?: Record<string, unknown> | undefined;
  /**
   * The credential the fake broker issues, before the marker is added to it
   * (as `password` and `token`). Defaults to a Postgres-shaped one aimed at
   * an unreachable local port, so a database client fails fast.
   */
  material?: Record<string, unknown> | undefined;
  /** The broker's `kind`. Defaults to `postgres.readonly`. */
  kind?: string | undefined;
  /** Answers the executor's `fetch`. Defaults to draining the body and answering 200. */
  fetchImpl?: typeof globalThis.fetch | undefined;
  /** How long the executor may run. Defaults to 15 seconds. */
  timeoutMs?: number | undefined;
}

/**
 * What {@link checkExecutorCredentialHygiene} found.
 *
 * @stability experimental
 */
export interface CredentialHygieneReport {
  /** The executor's job type. */
  type: string;
  /** The marker the credential carried (never a real secret). */
  marker: string;
  /** Whether the executor asked the broker for the credential. */
  secretRequested: boolean;
  /** `ok` when `execute` returned, `failed` when it threw or timed out. */
  outcome: 'ok' | 'failed';
  /** The error message, when it failed. */
  error?: string | undefined;
  /** Where the credential was found. Empty is a pass. */
  findings: string[];
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { recursive: true }) as string[]) {
    const path = join(dir, entry);
    try {
      if (statSync(path).isFile()) out.push(path);
    } catch {
      // Removed while scanning; nothing left to leak.
    }
  }
  return out;
}

async function drainingFetch(_url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const body = (init as { body?: unknown } | undefined)?.body;
  if (body !== undefined && body !== null && typeof (body as Readable)[Symbol.asyncIterator] === 'function') {
    for await (const chunk of body as Readable) void chunk;
  }
  return new Response(null, { status: 200 });
}

/**
 * Runs an executor once against a fake job holding a job-scoped credential
 * and reports every place the credential ended up that it must never reach:
 * the node log, the state directory, HOME, the result or the error.
 *
 * Needs the CLI identity (the state directory's variable is prefixed with
 * it), so build the CLI with `createCli` first. Not safe to run concurrently
 * with other tests in the same process: it swaps `process.env.HOME`, the
 * state-directory variable and `globalThis.fetch` while the executor runs.
 *
 * @param executor - The executor under test.
 * @param options - The job's params, the credential's shape, the fetch answer.
 * @returns The report; `findings` is empty when the executor is clean.
 * @stability experimental
 * @example
 * ```ts
 * const report = await checkExecutorCredentialHygiene(new EchoExecutor());
 * expect(report.findings).toEqual([]);
 * ```
 */
export async function checkExecutorCredentialHygiene(
  executor: JobExecutor,
  options: CredentialHygieneOptions = {},
): Promise<CredentialHygieneReport> {
  const marker = `conformance-credential-${randomUUID()}`;
  const signature = `X-Amz-Signature=conformance-${randomUUID()}`;
  const root = mkdtempSync(join(tmpdir(), 'platform-cli-credential-'));
  const stateDir = join(root, 'state');
  const home = join(root, 'home');
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(home, { recursive: true });
  const logPath = join(stateDir, 'node.log');
  const logger = new NodeLogger({ path: logPath });

  let secretRequested = false;
  const secret = (): JobSecret => {
    secretRequested = true;
    return {
      kind: options.kind ?? 'postgres.readonly',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      material: {
        driver: 'postgresql',
        host: '127.0.0.1',
        port: 9,
        database: 'conformance',
        user: 'conformance_reader',
        sslMode: 'disable',
        ...options.material,
        password: marker,
        token: marker,
      },
    };
  };
  const upload: UploadUrlResult = {
    url: `https://bucket.invalid/conformance/object?${signature}`,
    key: 'conformance/object',
    expiresIn: 60,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  // Every other API call is refused: the check is about the credential, and
  // an executor that needs more of the API fails here rather than calling out.
  const api = new Proxy({} as NodeApi, {
    get: (_target, property) => {
      if (property === 'jobSecret') return async () => secret();
      if (property === 'uploadUrl') return async () => upload;
      if (property === 'then') return undefined;
      return async () => {
        throw new Error(`NodeApi.${String(property)} is not available in the credential hygiene check`);
      };
    },
  });

  let inputPath: string | undefined;
  if (executor.requiresInput) {
    inputPath = join(root, 'input.bin');
    writeFileSync(inputPath, 'conformance input\n');
  }

  const controller = new AbortController();
  const context: JobExecutionContext = {
    job: {
      id: `conformance-${randomUUID()}`,
      type: executor.type,
      subjectType: null,
      subjectId: null,
      priority: 0,
      attempts: 1,
      startedAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    params: options.params ?? {},
    inputPath,
    input: inputPath === undefined ? undefined : { objectId: 'conformance-input', size: '18', mimeType: 'application/octet-stream' },
    api,
    nodeId: 'conformance-node',
    claimToken: randomUUID(),
    signal: controller.signal,
    log: (message, fields) => logger.info(message, fields),
  };

  const stateKey = workerEnv().stateDir;
  const saved = { state: process.env[stateKey], home: process.env.HOME, fetch: globalThis.fetch };
  process.env[stateKey] = stateDir;
  process.env.HOME = home;
  globalThis.fetch = options.fetchImpl ?? (drainingFetch as typeof globalThis.fetch);

  let outcome: CredentialHygieneReport['outcome'] = 'ok';
  let error: string | undefined;
  let result: unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`timed out after ${options.timeoutMs ?? 15_000} ms`));
      }, options.timeoutMs ?? 15_000);
    });
    result = await Promise.race([executor.execute(context), timeout]);
  } catch (caught) {
    outcome = 'failed';
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (saved.state === undefined) delete process.env[stateKey];
    else process.env[stateKey] = saved.state;
    if (saved.home === undefined) delete process.env.HOME;
    else process.env.HOME = saved.home;
    globalThis.fetch = saved.fetch;
  }

  const findings: string[] = [];
  try {
    for (const dir of [stateDir, home]) {
      for (const file of filesUnder(dir)) {
        const text = readFileSync(file, 'utf8');
        const where = file === logPath ? 'the node log' : `${file.startsWith(home) ? 'HOME' : 'the state directory'}: ${file.slice(root.length + 1)}`;
        if (text.includes(marker)) findings.push(`the credential was written to ${where}`);
        if (text.includes(signature)) findings.push(`the signed upload URL was written to ${where}`);
      }
    }
    let serialised = '';
    try {
      serialised = JSON.stringify(result) ?? '';
    } catch {
      serialised = String(result);
    }
    if (serialised.includes(marker)) findings.push('the credential is in the result the node reports to the server');
    if (error?.includes(marker) === true) findings.push('the credential is in the error message the node reports and logs');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  return { type: executor.type, marker, secretRequested, outcome, ...(error === undefined ? {} : { error }), findings };
}
