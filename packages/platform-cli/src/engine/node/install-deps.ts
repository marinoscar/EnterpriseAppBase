import { execFile, spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

import { cliName } from '../identity.js';
import { isWritable } from './capabilities.js';

// =============================================================================
// `node install-deps` — a framework, deliberately  (issue #276, epic #254)
// =============================================================================
//
// ⚠ THIS IS THE ONE PLACE IN THE EPIC WHERE FULL PARITY IS KNOWINGLY REDUCED,
// and the reason is that the parity target is entirely domain-specific. The
// application this design comes from installs ffmpeg, OCR language data, ML
// models and a face-detection sidecar. None of those exist here, and inventing
// equivalents would be inventing dependencies a template does not have — which
// is worse than shipping nothing, because a fork would then have to work out
// which of the steps were real.
//
// So what ships is the STRUCTURE: ordered steps, a per-step outcome of
// `skipped | installed | failed | unsupported`, distro detection, an explicit
// sudo announcement, and `--dry-run`. A fork fills in its own steps, and the
// README documents that as the extension point.
//
// SUDO IS ANNOUNCED, NEVER SILENT. A command that quietly escalates is a
// command people stop trusting; the plan says which steps need it before any
// of them run.
// =============================================================================

export type StepOutcome = 'skipped' | 'installed' | 'failed' | 'unsupported';

export interface DistroInfo {
  /** `ubuntu`, `debian`, `alpine`, `darwin`, `win32`, or `unknown`. */
  id: string;
  versionId: string | undefined;
  family: 'debian' | 'rhel' | 'alpine' | 'darwin' | 'windows' | 'unknown';
}

export interface InstallContext {
  distro: DistroInfo;
  dryRun: boolean;
  stateDir: string;
  /** Runs a command to completion with inherited stdio; rejects on a non-zero exit. */
  run: (command: string, args: string[]) => void | Promise<void>;
  /**
   * Runs a command quietly and resolves with its stdout; rejects on a non-zero
   * exit or a missing binary. For asking a question (`dpkg -s`, `docker ps`),
   * never for changing anything.
   */
  capture: (command: string, args: string[]) => Promise<string>;
  log: (message: string) => void;
}

export interface InstallStep {
  id: string;
  label: string;
  /** Escalation is declared up front so the plan can announce it. */
  requiresSudo?: boolean | undefined;
  /** Can this step run at all here? Returning false yields `unsupported`. */
  supported(context: InstallContext): boolean | Promise<boolean>;
  /** Already satisfied? Returning true yields `skipped`. */
  detect(context: InstallContext): boolean | Promise<boolean>;
  /** Do the install. May be async: a download or a container health poll is. */
  install(context: InstallContext): void | Promise<void>;
}

export interface StepResult {
  id: string;
  label: string;
  outcome: StepOutcome;
  detail?: string | undefined;
}

/**
 * Read `/etc/os-release`, falling back to the platform.
 *
 * Best effort by construction: a distro nobody anticipated yields `unknown`,
 * and every step that cares reports `unsupported` rather than guessing a
 * package manager and running it.
 */
export function detectDistro(options?: { platform?: NodeJS.Platform | undefined; osRelease?: string | undefined }): DistroInfo {
  const plat = options?.platform ?? process.platform;
  if (plat === 'win32') return { id: 'win32', versionId: undefined, family: 'windows' };
  if (plat === 'darwin') return { id: 'darwin', versionId: undefined, family: 'darwin' };

  let content = options?.osRelease;
  if (content === undefined) {
    try {
      content = readFileSync('/etc/os-release', 'utf8');
    } catch {
      return { id: 'unknown', versionId: undefined, family: 'unknown' };
    }
  }

  const fields = new Map<string, string>();
  for (const line of content.split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match?.[1] !== undefined) fields.set(match[1], (match[2] ?? '').replace(/^"|"$/g, ''));
  }

  const id = fields.get('ID') ?? 'unknown';
  const like = fields.get('ID_LIKE') ?? '';
  const haystack = `${id} ${like}`;

  const family: DistroInfo['family'] = /debian|ubuntu/.test(haystack)
    ? 'debian'
    : /rhel|fedora|centos/.test(haystack)
      ? 'rhel'
      : /alpine/.test(haystack)
        ? 'alpine'
        : 'unknown';

  return { id, versionId: fields.get('VERSION_ID'), family };
}

/**
 * The steps this template ships.
 *
 * Both are generic and both are real — they are the two things every worker
 * needs regardless of what it computes. A fork appends beside them.
 */
export const DEFAULT_INSTALL_STEPS: InstallStep[] = [
  {
    id: 'state-dir',
    label: 'Worker state directory',
    supported: () => true,
    detect: (context) => isWritable(context.stateDir),
    install: (context) => {
      if (context.dryRun) return;
      mkdirSync(context.stateDir, { recursive: true, mode: 0o700 });
    },
  },
  {
    id: 'node-runtime',
    label: 'Node.js 20 or newer',
    supported: () => true,
    detect: () => {
      const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
      return major >= 20;
    },
    install: () => {
      // Deliberately NOT automated. Replacing the runtime out from under a
      // process that is currently running on it is not something a subcommand
      // should do unannounced, and every platform has its own right answer.
      throw new Error(
        `This ${cliName()} needs Node.js 20 or newer; ${process.versions.node} is installed. Upgrade Node, then re-run.`,
      );
    },
  },
];

export interface InstallDepsOptions {
  stateDir: string;
  /** Replaces the default-plus-registered steps entirely. Tests, mostly. */
  steps?: InstallStep[] | undefined;
  /** Run only these step ids (the `--only` flag). An unknown id is an error. */
  only?: readonly string[] | undefined;
  /** Test seam for {@link InstallContext.capture}. */
  capture?: ((command: string, args: string[]) => Promise<string>) | undefined;
  dryRun?: boolean | undefined;
  distro?: DistroInfo | undefined;
  run?: ((command: string, args: string[]) => void | Promise<void>) | undefined;
  log?: ((message: string) => void) | undefined;
}

export interface InstallDepsReport {
  distro: DistroInfo;
  dryRun: boolean;
  results: StepResult[];
  /** True when nothing failed. `unsupported` is not a failure. */
  ok: boolean;
}

/**
 * Run (or plan) the steps in order.
 *
 * `--dry-run` PERFORMS NO MUTATION: `detect` still runs (it is read-only and
 * is what makes the plan accurate), `install` does not.
 */
export async function runInstallDeps(options: InstallDepsOptions): Promise<InstallDepsReport> {
  const all = options.steps ?? listInstallSteps();
  const steps = selectInstallSteps(all, options.only);
  const dryRun = options.dryRun === true;
  const log = options.log ?? (() => {});
  const distro = options.distro ?? detectDistro();

  const context: InstallContext = {
    distro,
    dryRun,
    stateDir: options.stateDir,
    run:
      options.run ??
      ((command, args) => runInherited(command, args)),
    capture: options.capture ?? captureStdout,
    log,
  };

  const escalating = steps.filter((step) => step.requiresSudo === true);
  if (escalating.length > 0) {
    log(
      `These steps need sudo: ${escalating.map((step) => step.id).join(', ')}. ` +
        'You will be prompted for your password.',
    );
  }

  const results: StepResult[] = [];

  for (const step of steps) {
    let supported: boolean;
    try {
      supported = await step.supported(context);
    } catch (error) {
      results.push({ id: step.id, label: step.label, outcome: 'failed', detail: messageOf(error) });
      continue;
    }
    if (!supported) {
      results.push({ id: step.id, label: step.label, outcome: 'unsupported', detail: `Not supported on ${distro.id}` });
      continue;
    }

    let satisfied: boolean;
    try {
      satisfied = await step.detect(context);
    } catch (error) {
      results.push({ id: step.id, label: step.label, outcome: 'failed', detail: messageOf(error) });
      continue;
    }

    if (satisfied) {
      results.push({ id: step.id, label: step.label, outcome: 'skipped', detail: 'Already satisfied' });
      continue;
    }

    if (dryRun) {
      results.push({ id: step.id, label: step.label, outcome: 'installed', detail: 'Would install (dry run)' });
      continue;
    }

    try {
      await step.install(context);
      results.push({ id: step.id, label: step.label, outcome: 'installed' });
    } catch (error) {
      results.push({ id: step.id, label: step.label, outcome: 'failed', detail: messageOf(error) });
    }
  }

  return { distro, dryRun, results, ok: results.every((result) => result.outcome !== 'failed') };
}

export function formatInstallReport(report: InstallDepsReport): string {
  const lines = [`Detected ${report.distro.id}${report.distro.versionId === undefined ? '' : ` ${report.distro.versionId}`} (${report.distro.family})`];
  if (report.dryRun) lines.push('Dry run — nothing was changed.');
  lines.push('');
  for (const result of report.results) {
    lines.push(`  ${result.outcome.padEnd(11)} ${result.label}${result.detail === undefined ? '' : ` — ${result.detail}`}`);
  }
  return `${lines.join('\n')}\n`;
}

function captureStdout(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error !== null) reject(error);
      else resolve(stdout);
    });
  });
}

/** Runs a command with inherited stdio, rejecting on a spawn error or a non-zero exit. */
function runInherited(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code === null ? `signal ${String(signal)}` : `code ${code}`}`));
    });
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// =============================================================================
// The step registry  (RETRO-G2.4, #1074)
// =============================================================================
//
// The two built-in steps are the only ones the PACKAGE ships. What a particular
// worker needs installed (a transcoder, OCR data, a model file, a sidecar
// container) is the app's to declare, so an app registers its steps here, at
// module scope, before the CLI is built. `node install-deps` then runs the
// defaults followed by the registered steps in a deterministic order.
//
// Nothing product-specific lives in this package: the helpers below
// (`ensureAptPackages`, `ensureDockerContainer`, `runWithSudoAnnounced`) take
// package names, images and arguments from the step that calls them.
// =============================================================================

/**
 * An install step as an app registers it.
 *
 * @stability experimental
 */
export type RegisteredInstallStep = InstallStep & {
  /**
   * Sort key among the registered steps (ascending, default 0). The built-in
   * steps always run first. Equal keys keep registration order.
   */
  order?: number | undefined;
  /**
   * Run immediately after the step with this id (a built-in or another
   * registered step) instead of by `order`. Several steps after the same id
   * keep registration order.
   */
  after?: string | undefined;
};

const STEP_ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const registeredSteps: RegisteredInstallStep[] = [];

/**
 * Declares a step `node install-deps` runs after the built-in ones. Call it at
 * module scope, before the node command runs (the module that holds your
 * `createCli({ nodeExecutors })` is the natural place).
 *
 * A step is idempotent by contract: `detect` says whether it is already
 * satisfied (then the outcome is `skipped`), `install` does the work, and
 * `--dry-run` runs `detect` only. A step needing `sudo` sets `requiresSudo` so
 * the plan announces it, and runs its commands through
 * {@link runWithSudoAnnounced}.
 *
 * @param step - the step, with an optional `order` or `after` placement.
 * @throws Error when the id is malformed or already taken (by a built-in or an earlier registration).
 *
 * @example
 * ```ts
 * registerInstallStep({
 *   id: 'transcoder',
 *   label: 'Media transcoder',
 *   requiresSudo: true,
 *   supported: (ctx) => ctx.distro.family === 'debian',
 *   detect: (ctx) => ctx.capture('ffmpeg', ['-version']).then(() => true, () => false),
 *   install: (ctx) => ensureAptPackages(['ffmpeg'], ctx),
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerInstallStep(step: RegisteredInstallStep): void {
  if (typeof step?.id !== 'string' || !STEP_ID_PATTERN.test(step.id)) {
    throw new Error(`registerInstallStep: "${String(step?.id)}" is not a valid step id (${STEP_ID_PATTERN}).`);
  }
  if (typeof step.label !== 'string' || step.label.trim() === '') throw new Error(`registerInstallStep("${step.id}"): a label is required.`);
  for (const fn of ['supported', 'detect', 'install'] as const) {
    if (typeof step[fn] !== 'function') throw new Error(`registerInstallStep("${step.id}"): "${fn}" must be a function.`);
  }
  if (step.order !== undefined && !Number.isFinite(step.order)) throw new Error(`registerInstallStep("${step.id}"): order must be a finite number.`);
  if (DEFAULT_INSTALL_STEPS.some((existing) => existing.id === step.id) || registeredSteps.some((existing) => existing.id === step.id)) {
    throw new Error(`registerInstallStep: a step with id "${step.id}" is already registered.`);
  }
  registeredSteps.push(step);
}

/**
 * The steps `node install-deps` runs: the built-ins, then the registered steps.
 * Throws when a step names an `after` id that does not exist, or the `after`
 * links form a cycle.
 *
 * @returns the steps in execution order.
 * @stability experimental
 */
export function listInstallSteps(): InstallStep[] {
  const placed: InstallStep[] = [...DEFAULT_INSTALL_STEPS];
  const byOrder = registeredSteps
    .filter((step) => step.after === undefined)
    .map((step, index) => ({ step, index }))
    .sort((a, b) => (a.step.order ?? 0) - (b.step.order ?? 0) || a.index - b.index)
    .map((entry) => entry.step);
  placed.push(...byOrder);

  let pending = registeredSteps.filter((step) => step.after !== undefined);
  while (pending.length > 0) {
    const next: RegisteredInstallStep[] = [];
    for (const step of pending) {
      let at = placed.findIndex((candidate) => candidate.id === step.after);
      if (at === -1) {
        next.push(step);
        continue;
      }
      // Keep several steps that follow the same id in registration order.
      while (placed[at + 1] !== undefined && registeredSteps.some((other) => other.after === step.after && other.id === placed[at + 1]?.id)) at += 1;
      placed.splice(at + 1, 0, step);
    }
    if (next.length === pending.length) {
      const stuck = next.map((step) => `${step.id} (after ${String(step.after)})`).join(', ');
      throw new Error(`Install steps cannot be ordered: ${stuck}. Each "after" must name an existing step, without a cycle.`);
    }
    pending = next;
  }
  return placed;
}

function selectInstallSteps(steps: InstallStep[], only: readonly string[] | undefined): InstallStep[] {
  if (only === undefined || only.length === 0) return steps;
  const known = new Set(steps.map((step) => step.id));
  const unknown = only.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown install step${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Known steps: ${[...known].join(', ')}.`);
  }
  const wanted = new Set(only);
  return steps.filter((step) => wanted.has(step.id));
}

/** Removes one registered step. Tests only. @internal */
export function removeInstallStepForTests(id: string): void {
  const at = registeredSteps.findIndex((step) => step.id === id);
  if (at !== -1) registeredSteps.splice(at, 1);
}

/** Removes every registered step. Tests only (`resetCliRegistriesForTests` calls it). @internal */
export function resetInstallStepRegistryForTests(): void {
  registeredSteps.length = 0;
}

/**
 * Runs one privileged command: announced first, never run in `--dry-run`, and
 * run without `sudo` when the process is already root.
 *
 * @param command - the executable to elevate (`apt-get`).
 * @param args - its arguments.
 * @param context - the step's context.
 * @stability experimental
 */
export async function runWithSudoAnnounced(command: string, args: string[], context: InstallContext): Promise<void> {
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const line = `${isRoot ? '' : 'sudo '}${command} ${args.join(' ')}`.trim();
  if (context.dryRun) {
    context.log(`Would run: ${line}`);
    return;
  }
  context.log(`Running: ${line}`);
  await (isRoot ? context.run(command, args) : context.run('sudo', [command, ...args]));
}

const APT_PACKAGE_PATTERN = /^[a-z0-9][a-z0-9+.-]{0,99}$/;

/**
 * Installs the Debian-family packages that are not installed yet, with one
 * announced `apt-get install -y`. Nothing runs when all are present, and
 * nothing in `--dry-run`.
 *
 * @param names - package names (`['ffmpeg']`).
 * @param context - the step's context.
 * @returns the packages that were (or, in a dry run, would be) installed.
 * @throws Error on a non-Debian distro or a malformed package name.
 * @stability experimental
 */
export async function ensureAptPackages(names: readonly string[], context: InstallContext): Promise<string[]> {
  if (context.distro.family !== 'debian') {
    throw new Error(`apt packages (${names.join(', ')}) can only be installed on a Debian-family system; this is ${context.distro.id}.`);
  }
  for (const name of names) {
    if (!APT_PACKAGE_PATTERN.test(name)) throw new Error(`"${name}" is not a valid apt package name.`);
  }
  const missing: string[] = [];
  for (const name of names) {
    const installed = await context.capture('dpkg', ['-s', name]).then(
      (out) => /^Status:.*\binstall ok installed\b/m.test(out),
      () => false,
    );
    if (!installed) missing.push(name);
  }
  if (missing.length === 0) return [];
  await runWithSudoAnnounced('apt-get', ['install', '-y', ...missing], context);
  return missing;
}

/**
 * What {@link ensureDockerContainer} manages.
 *
 * @stability experimental
 */
export interface DockerContainerSpec {
  /** Container name. */
  name: string;
  /** Image reference, supplied by the app. */
  image: string;
  /** Extra `docker run` arguments (ports, env, volumes), placed before the image. */
  args?: readonly string[] | undefined;
  /** Returns true once the container works (an HTTP probe, say). Polled after a start. */
  verify?: ((context: InstallContext) => boolean | Promise<boolean>) | undefined;
  /** Polls of `verify`. Default 20. */
  verifyAttempts?: number | undefined;
  /** Wait between polls. Default 2000 ms. */
  verifyIntervalMs?: number | undefined;
  /** Run docker through `sudo`. Default false. */
  sudo?: boolean | undefined;
  /** Test seam for the wait between polls. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

const DOCKER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/**
 * Makes a container exist, run and (when `verify` is given) answer: starts a
 * stopped one, creates a missing one with `--restart unless-stopped`, and
 * polls `verify` up to 20 times 2 s apart.
 *
 * @param spec - the container.
 * @param context - the step's context.
 * @returns what it did: `running` (already up), `started`, `created`, or `planned` (dry run).
 * @throws Error when docker is missing, the name or image is malformed, or `verify` never passes.
 * @stability experimental
 */
export async function ensureDockerContainer(
  spec: DockerContainerSpec,
  context: InstallContext,
): Promise<'running' | 'started' | 'created' | 'planned'> {
  if (!DOCKER_NAME_PATTERN.test(spec.name)) throw new Error(`"${spec.name}" is not a valid container name.`);
  if (spec.image.trim() === '' || spec.image.startsWith('-')) throw new Error(`"${spec.image}" is not a valid image reference.`);
  await context.capture('docker', ['--version']).catch(() => {
    throw new Error('Docker is not installed or not on PATH.');
  });

  const state = (
    await context.capture('docker', ['inspect', '-f', '{{.State.Running}}', spec.name]).catch(() => 'absent')
  ).trim();

  const docker = (args: string[]): Promise<void> => (spec.sudo === true ? runWithSudoAnnounced('docker', args, context) : Promise.resolve(context.run('docker', args)));

  let outcome: 'running' | 'started' | 'created' = 'running';
  if (state !== 'true') {
    if (context.dryRun) {
      context.log(`Would ${state === 'false' ? 'start' : 'create'} container ${spec.name} (dry run)`);
      return 'planned';
    }
    if (state === 'false') {
      await docker(['start', spec.name]);
      outcome = 'started';
    } else {
      await docker(['run', '-d', '--name', spec.name, '--restart', 'unless-stopped', ...(spec.args ?? []), spec.image]);
      outcome = 'created';
    }
  }

  if (spec.verify !== undefined) {
    const attempts = spec.verifyAttempts ?? 20;
    const sleep = spec.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (await Promise.resolve(spec.verify(context)).catch(() => false)) return outcome;
      if (attempt < attempts) await sleep(spec.verifyIntervalMs ?? 2000);
    }
    throw new Error(`Container ${spec.name} did not become healthy after ${attempts} checks.`);
  }
  return outcome;
}
