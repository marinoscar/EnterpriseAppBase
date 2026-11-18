import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { onCapabilityRegistryReset, registerCapabilityProbe, unregisterCapabilityProbeForTests } from './capabilities.js';
import { registerInstallStep, removeInstallStepForTests, type InstallContext, type InstallStep } from './install-deps.js';
import { nodeStateDir } from './paths.js';
import { workerEnv } from './worker-env.js';

// =============================================================================
// Model artifacts  (RETRO-G2.4, #1074)
// =============================================================================
//
// A worker that runs a model (OCR data, an embedding network) needs a large
// file on disk that the container image may or may not already carry. The app
// DECLARES each file here (name, size, sha256, where to fetch it) and the
// platform does the rest: `node models pull` downloads with resume and a
// sha256 check, startup verifies what is on disk, and a job type whose model is
// missing or corrupt is NOT ADVERTISED, so the node never claims work it
// cannot do.
//
// DECLARED BY THE APP, NOT DICTATED BY THE SERVER. There is deliberately no
// server manifest route: the platform's node API stays free of any model
// vocabulary, and fleet agreement on versions comes from the app release (the
// sha256 in the registration), not from a round trip that a deployment could
// get out of step with its workers.
//
// A model URL is not a credential, but a signed URL can be: the logs show only
// its origin and path, never a query string or userinfo.
// =============================================================================

/**
 * A model file an app declares.
 *
 * @stability experimental
 */
export interface ModelArtifact {
  /** Unique id, `[a-z][a-z0-9._-]*`. */
  id: string;
  /** File name under the models directory (and `targetSubdir`). No path separators. */
  fileName: string;
  /** Lowercase hex sha256 of the file. */
  sha256: string;
  /** Exact size in bytes. Checked before the (slower) hash. */
  bytes: number;
  /** Static download URL. One of `url` / `resolveUrl` is required. */
  url?: string | undefined;
  /** Computes the URL at pull time (a versioned or signed one). Never logged beyond its origin and path. */
  resolveUrl?: ((context: { artifact: ModelArtifact }) => string | Promise<string>) | undefined;
  /** Job types that cannot run without this file. They are not advertised while it is missing or corrupt. */
  requiredBy: string[];
  /** A relative subdirectory under the models directory (`tesseract`). No `..`. */
  targetSubdir?: string | undefined;
}

/**
 * The state of one model on disk.
 *
 * @stability experimental
 */
export type ModelStatus = 'ok' | 'missing' | 'corrupt';

/**
 * The verdict for one model.
 *
 * @stability experimental
 */
export interface ModelVerification {
  /** The model's id. */
  id: string;
  /** `ok`, `missing` or `corrupt`. */
  status: ModelStatus;
  /** Where the file is (or would be). */
  path: string;
  /** Why, when not `ok`. */
  detail?: string | undefined;
}

const MODEL_ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,199}$/;

const artifacts: ModelArtifact[] = [];
let stepRegistered = false;

/**
 * Declares a model file. Call it at module scope, before the node starts. It
 * also adds a `models` install step (once) that pulls every declared file, so
 * `node install-deps` fetches them, and a `model:<id>` capability that shows in
 * `node doctor` and the heartbeat summary.
 *
 * @param artifact - the file, its checksum, its source and the job types that need it.
 * @throws Error when a field is malformed, the id is taken, or neither `url` nor `resolveUrl` is given.
 *
 * @example
 * ```ts
 * registerModelArtifact({
 *   id: 'embedding',
 *   fileName: 'embedding-v1.onnx',
 *   sha256: '…64 hex characters…',
 *   bytes: 87_000_000,
 *   url: 'https://models.example.test/embedding-v1.onnx',
 *   requiredBy: ['app.embed'],
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerModelArtifact(artifact: ModelArtifact): void {
  const id = artifact?.id;
  if (typeof id !== 'string' || !MODEL_ID_PATTERN.test(id)) throw new Error(`registerModelArtifact: "${String(id)}" is not a valid model id (${MODEL_ID_PATTERN}).`);
  if (artifacts.some((existing) => existing.id === id)) throw new Error(`registerModelArtifact: "${id}" is already registered.`);
  if (typeof artifact.fileName !== 'string' || !FILE_NAME_PATTERN.test(artifact.fileName)) {
    throw new Error(`registerModelArtifact("${id}"): fileName must be a plain file name, without path separators.`);
  }
  if (typeof artifact.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(artifact.sha256)) {
    throw new Error(`registerModelArtifact("${id}"): sha256 must be 64 lowercase hex characters.`);
  }
  if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0) throw new Error(`registerModelArtifact("${id}"): bytes must be a positive integer.`);
  if ((artifact.url === undefined) === (artifact.resolveUrl === undefined)) {
    throw new Error(`registerModelArtifact("${id}"): give exactly one of url or resolveUrl.`);
  }
  if (artifact.url !== undefined && !/^https?:\/\//i.test(artifact.url)) throw new Error(`registerModelArtifact("${id}"): url must be http(s).`);
  if (!Array.isArray(artifact.requiredBy) || artifact.requiredBy.length === 0 || artifact.requiredBy.some((type) => typeof type !== 'string' || type.trim() === '')) {
    throw new Error(`registerModelArtifact("${id}"): requiredBy must name at least one job type.`);
  }
  if (artifact.targetSubdir !== undefined) {
    const sub = normalize(artifact.targetSubdir);
    if (artifact.targetSubdir === '' || isAbsolute(sub) || sub.split(/[\\/]/).includes('..')) {
      throw new Error(`registerModelArtifact("${id}"): targetSubdir must be a relative path without "..".`);
    }
  }

  artifacts.push({ ...artifact, requiredBy: [...artifact.requiredBy] });

  registerCapabilityProbe({
    key: `model:${id}`,
    label: `Model ${id}`,
    timeoutMs: 120_000,
    cacheMs: 300_000,
    probe: async ({ env }) => {
      const result = await verifyModel(artifact, resolveModelsDir(nodeStateDir({ env }), env));
      if (result.status === 'ok') return { status: 'available' };
      return { status: result.status === 'corrupt' ? 'installed' : 'missing', ...(result.detail !== undefined ? { detail: result.detail } : {}) };
    },
  });

  if (!stepRegistered) {
    stepRegistered = true;
    registerInstallStep(createModelsInstallStep());
  }
}

/**
 * The declared models, in registration order.
 *
 * @returns copies of the declarations.
 * @stability experimental
 */
export function listModelArtifacts(): ModelArtifact[] {
  return artifacts.map((artifact) => ({ ...artifact, requiredBy: [...artifact.requiredBy] }));
}

/**
 * The directory models live in: `<PREFIX>MODELS_DIR`, else `<stateDir>/models`.
 *
 * @param stateDir - the worker state directory.
 * @param env - the environment to read the override from.
 * @returns an absolute or state-relative directory.
 * @stability experimental
 */
export function resolveModelsDir(stateDir: string, env: NodeJS.ProcessEnv = process.env): string {
  return resolveModelsDirFromEnv(env) ?? join(stateDir, 'models');
}

function resolveModelsDirFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const value = env[workerEnv().modelsDir]?.trim();
  return value !== undefined && value !== '' ? value : undefined;
}

/**
 * Where a model's file is (or will be).
 *
 * @param artifact - the declaration.
 * @param modelsDir - the models directory.
 * @returns the full path.
 * @stability experimental
 */
export function modelArtifactPath(artifact: Pick<ModelArtifact, 'fileName' | 'targetSubdir'>, modelsDir: string): string {
  return join(modelsDir, artifact.targetSubdir ?? '', artifact.fileName);
}

const hashCache = new Map<string, { size: number; mtimeMs: number; sha256: string }>();

/** Streams a file through sha256. Cached per path while its size and mtime are unchanged. */
async function sha256Of(path: string): Promise<string> {
  const stat = statSync(path);
  const cached = hashCache.get(path);
  if (cached !== undefined && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.sha256;
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  const digest = hash.digest('hex');
  hashCache.set(path, { size: stat.size, mtimeMs: stat.mtimeMs, sha256: digest });
  return digest;
}

/**
 * Checks one model on disk: present, the declared size, the declared sha256.
 * Never throws.
 *
 * @param artifact - the declaration.
 * @param modelsDir - the models directory.
 * @returns `ok`, `missing` (no file) or `corrupt` (wrong size or hash).
 * @stability experimental
 */
export async function verifyModel(artifact: ModelArtifact, modelsDir: string): Promise<ModelVerification> {
  const path = modelArtifactPath(artifact, modelsDir);
  let size: number;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return { id: artifact.id, status: 'corrupt', path, detail: `${artifact.fileName} is not a file` };
    size = stat.size;
  } catch {
    return { id: artifact.id, status: 'missing', path, detail: `${artifact.fileName} is not in ${modelsDir}` };
  }
  if (size !== artifact.bytes) {
    return { id: artifact.id, status: 'corrupt', path, detail: `${artifact.fileName} is ${size} bytes, expected ${artifact.bytes}` };
  }
  try {
    const actual = await sha256Of(path);
    if (actual !== artifact.sha256) return { id: artifact.id, status: 'corrupt', path, detail: `${artifact.fileName} does not match its sha256` };
  } catch (error) {
    return { id: artifact.id, status: 'corrupt', path, detail: `${artifact.fileName} could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { id: artifact.id, status: 'ok', path };
}

/**
 * Verifies the declared models.
 *
 * @param modelsDir - the models directory.
 * @param declared - which models; defaults to every registered one.
 * @returns one verdict per model.
 * @stability experimental
 */
export async function verifyModels(modelsDir: string, declared: readonly ModelArtifact[] = artifacts): Promise<ModelVerification[]> {
  const results: ModelVerification[] = [];
  for (const artifact of declared) results.push(await verifyModel(artifact, modelsDir));
  return results;
}

/**
 * The job types that must not be advertised because a model they need is not
 * `ok`.
 *
 * @param verdicts - the result of {@link verifyModels}.
 * @param declared - the declarations the verdicts belong to; defaults to the registry.
 * @returns each withheld type with the model ids that block it.
 * @stability experimental
 */
export function withheldTypesFor(verdicts: readonly ModelVerification[], declared: readonly ModelArtifact[] = artifacts): Map<string, string[]> {
  const withheld = new Map<string, string[]>();
  for (const verdict of verdicts) {
    if (verdict.status === 'ok') continue;
    const artifact = declared.find((candidate) => candidate.id === verdict.id);
    for (const type of artifact?.requiredBy ?? []) withheld.set(type, [...(withheld.get(type) ?? []), verdict.id]);
  }
  return withheld;
}

/**
 * What {@link pullModels} did for one model.
 *
 * @stability experimental
 */
export interface ModelPullResult {
  /** The model's id. */
  id: string;
  /** `present`: already valid, nothing fetched. `downloaded`: fetched and verified. `failed`: see `detail`. */
  outcome: 'present' | 'downloaded' | 'failed';
  /** The file's size in bytes. */
  bytes?: number | undefined;
  /** How long the pull took, in milliseconds. */
  durationMs?: number | undefined;
  /** Whether a partial file was continued with a range request. */
  resumed?: boolean | undefined;
  /** Why a pull failed. */
  detail?: string | undefined;
}

/**
 * Options of {@link pullModels}.
 *
 * @stability experimental
 */
export interface PullModelsOptions {
  /** The directory models are stored in. */
  modelsDir: string;
  /** Pull only these ids. Unknown ids are an error. */
  ids?: readonly string[] | undefined;
  /** Download even a valid file. */
  force?: boolean | undefined;
  /** Declarations to pull; defaults to the registry. */
  declared?: readonly ModelArtifact[] | undefined;
  /** Attempts per model for network failures, resuming a partial file between them. Default 3. */
  attempts?: number | undefined;
  /** Receives one line per download and result. */
  log?: ((message: string) => void) | undefined;
  /** Test seam for the HTTP client. */
  fetch?: typeof fetch | undefined;
  /** Test seam for the wait between retries. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

/** Origin and path only: a signed URL's query string and any userinfo are never logged. */
function describeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '(unparsable url)';
  }
}

class PermanentPullError extends Error {}

/**
 * Downloads and verifies the declared models into the models directory.
 *
 * Each file streams to `<file>.partial` (constant memory), is checked against
 * its size and sha256, and is renamed into place atomically. A partial file
 * left by an interrupted pull is continued with a `Range` request; a server
 * that ignores the range restarts the file. A file that fails its sha256 is
 * deleted and not retried. A valid file already in place is left alone.
 * One model failing does not stop the others, and nothing throws.
 *
 * @param options - the directory, the selection and the test seams.
 * @returns one result per model.
 * @throws Error when `ids` names a model that is not registered.
 * @stability experimental
 */
export async function pullModels(options: PullModelsOptions): Promise<ModelPullResult[]> {
  const declared = options.declared ?? artifacts;
  if (options.ids !== undefined && options.ids.length > 0) {
    const unknown = options.ids.filter((id) => !declared.some((artifact) => artifact.id === id));
    if (unknown.length > 0) throw new Error(`Unknown model${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Known models: ${declared.map((a) => a.id).join(', ') || '(none)'}.`);
  }
  const selected = declared.filter((artifact) => options.ids === undefined || options.ids.length === 0 || options.ids.includes(artifact.id));
  const log = options.log ?? (() => {});
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = Math.max(1, options.attempts ?? 3);
  const results: ModelPullResult[] = [];

  for (const artifact of selected) {
    const started = Date.now();
    const dest = modelArtifactPath(artifact, options.modelsDir);
    const part = `${dest}.partial`;
    try {
      if (options.force !== true && (await verifyModel(artifact, options.modelsDir)).status === 'ok') {
        results.push({ id: artifact.id, outcome: 'present', bytes: artifact.bytes });
        continue;
      }
      mkdirSync(dirname(dest), { recursive: true });

      let resumed = false;
      let lastError: unknown;
      let done = false;
      for (let attempt = 1; attempt <= attempts && !done; attempt += 1) {
        try {
          const url = artifact.url ?? (await (artifact.resolveUrl as NonNullable<ModelArtifact['resolveUrl']>)({ artifact }));
          if (attempt === 1) log(`Downloading model ${artifact.id} from ${describeUrl(url)}`);
          resumed = (await downloadOnce(artifact, url, part, doFetch)) || resumed;
          done = true;
        } catch (error) {
          lastError = error;
          if (error instanceof PermanentPullError) break;
          if (attempt < attempts) await sleep(1000 * attempt);
        }
      }
      if (!done) throw lastError;

      const size = statSync(part).size;
      if (size !== artifact.bytes) {
        if (size > artifact.bytes) unlinkSync(part);
        throw new Error(`${artifact.fileName} is ${size} bytes after download, expected ${artifact.bytes}`);
      }
      if ((await sha256Of(part)) !== artifact.sha256) {
        unlinkSync(part);
        hashCache.delete(part);
        throw new Error(`${artifact.fileName} failed its sha256 check and was discarded`);
      }
      try {
        renameSync(part, dest);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
        copyFileSync(part, dest);
        unlinkSync(part);
      }
      hashCache.delete(part);
      const durationMs = Date.now() - started;
      log(`Model ${artifact.id} ready: ${artifact.bytes} bytes in ${durationMs} ms${resumed ? ' (resumed)' : ''}`);
      results.push({ id: artifact.id, outcome: 'downloaded', bytes: artifact.bytes, durationMs, resumed });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // A short partial file stays on purpose: the next pull resumes it.
      log(`Model ${artifact.id} failed: ${detail}`);
      results.push({ id: artifact.id, outcome: 'failed', detail, durationMs: Date.now() - started });
    }
  }
  return results;
}

/** One download attempt into `part`, resuming it if it is short. Returns whether it resumed. */
async function downloadOnce(artifact: ModelArtifact, url: string, part: string, doFetch: typeof fetch): Promise<boolean> {
  let existing = 0;
  if (existsSync(part)) {
    existing = statSync(part).size;
    if (existing > artifact.bytes) {
      unlinkSync(part);
      existing = 0;
    }
  }
  if (existing === artifact.bytes) return true;

  const response = await doFetch(url, { headers: existing > 0 ? { Range: `bytes=${existing}-` } : {}, redirect: 'follow' });
  let append = false;
  if (response.status === 206 && existing > 0) {
    const range = /^bytes (\d+)-/.exec(response.headers.get('content-range') ?? '');
    if (range?.[1] !== String(existing)) {
      await response.body?.cancel();
      unlinkSync(part);
      throw new Error('the server returned a range that does not continue the partial file');
    }
    append = true;
  } else if (response.status === 416) {
    await response.body?.cancel();
    if (existsSync(part)) unlinkSync(part);
    throw new Error('the server rejected the resume range; restarting');
  } else if (!response.ok) {
    await response.body?.cancel();
    const status = response.status;
    const message = `download failed: HTTP ${status} from ${describeUrl(url)}`;
    throw status >= 400 && status < 500 && status !== 408 && status !== 429 ? new PermanentPullError(message) : new Error(message);
  }
  if (response.body === null) throw new Error(`download failed: empty response from ${describeUrl(url)}`);

  await pipeline(
    Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(part, { flags: append ? 'a' : 'w', mode: 0o644 }),
  );
  return append;
}

/**
 * The `models` install step: pulls every declared model, skipping the valid
 * ones. Added automatically by the first {@link registerModelArtifact}.
 *
 * @returns the step.
 * @internal
 */
export function createModelsInstallStep(): InstallStep {
  return {
    id: 'models',
    label: 'Model files',
    supported: () => true,
    detect: async (context: InstallContext) => {
      const verdicts = await verifyModels(resolveModelsDir(context.stateDir));
      return verdicts.every((verdict) => verdict.status === 'ok');
    },
    install: async (context: InstallContext) => {
      const results = await pullModels({ modelsDir: resolveModelsDir(context.stateDir), log: context.log });
      const failed = results.filter((result) => result.outcome === 'failed');
      if (failed.length > 0) throw new Error(failed.map((result) => `${result.id}: ${result.detail ?? 'failed'}`).join('; '));
    },
  };
}

/** Empties the registry. Tests only (`resetCliRegistriesForTests` calls it). @internal */
export function resetModelRegistryForTests(): void {
  for (const artifact of artifacts) unregisterCapabilityProbeForTests(`model:${artifact.id}`);
  removeInstallStepForTests('models');
  artifacts.length = 0;
  stepRegistered = false;
  hashCache.clear();
}

onCapabilityRegistryReset(resetModelRegistryForTests);
