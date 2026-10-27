import { join } from 'node:path';

import { composeArgv, composeCwd } from '../compose-command.js';
import { portVariableFor } from '../compose-port-variables.js';
import { readStackPorts, type PublishedPort } from '../compose-ports.js';
import { composeFilesFor } from '../compose-files.js';
import { isPathUnder, listComposeContainers, publishesPort, type ComposeContainer } from '../compose-containers.js';
import { missingComposeVariables } from '../compose-hints.js';
import { parseEnvFile } from '../env-spec.js';
import { deployStatePath } from '../state.js';
import { removalCommand, runProject, unique } from './compose.js';
import { contextFs, contextPortFree, type Check, type CheckResult } from './types.js';

// =============================================================================
// Will every host port the stack publishes bind?  (#1024)
// =============================================================================
//
// `docker compose up -d` recreates web, api and nginx and only then reaches the
// service whose host port something else holds ("Bind for 127.0.0.1:14003
// failed: port is already allocated"): the site is down with the new nginx
// stopped. `bind-port-owner` and `bind-port-free` look at ONE port. This check
// asks compose for ALL of them (`docker compose config --format json`, the same
// project, files and `.env` as the run: compose-ports.ts) and, for each, who
// holds it:
//
//   - a container of ANOTHER compose project (or none), in ANY state -- a
//     leftover of this folder, or another app's stack that took the same default
//     (every app's telemetry stack defaults to 127.0.0.1:14003);
//   - a process outside Docker that listens on it.
//
// Containers of the run's own project are fine: `up -d` recreates them.
//
// ONE OWNER PER PORT. The run's main bind port is `bind-port-owner`'s for the
// container question: its remedy knows the state file's `composeProject`, and a
// second message for the same port would contradict it. This check still probes
// that port for a listener outside Docker, which `bind-port-owner` never does.
//
// Read-only like every check; the removal command is TEXT in a remedy.
// =============================================================================

/** How many host:port lines a failure spells out before it summarises the rest. */
const MAX_LISTED = 6;

/** `127.0.0.1:14003`, `0.0.0.0:53/udp`: the way an operator reads a bind address. */
function endpoint(port: PublishedPort): string {
  return `${port.hostIp === '' ? '0.0.0.0' : port.hostIp}:${port.port}${port.protocol === 'tcp' ? '' : `/${port.protocol}`}`;
}

/** A container in a sentence: `name (project P, running)`, `name (not a compose container, stopped)`. */
function holderPhrase(container: ComposeContainer): string {
  const project = container.project === '' ? 'not a compose container' : `project ${container.project}`;
  return `${container.name} (${project}, ${container.running ? 'running' : 'stopped'})`;
}

/** The deployment's `.env`, then the process environment over it: what compose interpolates with. */
function interpolationEnv(read: (path: string) => string | undefined, composeDir: string): Map<string, string> {
  const env = parseEnvFile(read(join(composeDir, '.env')) ?? '');
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env.set(key, value);
  }
  return env;
}

/** One port that will not bind, and who is in the way. */
interface Problem {
  published: PublishedPort;
  /** The containers in the way; empty for a listener outside Docker. */
  holders: ComposeContainer[];
}

/** A stopped container still configured for a port the run's own stack holds: housekeeping, not a blocker. */
interface Leftover {
  published: PublishedPort;
  containers: ComposeContainer[];
}

/** The first lines of a compose failure, trimmed: the command and the cause, not a dump. */
function summariseFailure(message: string): string {
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const text = lines.slice(0, 3).join(' -- ');
  return text.length > 400 ? `${text.slice(0, 400)}...` : text;
}

const stackPortsFree: Check = {
  id: 'stack-ports-free',
  title: 'Every host port the stack publishes is available',
  severity: 'required',
  requires: ['docker-daemon', 'docker-compose-v2'],
  async run(context): Promise<CheckResult> {
    const fs = contextFs(context);
    const composeDir = composeCwd(context.deployRoot);

    // Before the checkout there is nothing to render. A fresh install reaches
    // here from its preflight; the `stack-ports` step asks again once the
    // checkout and the environment exist.
    const [firstFile] = composeFilesFor(context.groups, composeDir);
    if (firstFile === undefined || !fs.exists(join(composeDir, firstFile))) {
      return { status: 'skip', detail: `no compose files at ${composeDir} yet` };
    }

    const containers = await listComposeContainers(context.runCommand);
    if (containers === undefined) {
      return { status: 'skip', detail: 'Docker could not be asked which containers publish the stack ports' };
    }

    const project = runProject(context);
    const stack = await readStackPorts({
      run: context.runCommand,
      deployRoot: context.deployRoot,
      project,
      groups: context.groups,
    });

    if (stack.status === 'docker-unreachable') {
      return { status: 'skip', detail: 'Docker could not render the compose project' };
    }
    if (stack.status === 'render-failed') {
      // The environment is still to be written by this run: the later gate
      // renders the final one.
      if (context.environmentPending === true) {
        return { status: 'skip', detail: 'the stack cannot be rendered until the environment is written; checked again then' };
      }
      // ⚠ A FAILURE, not a skip: an update that cannot render its configuration
      // fails at its first `up` anyway, and doing so BEFORE the containers are
      // touched is the whole point.
      const missing = missingComposeVariables(stack.message);
      const envPath = join(composeDir, '.env');
      return {
        status: 'fail',
        detail: `docker compose cannot render the stack: ${summariseFailure(stack.message)}`,
        remedy:
          missing.length > 0
            ? `Set ${missing.join(', ')} in ${envPath} (a revision can require a key only a newer CLI generates: update the CLI first), then re-run.`
            : `Run it to see the whole error: cd ${composeDir} && ${composeArgv(['config'], project, context.groups, composeDir).join(' ')}`,
      };
    }

    const ports = stack.ports;
    if (ports.length === 0) {
      return { status: 'pass', detail: 'the stack publishes no host ports' };
    }

    // A container is "ours" when it is of the run's project; a project not yet
    // recorded (a fresh install, a bare doctor run) also needs it to have been
    // started from this folder, as `bind-port-owner` decides.
    const isOwn = (container: ComposeContainer): boolean =>
      context.composeProject === undefined
        ? container.project === project && container.workingDir !== '' && isPathUnder(container.workingDir, context.deployRoot)
        : container.project === project;
    const inRoot = (container: ComposeContainer): boolean =>
      container.workingDir !== '' && isPathUnder(container.workingDir, context.deployRoot);

    const portFree = contextPortFree(context);
    const problems: Problem[] = [];
    const leftovers: Leftover[] = [];
    const envPath = join(composeDir, '.env');

    let variableEnv: Map<string, string> | undefined;
    let fileTexts: string[] | undefined;
    const variableOf = (published: PublishedPort): string | undefined => {
      variableEnv ??= interpolationEnv(fs.readFile, composeDir);
      fileTexts ??= composeFilesFor(context.groups, composeDir).map((file) => fs.readFile(join(composeDir, file)) ?? '');
      return portVariableFor({ port: published, files: fileTexts, env: variableEnv });
    };

    // ⚠ A PORT THE ENVIRONMENT HAS NO VALUE FOR IS NOT FINAL YET (#1027). While
    // this run may still write the `.env` (`environmentPending`), a clash on a
    // port that is only the compose file's DEFAULT -- the `.env` exists but lacks
    // the key, as a deployment from before the telemetry stack does -- is not a
    // verdict: install's environment step and update's `environment-drift` give
    // such a key a free port, and the `stack-ports` step asks again with the
    // final file, before any container is touched. Failing here would stop the
    // update the picker exists to unblock. A key the `.env` HAS is final, and
    // still fails.
    const deferred: Problem[] = [];
    const defersToEnvironment = (published: PublishedPort): boolean => {
      if (context.environmentPending !== true || !fs.exists(envPath)) return false;
      const variable = variableOf(published);
      return variable !== undefined && (variableEnv?.get(variable) ?? '') === '';
    };
    const report = (problem: Problem): void => {
      (defersToEnvironment(problem.published) ? deferred : problems).push(problem);
    };

    for (const published of ports) {
      const claim = { hostIp: published.hostIp, protocol: published.protocol };
      const claimants = containers.filter((container) => publishesPort(container, published.port, claim));
      const running = claimants.filter((container) => container.running);

      // The main bind port's container question is `bind-port-owner`'s.
      if (published.port !== context.bindPort) {
        const foreign = claimants.filter((container) => !isOwn(container));
        // ⚠ A RUNNING container of the run's own project proves a stopped
        // foreign one cannot collide with this run: Docker allocates a port
        // only to a running container, and the live one keeps it. Without
        // that proof the stopped one is a leftover of an unknown stack and
        // blocks, as `bind-port-owner` does.
        const ownRuns = running.some(isOwn);
        const blocking = foreign.filter((container) => container.running || !ownRuns);
        if (blocking.length > 0) {
          report({ published, holders: blocking });
          continue;
        }
        const stopped = foreign.filter((container) => !container.running);
        if (stopped.length > 0) leftovers.push({ published, containers: stopped });
      }

      // A process outside Docker. Only when no running container accounts for
      // the listener (docker-proxy is one), and only where the probe is honest:
      // it binds TCP on the loopback, which sees a listener on 127.0.0.1 or on
      // every interface, and says nothing about another address or a UDP port.
      const probeable = published.protocol === 'tcp' && (published.hostIp === '' || published.hostIp === '127.0.0.1');
      if (running.length === 0 && probeable && !(await portFree(published.port))) {
        report({ published, holders: [] });
      }
    }

    if (problems.length === 0 && leftovers.length === 0) {
      const available = `${ports.length} host port${ports.length === 1 ? '' : 's'} available (${ports.slice(0, MAX_LISTED).map(endpoint).join(', ')}${ports.length > MAX_LISTED ? ', ...' : ''})`;
      if (deferred.length === 0) return { status: 'pass', detail: available };
      const names = unique(deferred.map(({ published }) => variableOf(published) ?? endpoint(published)));
      return {
        status: 'pass',
        detail:
          `${deferred.length} of ${available} ${deferred.length === 1 ? 'is' : 'are'} taken today (${unique(deferred.map(({ published }) => endpoint(published))).join(', ')}), ` +
          `but ${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} not in ${envPath} yet: a free port is chosen when the environment is written, and the ports are checked again then`,
      };
    }

    const statePath = deployStatePath(context.deployRoot);

    /** How to move THIS stack off the port. */
    const moveOff = (published: PublishedPort): string => {
      const variable = variableOf(published);
      return variable === undefined
        ? `no .env variable sets ${endpoint(published)} (the compose files fix it for ${published.service}): change that port mapping in an infra/compose/app.*.compose.yml overlay`
        : `set ${variable}=<free port> in ${envPath}`;
    };

    if (problems.length > 0) {
      const detail = problems.slice(0, MAX_LISTED).map(({ published, holders }) => {
        const variable = variableOf(published);
        const needs = `${published.service}${variable === undefined ? '' : `, set by ${variable}`}`;
        return holders.length === 0
          ? `${endpoint(published)} (${needs}) is in use by a process outside Docker`
          : `${endpoint(published)} (${needs}) is published by ${unique(holders.map(holderPhrase)).join(', ')}`;
      });
      if (problems.length > MAX_LISTED) detail.push(`and ${problems.length - MAX_LISTED} more`);

      const remedies: string[] = [];
      for (const { published, holders } of problems) {
        const local = holders.filter(inRoot);
        const others = holders.filter((container) => !inRoot(container));
        if (holders.length === 0) {
          remedies.push(`${endpoint(published)}: stop the process that listens on it (ss -ltnp 'sport = :${published.port}'), or ${moveOff(published)}`);
          continue;
        }
        if (local.length > 0) {
          const projects = unique(local.map((container) => container.project).filter((name) => name !== ''));
          const commands = unique(local.filter((c) => c.project !== '').map((c) => removalCommand(c.project, c.workingDir)));
          remedies.push(
            `${endpoint(published)}: ${unique(local.map((c) => c.name)).join(', ')} ` +
              `${local.length === 1 ? 'was' : 'were'} started from this folder` +
              (projects.length === 0
                ? `; stop ${local.length === 1 ? 'it' : 'them'} with docker rm -f ${unique(local.map((c) => c.name)).join(' ')}`
                : `; if ${projects.join(' or ')} is the live stack, set "composeProject" to it in ${statePath}, and if ${local.length === 1 ? 'it is a leftover' : 'they are leftovers'}, remove ${local.length === 1 ? 'it' : 'them'} with: ${commands.join(' ; ')}`),
          );
        }
        if (others.length > 0) {
          remedies.push(
            `${endpoint(published)}: ${unique(others.map((c) => c.name)).join(', ')} ${others.length === 1 ? 'belongs' : 'belong'} to another stack, so ${moveOff(published)}` +
              ` (or stop ${others.length === 1 ? 'it' : 'them'} if not needed: docker stop ${unique(others.map((c) => c.name)).join(' ')})`,
          );
        }
      }

      return {
        status: 'fail',
        detail: detail.join('; '),
        remedy: remedies.join(' ; '),
      };
    }

    // Only housekeeping is left: stopped containers of other stacks still
    // configured for a port the run's own live stack holds.
    const names = unique(leftovers.flatMap((leftover) => leftover.containers.map((container) => `${container.name} (project ${container.project === '' ? 'none' : container.project})`)));
    const commands = unique(
      leftovers.flatMap((leftover) =>
        leftover.containers.filter((c) => c.project !== '' && inRoot(c)).map((c) => removalCommand(c.project, c.workingDir)),
      ),
    );
    return {
      status: 'warn',
      detail:
        `${names.join(', ')} ${names.length === 1 ? 'is a stopped leftover' : 'are stopped leftovers'} still configured for ` +
        `${unique(leftovers.map((leftover) => endpoint(leftover.published))).join(', ')}; ` +
        `this stack's own container holds ${leftovers.length === 1 ? 'that port' : 'those ports'}, so this run does not collide`,
      remedy:
        commands.length > 0
          ? `Remove the leftover${names.length === 1 ? '' : 's'}: ${commands.join(' ; ')}`
          : `Remove ${names.length === 1 ? 'it' : 'them'} if not needed: docker rm ${unique(leftovers.flatMap((l) => l.containers.map((c) => c.name))).join(' ')}`,
    };
  },
};

/** The stack-wide port check: `stack-ports-free` (required). */
export const STACK_PORT_CHECKS: readonly Check[] = [stackPortsFree];
