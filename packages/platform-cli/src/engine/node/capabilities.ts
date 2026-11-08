import { execFileSync } from 'node:child_process';
import { accessSync, constants, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, cpus, freemem, platform, totalmem } from 'node:os';
import { join } from 'node:path';

// =============================================================================
// Capability probe and the startup self-test  (issue #276, epic #254)
// =============================================================================
//
// THE FAILURE MODE THIS EXISTS TO PREVENT is the worst one a worker has: a node
// that starts successfully but cannot actually do the work it advertised. It
// claims jobs and fails them one at a time, looking healthy to every
// orchestrator and every dashboard while draining the queue into the failed
// pile — and each failure costs the job an attempt, so a fleet member with a
// missing dependency can permanently fail work that nothing was wrong with.
//
// So a worker probes what it can do, compares that against what its ELIGIBLE
// TYPES require, and splits the outcome:
//
//   - a missing REQUIRED capability  → hard exit, naming the capability and
//     the type. In a container that is a visible crash-loop with a clear
//     reason, which is strictly better than a node that quietly fails
//     everything it touches.
//   - a missing DEGRADABLE capability → warn and continue.
//
// That distinction is the whole point of the self-test. Without it, "start
// succeeded" carries no information at all.
//
// -----------------------------------------------------------------------------
// THE REQUIREMENTS MAP NOW HAS ONE REAL ENTRY, AND ONE EXAMPLE-SHAPED ONE
// -----------------------------------------------------------------------------
//
// It was empty when this file was written (#276), and deliberately so: the
// template's example type hashes a stream and needs nothing native, and
// inventing requirements this repository did not have would have been
// inventing dependencies. #352 gave it a genuine one — `db.backup.run` runs
// `pg_dump` — which is also what turns this map from a documented STRUCTURE
// into a worked example of both tiers: a required binary whose absence must
// stop the type being declared at all, and a degradable one whose absence
// costs two audit fields and nothing else.
// =============================================================================

/**
 * A capability key. `binary:<name>` is the convention for an executable.
 *
 * @stability experimental
 */
export type Capability = string;

/**
 * Build the key for an executable, so no call site spells the prefix itself.
 *
 * @param name - the command name (`ffmpeg`).
 * @returns the capability key (`binary:ffmpeg`).
 * @stability experimental
 */
export function binaryCapability(name: string): Capability {
  return `binary:${name}`;
}

/**
 * What one job type needs.
 *
 * @stability experimental
 */
export interface JobTypeRequirements {
  /** Absent → the node must NOT claim this type. Hard exit at startup. */
  required: Capability[];
  /** Absent → reduced function, but the work is still worth attempting. */
  degradable: Capability[];
}

/**
 * What an executor needs, as `registerJobRequirement` takes it.
 *
 * @stability experimental
 */
export interface JobRequirementInput {
  /**
   * Capability keys the node MUST have to claim the type (`binaryCapability('ffmpeg')`
   * is `binary:ffmpeg`). Missing one stops the node at startup, naming it.
   */
  required: readonly Capability[];
  /** Capability keys whose absence only reduces function: warned, never fatal. Default none. */
  degradable?: readonly Capability[] | undefined;
}

/**
 * What each node-eligible job type needs.
 *
 * A type absent from this map requires nothing — which is the right default for
 * a template, and means a fork adds an entry only when it has something to
 * declare.
 */
export const JOB_TYPE_REQUIREMENTS: Record<string, JobTypeRequirements> = {
  // The example type streams and hashes. No native dependency, deliberately.
  'example.checksum': { required: [], degradable: [] },
  // ---------------------------------------------------------------------------
  // `db.backup.run` (#352, epic #345) — the first type with a REAL requirement,
  // and the entry this map's whole structure was written for.
  // ---------------------------------------------------------------------------
  //
  // `pg_dump` is REQUIRED: without it this node cannot take a backup at all,
  // and a node that declares the type anyway would claim the deployment's
  // nightly dump, fail it, and — because `db.backup.run` carries
  // `maxAttempts: 1` — PERMANENTLY fail it. That is the exact failure the
  // self-test exists to prevent, in its most expensive form: the backup that
  // did not happen is discovered during a restore.
  //
  // `psql` is DEGRADABLE, and it is the template's worked example of that tier.
  // The executor uses it for two best-effort provenance reads (the server
  // version and the newest applied migration). Without it the backup is taken,
  // uploaded and verified exactly as before; two audit columns are `null`. A
  // node that refused to run because it could not report a version string would
  // be trading a whole backup for a label — and in practice the two binaries
  // ship in the same `postgresql-client` package, so a node with `pg_dump` and
  // no `psql` is a deliberately trimmed image whose owner already knows.
  'db.backup.run': {
    required: [binaryCapability('pg_dump')],
    degradable: [binaryCapability('psql')],
  },
};

const BUILTIN_REQUIREMENT_TYPES = new Set(Object.keys(JOB_TYPE_REQUIREMENTS));

/**
 * Executables the probe looks for. Extend it with `registerProbedBinary`, which
 * also records how to read the binary's version.
 *
 * ⚠ THIS LIST AND THE MAP ABOVE MOVE TOGETHER. A capability that is never
 * PROBED is a capability that is never satisfied, so a requirement naming a
 * binary missing from here would fail the self-test on every machine, however
 * complete its install. `registerJobRequirement` therefore registers every
 * `binary:<name>` it is given as a probed binary.
 */
export const PROBED_BINARIES: string[] = ['pg_dump', 'psql'];

/** What a binary's name may look like: no path separator, no leading `-`, so `which` and `execFile` can only mean a command name. */
const BINARY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

/** Longest banner kept, in characters. */
export const MAX_BINARY_VERSION_LENGTH = 80;

/** How long a version command may run. */
const VERSION_TIMEOUT_MS = 3000;

const probedBinaryVersionArgs = new Map<string, readonly string[]>();

/**
 * How to read one probed binary's version.
 *
 * @stability experimental
 */
export interface ProbedBinaryOptions {
  /**
   * The arguments that make the binary print its version (`['-version']` for
   * ffmpeg, `['--version']` for most). At most 4, each at most 32 printable
   * characters. Omitted or empty means "found or not found, no version": the
   * binary is never run.
   */
  versionArgs?: readonly string[] | undefined;
}

/**
 * Adds an executable to what the capability probe looks for, so a requirement
 * naming `binary:<name>` can be satisfied, and so the node self-test and
 * `node doctor` can show its version. Call it at module scope, before the node
 * starts (an app's `createCli({ nodeExecutors })` module is the natural place).
 * Registering a name twice replaces its `versionArgs`.
 *
 * The version command runs ONLY while probing (startup, `node doctor`): never
 * on a heartbeat. It is bounded to 3 seconds, its output is cut to the first
 * line and 80 printable characters, and its failure only means "no version".
 *
 * @param name - the command name, as `which` finds it (no path).
 * @param options - how to read its version.
 * @throws Error when `name` is not a bare command name or `versionArgs` is out of bounds.
 *
 * @example
 * ```ts
 * registerProbedBinary('ffmpeg', { versionArgs: ['-version'] });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerProbedBinary(name: string, options: ProbedBinaryOptions = {}): void {
  if (typeof name !== 'string' || !BINARY_NAME_PATTERN.test(name)) {
    throw new Error(`registerProbedBinary: "${String(name)}" is not a bare command name (${BINARY_NAME_PATTERN}).`);
  }
  const args = options.versionArgs ?? [];
  if (!Array.isArray(args) || args.length > 4 || args.some((arg) => typeof arg !== 'string' || arg.length === 0 || arg.length > 32 || /[^\x20-\x7e]/.test(arg))) {
    throw new Error(`registerProbedBinary("${name}"): versionArgs is at most 4 printable arguments of at most 32 characters.`);
  }
  if (!PROBED_BINARIES.includes(name)) PROBED_BINARIES.push(name);
  probedBinaryVersionArgs.set(name, Object.freeze([...args]));
}

/**
 * Declares what a job type needs from the machine, for the startup self-test
 * and `node doctor`. A missing REQUIRED capability stops the node naming the
 * type; a missing degradable one only warns. Every `binary:<name>` capability
 * named here is registered as a probed binary (without a version command), and
 * every `module:<name>` as a {@link moduleCapability} probe, so the requirement
 * can be satisfied at all. A `service:<id>` key needs
 * {@link registerCapabilityProbe}`(`{@link httpServiceCapability}`(...))`.
 *
 * @param type - the job type, as the server's handler declares it.
 * @param requirement - the required and degradable capability keys.
 * @throws Error when `type` is empty, a key is not a non-empty string, or a `binary:` key is not a bare command name.
 *
 * @example
 * ```ts
 * registerJobRequirement('app.transcode', {
 *   required: [binaryCapability('ffmpeg')],
 *   degradable: [binaryCapability('exiftool')],
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerJobRequirement(type: string, requirement: JobRequirementInput): void {
  if (typeof type !== 'string' || type.trim() === '') throw new Error('registerJobRequirement: a job type is required.');
  const required = [...(requirement?.required ?? [])];
  const degradable = [...(requirement?.degradable ?? [])];
  for (const key of [...required, ...degradable]) {
    if (typeof key !== 'string' || key.trim() === '') throw new Error(`registerJobRequirement("${type}"): a capability key must be a non-empty string.`);
    if (key.startsWith('binary:') && !BINARY_NAME_PATTERN.test(key.slice('binary:'.length))) {
      throw new Error(`registerJobRequirement("${type}"): "${key}" does not name a bare command.`);
    }
    if (key.startsWith('module:') && !MODULE_NAME_PATTERN.test(key.slice('module:'.length))) {
      throw new Error(`registerJobRequirement("${type}"): "${key}" does not name an npm package.`);
    }
  }
  for (const key of [...required, ...degradable]) {
    if (key.startsWith('binary:')) {
      const name = key.slice('binary:'.length);
      if (!PROBED_BINARIES.includes(name)) registerProbedBinary(name);
    }
    // A `module:<name>` key is satisfiable without any further call: the module
    // is resolved (never imported). A `service:<id>` key needs its URL, so the
    // app registers `httpServiceCapability(...)` itself.
    if (key.startsWith('module:') && !capabilityProbes.has(key)) {
      registerCapabilityProbe(moduleCapability(key.slice('module:'.length)));
      autoRegisteredProbes.add(key);
    }
  }
  JOB_TYPE_REQUIREMENTS[type] = { required, degradable };
}

// =============================================================================
// Capabilities beyond binaries: modules and services  (RETRO-G2.4, #1074)
// =============================================================================
//
// A worker can be unable to do its work for reasons `which` cannot see: a
// native npm module that is not installed (or installed but unable to load), a
// sidecar service that is not answering. `registerCapabilityProbe` lets an app
// declare such a capability under a `module:<name>` or `service:<id>` key, and
// `registerJobRequirement` then accepts the key in `required` / `degradable`
// like a `binary:` key.
//
// THREE STATES, NOT TWO. `available` is operational; `missing` is absent;
// `installed` is the one a binary probe cannot express: present but not working
// (a module that resolves yet fails its self-test, a service that answers with
// an error). It is NOT in the satisfied capability set, so a REQUIRED one
// blocks startup exactly like a missing one, while the message says which of
// the two it is. A degradable one only warns.
// =============================================================================

/**
 * How well one non-binary capability works here.
 *
 * - `available`: present and working.
 * - `installed`: present but not operational (resolves but fails its check; answers with an error).
 * - `missing`: absent, unreachable, timed out or the probe threw.
 *
 * @stability experimental
 */
export type CapabilityState = 'available' | 'installed' | 'missing';

/**
 * What a capability probe reports.
 *
 * @stability experimental
 */
export interface CapabilityProbeResult {
  status: CapabilityState;
  /** One line explaining the status. Cut to 200 printable characters. */
  detail?: string | undefined;
  /** A version string when the probe can read one. Cut to 80 printable characters. */
  version?: string | undefined;
}

/**
 * What a probe function receives.
 *
 * @stability experimental
 */
export interface CapabilityProbeContext {
  /** The environment the worker runs with. */
  env: NodeJS.ProcessEnv;
  /** Aborted when the probe's time budget is spent; honour it in any I/O. */
  signal: AbortSignal;
}

/**
 * A registered probe for one capability key.
 *
 * @stability experimental
 */
export interface CapabilityProbeDefinition {
  /** The capability key: `module:<name>`, `service:<id>` or any other `<kind>:<name>` an app invents. `binary:` is reserved. */
  key: Capability;
  /** Shown by `node doctor`. */
  label: string;
  /** Decides the status. Throwing or exceeding the budget means `missing`. */
  probe(context: CapabilityProbeContext): CapabilityProbeResult | Promise<CapabilityProbeResult>;
  /** Time budget in milliseconds. Default 5000. */
  timeoutMs?: number | undefined;
  /**
   * How long a heartbeat refresh may reuse this probe's last result, in
   * milliseconds. Default 0 (always probe). Startup and `node doctor` never use
   * the cache.
   */
  cacheMs?: number | undefined;
}

const CAPABILITY_KEY_PATTERN = /^[a-z][a-z0-9-]{0,31}:[A-Za-z0-9@][A-Za-z0-9@/._+-]{0,127}$/;
const MODULE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]{0,127}$/;
const SERVICE_ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const DEFAULT_PROBE_TIMEOUT_MS = 5000;
const MAX_PROBE_DETAIL_LENGTH = 200;

const capabilityProbes = new Map<Capability, CapabilityProbeDefinition>();
/** Keys `registerJobRequirement` registered on its own; an explicit registration replaces them. */
const autoRegisteredProbes = new Set<Capability>();
const probeCache = new Map<Capability, { at: number; result: CapabilityProbeResult }>();

/**
 * Declares a capability the platform cannot probe on its own (a native module,
 * a sidecar service). Call it at module scope, before the node starts. The key
 * can then be named in {@link registerJobRequirement}, and the result appears
 * in the startup self-test, `node doctor` and the heartbeat capability summary.
 *
 * Each probe is bounded (default 5 s) and never throws into the caller: a probe
 * that throws or times out reports `missing`.
 *
 * @param definition - the key, label and probe function.
 * @throws Error when the key is malformed, uses the reserved `binary:` prefix, or is already registered.
 *
 * @example
 * ```ts
 * registerCapabilityProbe(moduleCapability('sharp'));
 * registerCapabilityProbe(httpServiceCapability({ id: 'ocr', env: 'APP_OCR_URL', path: '/status' }));
 * registerJobRequirement('app.ocr', { required: ['module:sharp', 'service:ocr'] });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerCapabilityProbe(definition: CapabilityProbeDefinition): void {
  const key = definition?.key;
  if (typeof key !== 'string' || !CAPABILITY_KEY_PATTERN.test(key)) {
    throw new Error(`registerCapabilityProbe: "${String(key)}" is not a capability key of the form <kind>:<name>.`);
  }
  if (key.startsWith('binary:')) {
    throw new Error('registerCapabilityProbe: the "binary:" prefix is reserved for registerProbedBinary.');
  }
  if (typeof definition.label !== 'string' || definition.label.trim() === '') throw new Error(`registerCapabilityProbe("${key}"): a label is required.`);
  if (typeof definition.probe !== 'function') throw new Error(`registerCapabilityProbe("${key}"): probe must be a function.`);
  for (const field of ['timeoutMs', 'cacheMs'] as const) {
    const value = definition[field];
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error(`registerCapabilityProbe("${key}"): ${field} must be a non-negative number.`);
  }
  if (capabilityProbes.has(key) && !autoRegisteredProbes.has(key)) throw new Error(`registerCapabilityProbe: "${key}" is already registered.`);
  autoRegisteredProbes.delete(key);
  capabilityProbes.set(key, definition);
}

/**
 * The registered non-binary probes, in registration order.
 *
 * @returns the definitions.
 * @stability experimental
 */
export function listCapabilityProbes(): CapabilityProbeDefinition[] {
  return [...capabilityProbes.values()];
}

/** Options of {@link moduleCapability}. */
export interface ModuleCapabilityOptions {
  /** Shown by `node doctor`. Default `npm module <name>`. */
  label?: string | undefined;
  /**
   * Proves the module WORKS, not just that it resolves (load it, run a tiny
   * operation). Resolves normally or returns `true` for operational; returns
   * `false`, a string (the reason) or throws for `installed`-but-not-operational.
   * Absent: a resolvable module counts as available.
   */
  operational?: (() => unknown | Promise<unknown>) | undefined;
  /** A path to resolve from, when the module is not reachable from the running script. */
  resolveFrom?: string | undefined;
  /** Time budget. Default 5000 ms (the module check may load a native binding). */
  timeoutMs?: number | undefined;
  /** Reuse window for heartbeat refreshes. Default 60000 ms: resolution and loading do not change while running. */
  cacheMs?: number | undefined;
}

/**
 * Builds the probe for an npm module under the key `module:<name>`. It decides
 * with `require.resolve`, so probing never imports the module or runs its
 * top-level code; only an explicit {@link ModuleCapabilityOptions.operational}
 * check does, and then `installed` means "resolves, does not work".
 *
 * @param name - the npm package name (`sharp`, `@scope/pkg`).
 * @param options - label and an optional operational check.
 * @returns a definition for {@link registerCapabilityProbe}.
 * @throws Error when the name is not an npm package name.
 * @stability experimental
 */
export function moduleCapability(name: string, options: ModuleCapabilityOptions = {}): CapabilityProbeDefinition {
  if (typeof name !== 'string' || !MODULE_NAME_PATTERN.test(name)) {
    throw new Error(`moduleCapability: "${String(name)}" is not an npm package name.`);
  }
  return {
    key: `module:${name}`,
    label: options.label ?? `npm module ${name}`,
    timeoutMs: options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    cacheMs: options.cacheMs ?? 60_000,
    async probe() {
      const resolved = resolveModule(name, options.resolveFrom);
      if (resolved === undefined) return { status: 'missing', detail: `${name} is not installed` };
      const version = readModuleVersion(name, resolved);
      if (options.operational === undefined) return { status: 'available', ...(version !== undefined ? { version } : {}) };
      try {
        const outcome = await options.operational();
        if (outcome === false || typeof outcome === 'string') {
          return { status: 'installed', detail: typeof outcome === 'string' ? outcome : `${name} is installed but failed its check`, ...(version !== undefined ? { version } : {}) };
        }
        return { status: 'available', ...(version !== undefined ? { version } : {}) };
      } catch (error) {
        return { status: 'installed', detail: `${name} is installed but not operational: ${error instanceof Error ? error.message : String(error)}`, ...(version !== undefined ? { version } : {}) };
      }
    },
  };
}

/** Resolves a module without loading it; returns the resolved path or undefined. */
function resolveModule(name: string, resolveFrom: string | undefined): string | undefined {
  const bases = [resolveFrom, process.argv[1], join(process.cwd(), 'noop.js')].filter((base): base is string => typeof base === 'string' && base !== '');
  for (const base of bases) {
    try {
      return createRequire(base).resolve(name);
    } catch {
      // try the next base
    }
  }
  return undefined;
}

/** The module's `package.json` version, found by walking up from its resolved entry. Never throws. */
function readModuleVersion(name: string, resolvedEntry: string): string | undefined {
  const marker = `node_modules/${name}/`;
  const normalised = resolvedEntry.replace(/\\/g, '/');
  const at = normalised.lastIndexOf(marker);
  if (at === -1) return undefined;
  try {
    const manifest = JSON.parse(readFileSync(`${normalised.slice(0, at + marker.length)}package.json`, 'utf8')) as { version?: unknown };
    return typeof manifest.version === 'string' ? manifest.version : undefined;
  } catch {
    return undefined;
  }
}

/** Options of {@link httpServiceCapability}. */
export interface HttpServiceCapabilityOptions {
  /** The service id; the key is `service:<id>`. */
  id: string;
  /** Shown by `node doctor`. Default `service <id>`. */
  label?: string | undefined;
  /** The base URL. */
  url?: string | undefined;
  /** Or the NAME of an environment variable that holds the base URL (read at probe time). One of `url` / `env` is required. */
  env?: string | undefined;
  /** The path to request, default `/`. */
  path?: string | undefined;
  /** Time budget for the request, default 3000 ms. */
  timeoutMs?: number | undefined;
  /** Reuse window for heartbeat refreshes, default 15000 ms. */
  cacheMs?: number | undefined;
  /** Test seam. */
  fetch?: typeof fetch | undefined;
}

/**
 * Builds the probe for an HTTP sidecar under the key `service:<id>`: a `GET`
 * to `<url><path>`. A 2xx answer is `available`; any other HTTP answer is
 * `installed` (it is there but not healthy); a connection error or a timeout is
 * `missing`. The detail shows the origin and path only, never credentials or a
 * query string.
 *
 * @param options - the service id, its URL (or the env var naming it) and path.
 * @returns a definition for {@link registerCapabilityProbe}.
 * @throws Error when the id is malformed or neither `url` nor `env` is given.
 * @stability experimental
 */
export function httpServiceCapability(options: HttpServiceCapabilityOptions): CapabilityProbeDefinition {
  if (typeof options?.id !== 'string' || !SERVICE_ID_PATTERN.test(options.id)) {
    throw new Error(`httpServiceCapability: "${String(options?.id)}" is not a valid service id.`);
  }
  if (options.url === undefined && options.env === undefined) {
    throw new Error(`httpServiceCapability("${options.id}"): give a url or the name of an env var that holds it.`);
  }
  const timeoutMs = options.timeoutMs ?? 3000;
  return {
    key: `service:${options.id}`,
    label: options.label ?? `service ${options.id}`,
    timeoutMs: timeoutMs + 500,
    cacheMs: options.cacheMs ?? 15_000,
    async probe({ env, signal }) {
      const base = options.url ?? (options.env !== undefined ? env[options.env] : undefined);
      if (base === undefined || base.trim() === '') return { status: 'missing', detail: `${options.env ?? 'url'} is not set` };
      let target: URL;
      try {
        target = new URL(options.path ?? '/', base.endsWith('/') || (options.path ?? '/') === '/' ? base : `${base}/`);
      } catch {
        return { status: 'missing', detail: 'the service URL is not a valid URL' };
      }
      const shown = `${target.origin}${target.pathname}`;
      const timer = AbortSignal.timeout(timeoutMs);
      try {
        const response = await (options.fetch ?? fetch)(target, { method: 'GET', signal: AbortSignal.any([signal, timer]) });
        return response.ok
          ? { status: 'available', detail: `${shown} answered ${response.status}` }
          : { status: 'installed', detail: `${shown} answered HTTP ${response.status}` };
      } catch (error) {
        return { status: 'missing', detail: `${shown} is not reachable: ${timer.aborted ? `no answer within ${timeoutMs} ms` : error instanceof Error ? error.message : String(error)}` };
      }
    },
  };
}

function printable(text: string, max: number): string {
  return text.replace(/[^\x20-\x7e]/g, ' ').trim().slice(0, max).trim();
}

/** Runs one registered probe with its budget, cache and fault isolation. Never throws. */
async function runCapabilityProbe(
  definition: CapabilityProbeDefinition,
  env: NodeJS.ProcessEnv,
  useCache: boolean,
): Promise<CapabilityProbeResult> {
  const cacheMs = definition.cacheMs ?? 0;
  const cached = probeCache.get(definition.key);
  if (useCache && cacheMs > 0 && cached !== undefined && Date.now() - cached.at < cacheMs) return cached.result;

  const budget = definition.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let result: CapabilityProbeResult;
  try {
    const timeout = new Promise<CapabilityProbeResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ status: 'missing', detail: `the probe did not answer within ${budget} ms` });
      }, budget);
    });
    result = await Promise.race([Promise.resolve().then(() => definition.probe({ env, signal: controller.signal })), timeout]);
  } catch (error) {
    result = { status: 'missing', detail: `the probe failed: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  const status: CapabilityState = result?.status === 'available' || result?.status === 'installed' ? result.status : 'missing';
  const clean: CapabilityProbeResult = {
    status,
    ...(typeof result?.detail === 'string' && result.detail !== '' ? { detail: printable(result.detail, MAX_PROBE_DETAIL_LENGTH) } : {}),
    ...(typeof result?.version === 'string' && result.version !== '' ? { version: printable(result.version, 80) } : {}),
  };
  probeCache.set(definition.key, { at: Date.now(), result: clean });
  return clean;
}

/**
 * What the capability probe found on this machine.
 *
 * @stability experimental
 */
export interface CapabilityProbe {
  /** The OS (`linux`). */
  platform: string;
  /** The CPU architecture (`x64`). */
  arch: string;
  /** The Node.js runtime version. */
  nodeVersion: string;
  /** Logical CPUs. */
  cpus: number;
  /** Total memory, in megabytes. */
  totalMemoryMb: number;
  /** Free memory at probe time, in megabytes. */
  freeMemoryMb: number;
  /** Which of `PROBED_BINARIES` were found on PATH. */
  binaries: Record<string, boolean>;
  /**
   * The first line of a found binary's version output, for the binaries
   * registered with `versionArgs`. Absent when none was captured.
   */
  versions?: Record<string, string> | undefined;
  /**
   * The outcome of every registered non-binary probe ({@link registerCapabilityProbe}),
   * keyed by capability key. Absent when none is registered. Only `available`
   * entries are in {@link CapabilityProbe.capabilities}.
   */
  probes?: Record<string, { label: string } & CapabilityProbeResult> | undefined;
  /** Flat set of satisfied capability keys — what the self-test compares against. */
  capabilities: Capability[];
}

/**
 * Probe this machine. NEVER THROWS, whatever the environment.
 *
 * A probe that can fail is a probe that turns a diagnostic command into
 * another thing to diagnose. Every lookup below degrades to "absent".
 *
 * @param options - test seams: the binary list, the PATH lookup, the version reader.
 * @returns what the machine has, including the satisfied capability keys.
 * @stability experimental
 */
export async function probeCapabilities(options?: {
  binaries?: string[] | undefined;
  hasBinary?: ((name: string) => boolean) | undefined;
  /** Reads a found binary's version banner. Defaults to running its registered `versionArgs`. */
  readVersion?: ((name: string) => string | undefined) | undefined;
  /** Environment handed to registered probes. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv | undefined;
  /** Reuse registered probes' cached results (`cacheMs`). For heartbeat refreshes; startup and `doctor` leave it off. */
  useCache?: boolean | undefined;
  /** Registered probes to run. Defaults to the registry; `[]` runs none. */
  probes?: readonly CapabilityProbeDefinition[] | undefined;
}): Promise<CapabilityProbe> {
  const names = options?.binaries ?? PROBED_BINARIES;
  const has = options?.hasBinary ?? isOnPath;
  const readVersion = options?.readVersion ?? readRegisteredVersion;

  const binaries: Record<string, boolean> = {};
  const versions: Record<string, string> = {};
  for (const name of names) {
    try {
      binaries[name] = has(name);
    } catch {
      binaries[name] = false;
    }
    if (binaries[name] === true) {
      const version = safe(() => readVersion(name), undefined);
      if (version !== undefined) versions[name] = version;
    }
  }

  const capabilities: Capability[] = [];
  for (const [name, found] of Object.entries(binaries)) {
    if (found) capabilities.push(binaryCapability(name));
  }

  // Registered non-binary probes run together; each is bounded and isolated.
  const definitions = options?.probes ?? listCapabilityProbes();
  const env = options?.env ?? process.env;
  const settled = await Promise.all(definitions.map((definition) => runCapabilityProbe(definition, env, options?.useCache === true)));
  const probes: Record<string, { label: string } & CapabilityProbeResult> = {};
  definitions.forEach((definition, index) => {
    const result = settled[index] as CapabilityProbeResult;
    probes[definition.key] = { label: definition.label, ...result };
    if (result.status === 'available') capabilities.push(definition.key);
  });

  return {
    platform: safe(() => platform(), 'unknown'),
    arch: safe(() => arch(), 'unknown'),
    nodeVersion: process.version,
    cpus: safe(() => cpus().length, 1),
    totalMemoryMb: safe(() => Math.round(totalmem() / 1024 / 1024), 0),
    freeMemoryMb: safe(() => Math.round(freemem() / 1024 / 1024), 0),
    binaries,
    ...(Object.keys(versions).length > 0 ? { versions } : {}),
    ...(definitions.length > 0 ? { probes } : {}),
    capabilities,
  };
}

/** Runs a registered binary's version command, bounded; `undefined` when it has none or fails. */
function readRegisteredVersion(name: string): string | undefined {
  const args = probedBinaryVersionArgs.get(name);
  if (args === undefined || args.length === 0) return undefined;
  try {
    const output = execFileSync(name, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: VERSION_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
      encoding: 'utf8',
    });
    const line = output.split(/\r?\n/, 1)[0] ?? '';
    // Printable ASCII only, cut: a banner is shown as text and stored in the
    // node's capability bag, so it must be short and carry no control bytes.
    const cleaned = line.replace(/[^\x20-\x7e]/g, '').trim().slice(0, MAX_BINARY_VERSION_LENGTH).trim();
    return cleaned.length > 0 ? cleaned : undefined;
  } catch {
    return undefined;
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * Is `name` an executable on PATH?
 *
 * `which`/`where` rather than walking PATH ourselves: the platform's own
 * resolver already knows about PATHEXT, symlinks and shell builtins, and
 * reimplementing it is how a probe reports "missing" for something that is
 * plainly installed.
 */
function isOnPath(name: string): boolean {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    execFileSync(finder, [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * One capability a type needs and the machine lacks.
 *
 * @stability experimental
 */
export interface CapabilityGap {
  /** The job type that needs the capability. */
  type: string;
  /** The missing capability key. */
  capability: Capability;
  /**
   * `installed` when the capability is present but not operational (a module
   * that resolves and fails its check). Absent for a plainly missing one.
   */
  state?: 'installed' | undefined;
  /** Why, when a probe said (or `no probe is registered for this capability`). */
  detail?: string | undefined;
}

/**
 * The self-test's verdict.
 *
 * @stability experimental
 */
export interface SelfTestResult {
  /** False only when a REQUIRED capability is missing. */
  ok: boolean;
  /** Required capabilities the machine lacks, per type. */
  missingRequired: CapabilityGap[];
  /** Degradable capabilities the machine lacks, per type. */
  missingDegradable: CapabilityGap[];
}

/**
 * Compare advertised types against the probe. Pure, so it is trivially testable.
 *
 * @param types - the job types the node would advertise.
 * @param probe - what the machine has.
 * @param requirements - what each type needs; defaults to the registered ones.
 * @returns the verdict and the gaps.
 * @stability experimental
 */
export function evaluateCapabilities(
  types: readonly string[],
  probe: CapabilityProbe,
  requirements: Record<string, JobTypeRequirements> = JOB_TYPE_REQUIREMENTS,
): SelfTestResult {
  const satisfied = new Set(probe.capabilities);
  const missingRequired: CapabilityGap[] = [];
  const missingDegradable: CapabilityGap[] = [];
  const gapOf = (type: string, capability: Capability): CapabilityGap => {
    const found = probe.probes?.[capability];
    if (found !== undefined) {
      return {
        type,
        capability,
        ...(found.status === 'installed' ? { state: 'installed' as const } : {}),
        ...(found.detail !== undefined ? { detail: found.detail } : {}),
      };
    }
    // A binary is probed by name; anything else with no probe can never be satisfied.
    return capability.startsWith('binary:')
      ? { type, capability }
      : { type, capability, detail: 'no probe is registered for this capability' };
  };

  for (const type of types) {
    const need = requirements[type];
    if (need === undefined) continue;
    for (const capability of need.required) {
      if (!satisfied.has(capability)) missingRequired.push(gapOf(type, capability));
    }
    for (const capability of need.degradable) {
      if (!satisfied.has(capability)) missingDegradable.push(gapOf(type, capability));
    }
  }

  return { ok: missingRequired.length === 0, missingRequired, missingDegradable };
}

/**
 * Options of {@link runStartupSelfTest}.
 *
 * @stability experimental
 */
export interface SelfTestOptions {
  /** The job types the node would advertise. */
  types: readonly string[];
  /** What the machine has; defaults to a fresh probe. */
  probe?: CapabilityProbe | undefined;
  /** What each type needs; defaults to the registered requirements. */
  requirements?: Record<string, JobTypeRequirements> | undefined;
  /** Called with each degradable gap's message. */
  warn?: ((message: string) => void) | undefined;
  /** Called with each required gap's message. */
  fail?: ((message: string) => void) | undefined;
}

/**
 * Run the startup self-test and report what to do about it.
 *
 * Returns the result rather than calling `process.exit` itself — the caller
 * owns the exit, which is what keeps this testable and lets `doctor` reuse it
 * without terminating.
 *
 * @param options - the types, and optionally the probe, requirements and sinks.
 * @returns the verdict; `ok` is false when a REQUIRED capability is missing.
 * @stability experimental
 */
export async function runStartupSelfTest(options: SelfTestOptions): Promise<SelfTestResult> {
  const probe = options.probe ?? (await probeCapabilities());
  const result = evaluateCapabilities(options.types, probe, options.requirements);

  for (const gap of result.missingDegradable) {
    options.warn?.(
      `Reduced function: job type "${gap.type}" would use "${gap.capability}", which is ${
        gap.state === 'installed' ? 'installed but not operational' : 'not available'
      } on this machine${gap.detail !== undefined ? ` (${gap.detail})` : ''}.`,
    );
  }

  for (const gap of result.missingRequired) {
    options.fail?.(
      `Cannot run job type "${gap.type}": required capability "${gap.capability}" is ${
        gap.state === 'installed' ? 'installed but not operational' : 'missing'
      }${gap.detail !== undefined ? ` (${gap.detail})` : ''}. ` +
        `${gap.state === 'installed' ? 'Repair it' : 'Install it'}, or drop the type from this node's --types.`,
    );
  }

  return result;
}

/** Is a path writable? Used by `doctor` and the install steps. */
export function isWritable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes every requirement and probed binary an app registered, leaving the
 * platform's own. Tests only (`resetCliRegistriesForTests` calls it).
 *
 * @internal
 */
export function resetCapabilityRegistriesForTests(): void {
  for (const type of Object.keys(JOB_TYPE_REQUIREMENTS)) {
    if (!BUILTIN_REQUIREMENT_TYPES.has(type)) delete JOB_TYPE_REQUIREMENTS[type];
  }
  PROBED_BINARIES.length = 0;
  PROBED_BINARIES.push('pg_dump', 'psql');
  probedBinaryVersionArgs.clear();
  capabilityProbes.clear();
  autoRegisteredProbes.clear();
  probeCache.clear();
}
