import { copyFileSync, chmodSync, constants, existsSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { LEGACY_COMPOSE_PROJECT } from './install.js';
import { deployStatePath, writeState, type DeployState } from './state.js';

// =============================================================================
// Which compose project does this deployment really run under?
// =============================================================================
//
// `composeProjectFor` answers the legacy `compose` for a state file that records
// no project, and that rule is right for a server whose stack really runs under
// `compose` (the default project of `infra/compose`). It is wrong for a server
// installed by a pre-platform CLI that ran compose with an app-named `-p`
// project and recorded nothing: the engine then passes `-p compose` to every
// `docker compose` call and to the deploy checks, looks for a stack that is not
// there and, worse, would START a second one beside the real stack, which holds
// the bind port. An outage caused by bookkeeping.
//
// A recorded name is only a record. What Docker says is the ground truth: every
// container compose starts carries the directory it was run from
// (`com.docker.compose.project.working_dir`), and a deployment's stack is run
// from inside its own folder. So where the state is loaded for `update`,
// `status` and `doctor`, this reads that label off every container, and when
// the record is absent (or only the legacy default, which an earlier attempt
// may have written back) and Docker names exactly one other project for this
// folder, that project is recorded. A project that was recorded on purpose is
// never overwritten, and Docker is not even asked.
// =============================================================================

/** The label a container carries naming its compose project. */
const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';

/** The label naming the directory compose was run from. */
const COMPOSE_WORKING_DIR_LABEL = 'com.docker.compose.project.working_dir';

/** Short by design: a wedged Docker socket must cost seconds, not the command. */
const DOCKER_QUERY_TIMEOUT_MS = 10_000;

/**
 * One line per container: compose project, then compose working directory.
 *
 * `{{if .Config.Labels}}` guards a container created without any labels, whose
 * `Labels` is null rather than an empty map (`index` on nil renders
 * `<no value>` into the line otherwise); the separator sits outside the guards
 * so every line has both fields.
 */
const INSPECT_FORMAT =
  `{{if .Config.Labels}}{{index .Config.Labels "${COMPOSE_PROJECT_LABEL}"}}{{end}}|` +
  `{{if .Config.Labels}}{{index .Config.Labels "${COMPOSE_WORKING_DIR_LABEL}"}}{{end}}`;

/**
 * The command seam detection runs through: the engine's `runCommand` (or a
 * test's fake of it). Structural, so the executor's own function is assignable
 * and nothing of the executor leaks into the public surface. It rejects when
 * the command fails, which detection reads as "Docker cannot be asked".
 *
 * @stability experimental
 */
export type ComposeProjectCommandRunner = (
  argv: readonly string[],
  options: { cwd: string; timeoutMs?: number | undefined },
) => Promise<{
  /** What the command printed on stdout. */
  stdout: string;
}>;

/**
 * What Docker says about the compose project of a deployment folder.
 *
 * @stability experimental
 */
export type ComposeProjectDetection =
  | {
      /** Exactly one project owns containers started from inside the folder. */
      kind: 'found';
      /** That project's name. */
      project: string;
    }
  | {
      /** No container was started from inside the folder. */
      kind: 'none';
    }
  | {
      /** Several projects own containers started from inside the folder. */
      kind: 'ambiguous';
      /** Their names, sorted. */
      projects: string[];
    }
  | {
      /** Docker could not be asked (not installed, daemon down, permission, timeout). */
      kind: 'unavailable';
    };

/**
 * Whether `path` is `root` or inside it, by path segment: `/opt/apps/app2` is
 * NOT under `/opt/apps/app`. Both are resolved first; nothing touches the disk,
 * because a container's recorded directory need not exist any more.
 *
 * @param path - The path to test.
 * @param root - The folder it may be under.
 * @returns true when `path` is `root` or below it.
 * @stability experimental
 */
export function isPathUnder(path: string, root: string): boolean {
  const relation = relative(resolve(root), resolve(path));
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
}

/**
 * Asks Docker which compose project(s) the containers started from inside
 * `deployRoot` belong to, stopped containers included. A container is the
 * deployment's when its working-directory label is the deploy root or under it.
 *
 * Never throws: a Docker that cannot be asked is `unavailable`. Read-only
 * (`docker ps`, `docker inspect`), and argv only, never a shell string.
 *
 * @param deployRoot - The deployment folder (`<apps-root>/<name>`).
 * @param run - The command seam; pass the engine's `runCommand`.
 * @returns the single project found, none, several, or unavailable.
 * @stability experimental
 */
export async function detectComposeProject(
  deployRoot: string,
  run: ComposeProjectCommandRunner,
): Promise<ComposeProjectDetection> {
  try {
    const ask = (argv: readonly string[]): Promise<{ stdout: string }> =>
      run(argv, { cwd: process.cwd(), timeoutMs: DOCKER_QUERY_TIMEOUT_MS });

    // `-aq`: every container, whatever its state. Ids, which can never be ambiguous.
    const ids = (await ask(['docker', 'ps', '-aq']))
      .stdout.split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    if (ids.length === 0) return { kind: 'none' };

    // ONE inspect over every id, argv and never a shell string.
    const { stdout } = await ask(['docker', 'inspect', '--format', INSPECT_FORMAT, ...ids]);

    const projects = new Set<string>();
    for (const line of stdout.split('\n')) {
      const separator = line.indexOf('|');
      if (separator === -1) continue;
      const project = line.slice(0, separator).trim();
      const workingDir = line.slice(separator + 1).trim();
      if (project === '' || workingDir === '') continue;
      if (isPathUnder(workingDir, deployRoot)) projects.add(project);
    }

    const found = [...projects].sort();
    if (found.length === 0) return { kind: 'none' };
    const [only] = found;
    if (found.length === 1 && only !== undefined) return { kind: 'found', project: only };
    return { kind: 'ambiguous', projects: found };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** What `reconcileComposeProject` needs. */
export interface ReconcileComposeProjectOptions {
  /** The deployment folder. */
  deployRoot: string;
  /** The state as loaded, or undefined when there is no record (nothing to reconcile). */
  state: DeployState | undefined;
  /** The command seam; pass the engine's `runCommand`. */
  runCommand: ComposeProjectCommandRunner;
}

/** What `reconcileComposeProject` decided. */
export interface ReconcileComposeProjectResult {
  /** The state the caller must carry from here on: `composeProject` corrected, everything else untouched. */
  state: DeployState | undefined;
  /** A line for the operator (journal or stderr), when something is worth saying. */
  message?: string | undefined;
}

/**
 * Copies the previous state file once to `<file>.bak` (mode 0600) and keeps an
 * existing backup: the one from before the first change is the one worth having.
 */
function keepBackup(path: string): void {
  const backup = `${path}.bak`;
  try {
    copyFileSync(path, backup, constants.COPYFILE_EXCL);
    chmodSync(backup, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

/**
 * Makes the carried compose project match the one Docker says the deployment
 * runs under, when the record is absent or the legacy default.
 *
 * Changes nothing (the state comes back as given) when there is no state, when
 * a project other than the legacy default is recorded (Docker is not asked),
 * when Docker cannot be asked or knows no container of this folder, or when it
 * already agrees. An ambiguous answer changes nothing and returns a warning
 * naming the projects and the state file (silent when `compose` is among them:
 * the engine's default then works).
 *
 * On `found` with a different project: the returned state carries it, and when
 * a state file is on disk it is rewritten through the engine's own writer (same
 * v2 shape, version not bumped, every other field kept) after the previous file
 * is copied once to `.appctl-deploy.json.bak`. An in-memory state with no file
 * (an adopted deployment) is only corrected; the pipeline records it with its
 * first write. If the file cannot be written the corrected project is still
 * used for this run, since running under the wrong one is the outage, and the
 * message says it was not recorded.
 *
 * Never throws: it must not make a command that worked before fail.
 *
 * @param options - The deployment folder, the loaded state and the command seam.
 * @returns the state to carry, and a one-line message when there is one.
 * @stability experimental
 */
export async function reconcileComposeProject(
  options: ReconcileComposeProjectOptions,
): Promise<ReconcileComposeProjectResult> {
  const { state } = options;
  try {
    if (state === undefined) return { state };

    // A recorded, non-legacy project is a decision: never overwritten, and
    // Docker is not even asked.
    const recorded = state.composeProject;
    if (recorded !== undefined && recorded !== LEGACY_COMPOSE_PROJECT) return { state };

    const root = resolve(options.deployRoot);
    const detection = await detectComposeProject(root, options.runCommand);
    const shown = recorded ?? 'none';
    const path = deployStatePath(root);

    if (detection.kind === 'ambiguous') {
      // The engine's effective project is among them: its default works, nothing to say.
      if (detection.projects.includes(LEGACY_COMPOSE_PROJECT)) return { state };
      return {
        state,
        message:
          `warning: containers of ${root} run under several compose projects ` +
          `(${detection.projects.join(', ')}); the state file records ${shown}, so the compose project was not changed. ` +
          `Set "composeProject" in ${path} to the right one.`,
      };
    }

    if (detection.kind !== 'found' || detection.project === LEGACY_COMPOSE_PROJECT) return { state };

    const reconciled: DeployState = { ...state, composeProject: detection.project };
    const note = `note: recorded compose project ${detection.project} for ${root} (its containers run under it; the state file had ${shown}).`;

    // No file on disk, or one whose recorded root is elsewhere (a moved
    // folder): `writeState` writes to `state.deployRoot`, and creating that
    // directory somewhere else is worse than not recording. Carry it in memory.
    if (!existsSync(path) || resolve(state.deployRoot) !== root) return { state: reconciled, message: note };

    try {
      keepBackup(path);
      writeState(reconciled);
    } catch (error) {
      return {
        state: reconciled,
        message:
          `warning: containers of ${root} run under compose project ${detection.project}, which is used for this run, ` +
          `but it could not be recorded in ${path}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    return { state: reconciled, message: note };
  } catch {
    return { state };
  }
}
