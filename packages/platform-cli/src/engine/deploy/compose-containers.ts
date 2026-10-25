import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

// =============================================================================
// Which containers does Docker know, and which compose project is each in?
// =============================================================================
//
// The leaf under compose-project.ts (detection and reconciliation) and the
// `bind-port-owner` / `stray-compose-stack` deploy checks: it imports nothing
// from the engine, so a check can ask Docker without importing the install
// pipeline. Read-only (`docker ps`, `docker inspect`), argv only.
// =============================================================================

/** The label a container carries naming its compose project. */
const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';

/** The label naming the directory compose was run from. */
const COMPOSE_WORKING_DIR_LABEL = 'com.docker.compose.project.working_dir';

/** Short by design: a wedged Docker socket must cost seconds, not the command. */
const DOCKER_QUERY_TIMEOUT_MS = 10_000;

/**
 * One line per container: name, running state, published host ports, compose
 * project, then compose working directory.
 *
 * `{{if .Config.Labels}}` guards a container created without any labels, whose
 * `Labels` is null rather than an empty map (`index` on nil renders
 * `<no value>` into the line otherwise); the separators sit outside the guards
 * so every line has all five fields. `PortBindings` is the CONFIGURED publish,
 * present on a stopped or merely created container too, and a nil map ranges
 * over nothing. The working directory comes last so a path containing the
 * separator survives; none of the fields before it can contain one.
 */
const INSPECT_FORMAT =
  '{{.Name}}|{{.State.Running}}|' +
  '{{range $port, $bindings := .HostConfig.PortBindings}}{{range $bindings}}{{.HostPort}},{{end}}{{end}}|' +
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
 * One container as the deploy checks and the detection see it.
 *
 * @stability experimental
 */
export interface ComposeContainer {
  /** The container name, without Docker's leading slash. */
  name: string;
  /** Whether it is running now. */
  running: boolean;
  /** The host ports it is configured to publish (a range stays `8000-8010`); empty `HostPort`s are no claim and are not listed. */
  hostPorts: string[];
  /** Its `com.docker.compose.project` label, `''` when it is not a compose container. */
  project: string;
  /** Its `com.docker.compose.project.working_dir` label, `''` when absent. */
  workingDir: string;
}

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
 * The compose project a FRESH install of `deployRoot` gets: the folder name.
 * An existing deployment keeps the one it runs under (`composeProjectFor`);
 * only a deployment with no record and no evidence is named this way. Install
 * and the `bind-port-owner` check both ask here, so they cannot disagree.
 *
 * @param deployRoot - The deployment folder.
 * @returns the project name a fresh install would use.
 */
export function freshComposeProject(deployRoot: string): string {
  return basename(deployRoot);
}

/**
 * Whether `container` is configured to publish host port `port`. An empty
 * `HostPort` (Docker picks one) is no claim; a range claims every port in it.
 *
 * @param container - The container.
 * @param port - The host port.
 * @returns true when the container publishes it.
 */
export function publishesPort(container: Pick<ComposeContainer, 'hostPorts'>, port: number): boolean {
  return container.hostPorts.some((entry) => {
    const [first = '', last = first] = entry.split('-');
    const low = Number(first);
    const high = Number(last);
    return Number.isInteger(low) && Number.isInteger(high) && low <= port && port <= high;
  });
}

/**
 * Every container Docker knows, in any state, with its compose labels and the
 * host ports it is configured to publish: one `docker ps -aq` and ONE
 * `docker inspect`, argv only, never a shell string.
 *
 * @param run - The command seam; pass the engine's `runCommand`.
 * @returns the containers, or `undefined` when Docker cannot be asked.
 */
export async function listComposeContainers(run: ComposeProjectCommandRunner): Promise<ComposeContainer[] | undefined> {
  try {
    const ask = (argv: readonly string[]): Promise<{ stdout: string }> =>
      run(argv, { cwd: process.cwd(), timeoutMs: DOCKER_QUERY_TIMEOUT_MS });

    // `-aq`: every container, whatever its state. Ids, which can never be ambiguous.
    const ids = (await ask(['docker', 'ps', '-aq']))
      .stdout.split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    if (ids.length === 0) return [];

    const { stdout } = await ask(['docker', 'inspect', '--format', INSPECT_FORMAT, ...ids]);

    const containers: ComposeContainer[] = [];
    for (const line of stdout.split('\n')) {
      // Four separators, then the working directory (which may hold more). A
      // line with fewer is not ours, such as the `<no value>` an unguarded
      // template prints.
      const fields: string[] = [];
      let rest = line;
      for (let index = 0; index < 4; index += 1) {
        const separator = rest.indexOf('|');
        if (separator === -1) break;
        fields.push(rest.slice(0, separator));
        rest = rest.slice(separator + 1);
      }
      if (fields.length < 4) continue;
      const [name = '', running = '', ports = '', project = ''] = fields;
      containers.push({
        name: name.replace(/^\//, '').trim(),
        running: running.trim() === 'true',
        hostPorts: ports.split(',').map((port) => port.trim()).filter((port) => port !== ''),
        project: project.trim(),
        workingDir: rest.trim(),
      });
    }
    return containers;
  } catch {
    return undefined;
  }
}

