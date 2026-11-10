import { basename } from 'node:path';

import {
  freshComposeProject,
  isPathUnder,
  listComposeContainers,
  publishesPort,
  type ComposeContainer,
} from '../compose-containers.js';
import { deployStatePath } from '../state.js';
import type { Check, CheckContext, CheckResult } from './types.js';

// =============================================================================
// Does this run's compose project match the stack that holds the port?  (#1020)
// =============================================================================
//
// `docker compose -p <wrong project> up -d` builds a SECOND stack beside the
// live one and dies on the bind port the live one holds -- after the build, and
// after the parallel stack's other services have already started. Every
// project-name mistake ends there, so the question is asked up front, from what
// Docker says rather than from what the state file records: does any container,
// in any state, publish this deployment's bind port under a project other than
// the one this run will pass to `-p`?
//
// Read-only, like every check. The removal command is TEXT in a remedy; no
// check ever removes anything.
// =============================================================================

/** The command that removes the containers of `project` started from `workingDir`. */
export function removalCommand(project: string, workingDir: string): string {
  return (
    'docker ps -aq' +
    ` --filter label=com.docker.compose.project=${project}` +
    ` --filter label=com.docker.compose.project.working_dir=${workingDir}` +
    ' | xargs -r docker rm -f'
  );
}

/** The project this run uses: the recorded one, else the name a fresh install would take. */
export function runProject(context: CheckContext): string {
  return context.composeProject ?? freshComposeProject(context.deployRoot);
}

/** A container as a short phrase: `name (project P)`, or `name (not a compose container)`. */
export function describeHolder(container: ComposeContainer): string {
  return container.project === ''
    ? `${container.name} (not a compose container)`
    : `${container.name} (project ${container.project})`;
}

/** The lines of a list, deduplicated and in order. */
export function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

const bindPortOwner: Check = {
  id: 'bind-port-owner',
  title: "Bind port held by this deployment's compose project",
  severity: 'required',
  requires: ['docker-daemon'],
  async run(context): Promise<CheckResult> {
    const containers = await listComposeContainers(context.runCommand);
    if (containers === undefined) {
      return { status: 'skip', detail: 'Docker could not be asked which containers publish the port' };
    }

    const claimants = containers.filter((container) => publishesPort(container, context.bindPort));
    if (claimants.length === 0) {
      return { status: 'pass', detail: `no container publishes port ${context.bindPort}` };
    }

    // A fresh install has no record: the only project that may hold the port is
    // the one it is about to create, and only from inside its own folder.
    const expected = runProject(context);
    const foreign = claimants.filter((container) =>
      context.composeProject === undefined
        ? !(container.project === expected && container.workingDir !== '' && isPathUnder(container.workingDir, context.deployRoot))
        : container.project !== expected,
    );
    if (foreign.length === 0) {
      return { status: 'pass', detail: `held by this deployment (${unique(claimants.map((c) => c.name)).join(', ')})` };
    }

    const inRoot = (container: ComposeContainer): boolean =>
      container.workingDir !== '' && isPathUnder(container.workingDir, context.deployRoot);

    // ⚠ A LIVE HOLDER OF THIS RUN'S OWN PROJECT PROVES THE RUN CANNOT COLLIDE
    // WITH A STOPPED LEFTOVER of this folder: `up -d` under the run's project
    // leaves the leftover alone, and Docker allocates the port only to running
    // containers, so the live stack keeps it. That is housekeeping, not a
    // blocker (a leftover created by a failed run is configured to publish the
    // port too). Without such a holder the same leftover blocks: `up -d` could
    // start OUR container while the leftover holds the promise, or the
    // claimant is a different app. A RUNNING foreign claimant always blocks.
    const ownHolderRuns =
      context.composeProject !== undefined &&
      claimants.some((container) => container.project === expected && container.running);
    const blocking = ownHolderRuns ? foreign.filter((container) => container.running || !inRoot(container)) : foreign;
    const leftovers = foreign.filter((container) => !blocking.includes(container));
    if (blocking.length === 0) {
      const commands = unique(leftovers.map((c) => removalCommand(c.project, c.workingDir)));
      return {
        status: 'warn',
        detail:
          `${unique(leftovers.map((c) => `${c.name} (project ${c.project})`)).join(', ')} ` +
          `${leftovers.length === 1 ? 'is a stopped leftover' : 'are stopped leftovers'} still configured to publish port ${context.bindPort}; ` +
          `this deployment's stack runs under ${expected}, so this run does not collide with ${leftovers.length === 1 ? 'it' : 'them'}`,
        remedy: `Remove the leftover${leftovers.length === 1 ? '' : 's'}: ${commands.join(' ; ')}`,
      };
    }

    // Containers of this folder come first: they are the "second stack" case.
    const ours = blocking.filter(inRoot);
    const [leader] = ours;
    if (leader !== undefined) {
      const projects = unique(ours.map((c) => c.project));
      const commands = unique(ours.map((c) => removalCommand(c.project, c.workingDir)));
      const statePath = deployStatePath(context.deployRoot);
      return {
        status: 'fail',
        detail:
          `this deployment's stack runs under project ${projects.join(', ')} but this run would use ${expected}; ` +
          `a second stack would collide on port ${context.bindPort} ` +
          `(${unique(ours.map((c) => `${c.name}${c.running ? '' : ', not running'}`)).join('; ')})`,
        remedy:
          `Set "composeProject" to ${projects.join(' or ')} in ${statePath} if that is the live stack; ` +
          `if those containers are leftovers, remove them with: ${commands.join(' ; ')}`,
      };
    }

    const [holder] = blocking;
    return {
      status: 'fail',
      detail: `port ${context.bindPort} is promised to ${holder === undefined ? 'another container' : describeHolder(holder)}`,
      remedy:
        `Choose another port with --port (or APP_BIND_PORT in .env), or remove ${unique(blocking.map((c) => c.name)).join(', ')} ` +
        `if it is not needed (docker rm -f ${unique(blocking.map((c) => c.name)).join(' ')}).`,
    };
  },
};

const strayComposeStack: Check = {
  id: 'stray-compose-stack',
  title: 'No leftover containers of another compose project',
  severity: 'recommended',
  requires: ['docker-daemon'],
  async run(context): Promise<CheckResult> {
    // Nothing to compare against before any state exists.
    if (context.composeProject === undefined) {
      return { status: 'skip', detail: 'no compose project is known for this deployment yet' };
    }

    const containers = await listComposeContainers(context.runCommand);
    if (containers === undefined) {
      return { status: 'skip', detail: 'Docker could not be asked which containers exist' };
    }

    const strays = containers.filter(
      (container) =>
        container.project !== '' &&
        container.project !== context.composeProject &&
        container.workingDir !== '' &&
        isPathUnder(container.workingDir, context.deployRoot),
    );
    if (strays.length === 0) {
      return { status: 'pass', detail: `every container of ${basename(context.deployRoot)} is of project ${context.composeProject}` };
    }

    const projects = unique(strays.map((c) => c.project));
    const commands = unique(strays.map((c) => removalCommand(c.project, c.workingDir)));
    return {
      status: 'warn',
      detail:
        `${strays.length} container${strays.length === 1 ? '' : 's'} of project ${projects.join(', ')} ` +
        `started from ${context.deployRoot}, which runs under ${context.composeProject} ` +
        `(${unique(strays.map((c) => `${c.name}${c.running ? '' : ', not running'}`)).join('; ')})`,
      remedy:
        `If they are leftovers, remove them: ${commands.join(' ; ')}. ` +
        `If they are the live stack, set "composeProject" in ${deployStatePath(context.deployRoot)} instead.`,
    };
  },
};

/**
 * The compose-project checks: `bind-port-owner` (required) and
 * `stray-compose-stack` (recommended, so `doctor` only).
 */
export const COMPOSE_CHECKS: readonly Check[] = [bindPortOwner, strayComposeStack];
