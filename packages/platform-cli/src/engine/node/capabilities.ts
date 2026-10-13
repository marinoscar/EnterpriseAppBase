import { execFileSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { arch, cpus, freemem, platform, totalmem } from 'node:os';

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
 * named here is registered as a probed binary (without a version command) so
 * the requirement can be satisfied at all.
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
  }
  for (const key of [...required, ...degradable]) {
    if (key.startsWith('binary:')) {
      const name = key.slice('binary:'.length);
      if (!PROBED_BINARIES.includes(name)) registerProbedBinary(name);
    }
  }
  JOB_TYPE_REQUIREMENTS[type] = { required, degradable };
}

/**
 * What the capability probe found on this machine.
 *
 * @stability experimental
 */
export interface CapabilityProbe {
  platform: string;
  arch: string;
  nodeVersion: string;
  cpus: number;
  totalMemoryMb: number;
  freeMemoryMb: number;
  /** Which of `PROBED_BINARIES` were found on PATH. */
  binaries: Record<string, boolean>;
  /**
   * The first line of a found binary's version output, for the binaries
   * registered with `versionArgs`. Absent when none was captured.
   */
  versions?: Record<string, string> | undefined;
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
export function probeCapabilities(options?: {
  binaries?: string[] | undefined;
  hasBinary?: ((name: string) => boolean) | undefined;
  /** Reads a found binary's version banner. Defaults to running its registered `versionArgs`. */
  readVersion?: ((name: string) => string | undefined) | undefined;
}): CapabilityProbe {
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

  return {
    platform: safe(() => platform(), 'unknown'),
    arch: safe(() => arch(), 'unknown'),
    nodeVersion: process.version,
    cpus: safe(() => cpus().length, 1),
    totalMemoryMb: safe(() => Math.round(totalmem() / 1024 / 1024), 0),
    freeMemoryMb: safe(() => Math.round(freemem() / 1024 / 1024), 0),
    binaries,
    ...(Object.keys(versions).length > 0 ? { versions } : {}),
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
  type: string;
  capability: Capability;
}

/**
 * The self-test's verdict.
 *
 * @stability experimental
 */
export interface SelfTestResult {
  /** False only when a REQUIRED capability is missing. */
  ok: boolean;
  missingRequired: CapabilityGap[];
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

  for (const type of types) {
    const need = requirements[type];
    if (need === undefined) continue;
    for (const capability of need.required) {
      if (!satisfied.has(capability)) missingRequired.push({ type, capability });
    }
    for (const capability of need.degradable) {
      if (!satisfied.has(capability)) missingDegradable.push({ type, capability });
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
  types: readonly string[];
  probe?: CapabilityProbe | undefined;
  requirements?: Record<string, JobTypeRequirements> | undefined;
  warn?: ((message: string) => void) | undefined;
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
export function runStartupSelfTest(options: SelfTestOptions): SelfTestResult {
  const probe = options.probe ?? probeCapabilities();
  const result = evaluateCapabilities(options.types, probe, options.requirements);

  for (const gap of result.missingDegradable) {
    options.warn?.(
      `Reduced function: job type "${gap.type}" would use "${gap.capability}", which is not available on this machine.`,
    );
  }

  for (const gap of result.missingRequired) {
    options.fail?.(
      `Cannot run job type "${gap.type}": required capability "${gap.capability}" is missing. ` +
        `Install it, or drop the type from this node's --types.`,
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
}
