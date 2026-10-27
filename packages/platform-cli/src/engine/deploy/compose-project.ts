import { copyFileSync, chmodSync, constants, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  isPathUnder,
  listComposeContainers,
  publishesPort,
  type ComposeContainer,
  type ComposeProjectCommandRunner,
} from './compose-containers.js';
import { LEGACY_COMPOSE_PROJECT } from './install.js';
import { deployStatePath, writeState, type DeployState } from './state.js';

export { isPathUnder, type ComposeContainer, type ComposePortBinding, type ComposeProjectCommandRunner } from './compose-containers.js';

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
// never overwritten.
//
// "Exactly one project" is decided by the STRONGEST evidence, not by counting
// every container that ever ran here (#1020). A deploy folder can hold the
// containers of two projects: the live stack (`kvox-nginx-1`) and the leftovers
// of the legacy `compose` (stopped, or created by a failed run). Counting them
// all called that ambiguous and kept `compose`, which then started a second
// stack that died on the bind port. The container that PUBLISHES the bind port
// is the stack that serves; then the running ones; only then the lone project.
// =============================================================================

/**
 * The evidence that decided which project a deployment folder runs under,
 * strongest first. Lets a message say WHY a project was picked.
 *
 * - `bind-port`: a container of that project publishes the deployment's bind
 *   port (running ones first), which is the stack that serves the site.
 * - `running`: it is the only project with a running container.
 * - `only`: it is the only project with any container started from the folder.
 *
 * @stability experimental
 */
export type ComposeProjectBasis = 'bind-port' | 'running' | 'only';

/**
 * What Docker says about the compose project of a deployment folder.
 *
 * @stability experimental
 */
export type ComposeProjectDetection =
  | {
      /** One project is decided by the strongest evidence among those started from inside the folder. */
      kind: 'found';
      /** That project's name. */
      project: string;
      /** The evidence that decided it. */
      basis: ComposeProjectBasis;
    }
  | {
      /** No container was started from inside the folder. */
      kind: 'none';
    }
  | {
      /** Several projects own containers started from inside the folder and no evidence separates them. */
      kind: 'ambiguous';
      /** Their names, sorted. */
      projects: string[];
    }
  | {
      /** Docker could not be asked (not installed, daemon down, permission, timeout). */
      kind: 'unavailable';
    };

/** The sorted, unique project names of `containers`. */
function projectsOf(containers: readonly ComposeContainer[]): string[] {
  return [...new Set(containers.map((container) => container.project))].sort();
}

/**
 * Asks Docker which compose project the containers started from inside
 * `deployRoot` belong to, stopped containers included. A container is the
 * deployment's when its working-directory label is the deploy root or under it.
 *
 * Several projects can live in one folder (the live stack plus leftovers of
 * another), so the answer is the project the STRONGEST evidence names, in
 * order: (1) the project of a container that publishes `options.bindPort`
 * (running ones first: a stopped leftover publishes it in its configuration
 * too), (2) the only project with a running container, (3) the only project.
 * Several projects and no evidence that separates them is `ambiguous`.
 *
 * Never throws: a Docker that cannot be asked is `unavailable`. Read-only
 * (`docker ps`, `docker inspect`), and argv only, never a shell string.
 *
 * @param deployRoot - The deployment folder (`<apps-root>/<name>`).
 * @param run - The command seam; pass the engine's `runCommand`.
 * @param options - `bindPort`: the deployment's loopback port, the strongest evidence when known.
 * @returns the project found and why, none, several, or unavailable.
 * @stability experimental
 */
export async function detectComposeProject(
  deployRoot: string,
  run: ComposeProjectCommandRunner,
  options: { bindPort?: number | undefined } = {},
): Promise<ComposeProjectDetection> {
  try {
    const listed = await listComposeContainers(run);
    if (listed === undefined) return { kind: 'unavailable' };

    const here = listed.filter(
      (container) => container.project !== '' && container.workingDir !== '' && isPathUnder(container.workingDir, deployRoot),
    );
    const projects = projectsOf(here);
    const [only] = projects;
    if (only === undefined) return { kind: 'none' };

    const { bindPort } = options;
    if (bindPort !== undefined) {
      const claimants = here.filter((container) => publishesPort(container, bindPort));
      const serving = claimants.filter((container) => container.running);
      const [holder, ...others] = projectsOf(serving.length > 0 ? serving : claimants);
      if (holder !== undefined && others.length === 0) return { kind: 'found', project: holder, basis: 'bind-port' };
    }

    if (projects.length === 1) return { kind: 'found', project: only, basis: 'only' };

    const [live, ...otherLive] = projectsOf(here.filter((container) => container.running));
    if (live !== undefined && otherLive.length === 0) return { kind: 'found', project: live, basis: 'running' };

    return { kind: 'ambiguous', projects };
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

/** Why a project was picked, as a clause for the operator. */
function basisText(basis: ComposeProjectBasis, bindPort: number | undefined): string {
  if (basis === 'bind-port') return `it holds port ${bindPort ?? 'the bind port'}`;
  if (basis === 'running') return 'it is the only project with a running container here';
  return 'it is the only project with containers here';
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
 * Docker names the project by the strongest evidence (see
 * `detectComposeProject`), the state's bind port first: the stack that holds
 * the port is the one that serves, whatever leftovers share the folder.
 *
 * Changes nothing (the state comes back as given) when there is no state, when
 * Docker cannot be asked or knows no container of this folder, or when it
 * already agrees. A project recorded on purpose is never overwritten; when the
 * container holding the bind port belongs to ANOTHER project it is only
 * reported (a warning), and the `bind-port-owner` check fails the run before
 * anything starts. An ambiguous answer, with nothing decisive, changes nothing
 * and returns a warning naming the projects and the state file: it is never
 * silent, because keeping `compose` unseen is how a second stack got started.
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

    const root = resolve(options.deployRoot);
    const bindPort = typeof state.bindPort === 'number' ? state.bindPort : undefined;
    const detection = await detectComposeProject(root, options.runCommand, { bindPort });
    const recorded = state.composeProject;
    const shown = recorded ?? 'none';
    const path = deployStatePath(root);

    // A recorded, non-legacy project is a decision: never overwritten. But the
    // stack that holds the port living under ANOTHER project is worth saying,
    // since this run would start a second one beside it.
    if (recorded !== undefined && recorded !== LEGACY_COMPOSE_PROJECT) {
      if (detection.kind === 'found' && detection.basis === 'bind-port' && detection.project !== recorded) {
        return {
          state,
          message:
            `warning: the state file records compose project ${recorded} for ${root}, but the stack holding port ${bindPort ?? ''} ` +
            `runs under ${detection.project}; the record was not changed. Set "composeProject" to ${detection.project} in ${path}, ` +
            `or remove the leftover containers of ${detection.project} if they are not the live stack.`,
        };
      }
      return { state };
    }

    if (detection.kind === 'ambiguous') {
      return {
        state,
        message:
          `warning: containers of ${root} run under several compose projects ` +
          `(${detection.projects.join(', ')}) and none of them holds port ${bindPort ?? 'the bind port'} alone or is the only one running; ` +
          `the state file records ${shown}, so the compose project was not changed. ` +
          `Set "composeProject" in ${path} to the right one, or remove the leftover containers.`,
      };
    }

    if (detection.kind !== 'found' || detection.project === LEGACY_COMPOSE_PROJECT) return { state };

    const reconciled: DeployState = { ...state, composeProject: detection.project };
    const note =
      `note: recorded compose project ${detection.project} for ${root} ` +
      `(${basisText(detection.basis, bindPort)}; the state file had ${shown}).`;

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
