import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PreconditionError } from '../errors.js';
import { isLoopbackPortFree } from './checks/types.js';
import { composeCwd } from './compose-command.js';
import { publishesPort, type ComposeContainer } from './compose-containers.js';
import { composeFilesFor } from './compose-files.js';
import { publishedPortVariables } from './compose-port-variables.js';

// =============================================================================
// Free host ports for the variables the CLI writes  (#1027)
// =============================================================================
//
// Every app the platform deploys publishes the same default host ports
// (`APP_BIND_PORT=3535`, `GREPTIME_BIND_PG_PORT=14003`), so the SECOND app on a
// server collided with the first on its telemetry port and `stack-ports-free`
// (#1024) stopped it, leaving the operator to hand-edit `.env`. When the CLI is
// about to WRITE a value for a published-port variable it now picks one that is
// actually free:
//
//   - FREE means no container in ANY state is configured to publish it on an
//     address that can clash (the source `stack-ports-free` uses), nothing
//     listens on it (the same loopback bind probe as `bind-port-free`), and it
//     is not already chosen for another variable of the same run.
//   - THE SEARCH STARTS AT THE DEFAULT AND WALKS UP, bounded, so a lone app
//     keeps the familiar numbers and says nothing extra.
//   - AN EXISTING VALUE IS NEVER MOVED. Only a variable with no value yet gets a
//     pick: an SSH tunnel or a BI tool may depend on the number, and
//     `stack-ports-free` still reports a clash with the fix.
//   - DOCKER UNREACHABLE (`containers` undefined) is probe-only: still picks.
//
// `stack-ports-free` stays the final guard; this module only chooses what the
// guard is then asked about. It reads Docker and probes sockets and writes
// nothing: the callers decide where a value goes.
// =============================================================================

/** How far above the default a search walks before giving up. */
export const DEFAULT_PORT_SEARCH_LIMIT = 200;

/** The highest port number. */
const MAX_PORT = 65535;

/** Where a port is published: the address and protocol a clash is judged on. */
export interface PortClaim {
  /** The host address; `''` (and `0.0.0.0`, `::`) is every interface. */
  hostIp: string;
  /** `tcp`, `udp` or `sctp`. */
  protocol: string;
}

/** Why a candidate port was passed over. */
export interface SkippedPort {
  port: number;
  /** `listener`: a process listens on it; `container`: a container is configured to publish it; `taken`: another variable of this run has it. */
  reason: 'listener' | 'container' | 'taken';
  /** The container that holds it, for `container`. A running one is preferred over a stopped one. */
  holder?: string | undefined;
}

/** The port found, and the ones passed over on the way. */
export interface PortPick {
  port: number;
  skipped: SkippedPort[];
}

/**
 * Whether `value` is an integer port number (1 to 65535).
 *
 * @param value - Any number.
 * @returns true for a usable port.
 */
export function isPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_PORT;
}

/** Whether the listener probe says something about this claim: it binds TCP on the loopback. */
function probeable(claim: PortClaim): boolean {
  return claim.protocol === 'tcp' && ['', '0.0.0.0', '::', '[::]', '127.0.0.1'].includes(claim.hostIp);
}

/**
 * The first free host port at or above `preferred`.
 *
 * `options` carries:
 *
 * - `preferred`: where the search starts (the template default).
 * - `hostIp` and `protocol`: where the port will be published.
 * - `also`: more places the SAME port number is published (a variable that
 *   feeds a TCP and a UDP mapping); all of them must be free.
 * - `taken`: ports already chosen for other variables of this run. Not
 *   changed; the caller adds the result.
 * - `containers`: every container Docker knows, in any state. A container claims
 *   a port when it is configured to publish it on an address that overlaps (a
 *   wildcard clashes with every address) and the same protocol.
 * - `probe`: says whether nothing listens on the port (true = free).
 * - `limit`: how many ports to try (default 200); the search never goes above
 *   65535.
 * - `label`: names the variable in the error.
 *
 * @param options - The search, as above.
 * @returns the port and the candidates passed over.
 * @throws PreconditionError when `preferred` is not a port, or none is free.
 */
export async function pickFreePort(options: {
  preferred: number;
  hostIp: string;
  protocol: string;
  also?: readonly PortClaim[] | undefined;
  taken?: ReadonlySet<number> | undefined;
  containers: readonly ComposeContainer[];
  probe: (port: number) => Promise<boolean>;
  limit?: number | undefined;
  label?: string | undefined;
}): Promise<PortPick> {
  const { preferred, taken = new Set<number>(), containers, probe, limit = DEFAULT_PORT_SEARCH_LIMIT } = options;
  const label = options.label ?? 'a host port';
  const claims: PortClaim[] = [{ hostIp: options.hostIp, protocol: options.protocol }, ...(options.also ?? [])];

  if (!isPort(preferred)) {
    throw new PreconditionError(`Cannot pick a free port for ${label}: ${String(preferred)} is not a port number.`);
  }

  const last = Math.min(MAX_PORT, preferred + Math.max(1, limit) - 1);
  const skipped: SkippedPort[] = [];

  for (let port = preferred; port <= last; port += 1) {
    if (taken.has(port)) {
      skipped.push({ port, reason: 'taken' });
      continue;
    }

    const claimants = containers.filter((container) => claims.some((claim) => publishesPort(container, port, claim)));
    if (claimants.length > 0) {
      const holder = claimants.find((container) => container.running) ?? claimants[0];
      skipped.push({ port, reason: 'container', holder: holder?.name });
      continue;
    }

    // Probed once per port, and only where the probe is honest: it binds TCP on
    // the loopback, which sees a listener on 127.0.0.1 or on every interface.
    if (claims.some(probeable) && !(await probe(port))) {
      skipped.push({ port, reason: 'listener' });
      continue;
    }

    return { port, skipped };
  }

  throw new PreconditionError(
    `No free host port for ${label} from ${preferred} to ${last} (${skipped.length} tried). ` +
      `Free one of them, or set ${options.label ?? 'the variable'} to a free port in the environment file by hand.`,
  );
}

/** How many skipped candidates a message spells out. */
const MAX_PHRASES = 3;

/**
 * The sentence for a pick that did not land on the default:
 * `GREPTIME_BIND_PG_PORT=14013 (14003 is held by evopath-greptimedb-1)`.
 *
 * @param variable - The variable the port is for.
 * @param pick - What `pickFreePort` returned.
 * @param preferred - The default the search started from.
 * @returns the text, or `undefined` when the default was free (nothing to say).
 */
export function describePick(variable: string, pick: PortPick, preferred: number): string | undefined {
  if (pick.port === preferred && pick.skipped.length === 0) return undefined;
  const phrase = (entry: SkippedPort): string =>
    entry.reason === 'container'
      ? `${entry.port} is held by ${entry.holder ?? 'another container'}`
      : entry.reason === 'listener'
        ? `${entry.port} has a listener`
        : `${entry.port} is used by another variable of this run`;
  const shown = pick.skipped.slice(0, MAX_PHRASES).map(phrase);
  if (pick.skipped.length > MAX_PHRASES) shown.push(`${pick.skipped.length - MAX_PHRASES} more in use`);
  return `${variable}=${pick.port} (${shown.join(', ')})`;
}

/** A port variable decided by `planPortValues`. */
export interface PortDecision {
  variable: string;
  port: number;
  /** The default the search started from. */
  preferred: number;
  /** What `describePick` says, or `undefined` when the default was free. */
  message: string | undefined;
}

/**
 * Decides a value for every published-port variable that needs one.
 *
 * The variables come from the compose files (`publishedPortVariables`), so an
 * app overlay that publishes a new port is covered without a list to keep. A
 * variable is decided only when it is in `eligible`, has no non-blank value in
 * `given`, is not in `exclude`, and a starting point is known (the template
 * default, else the compose file's). Everything else is left exactly as it is.
 * Variables are decided in the order the files publish them; each choice is
 * `taken` for the next, and so are the ports the `given` values already use.
 *
 * `options` carries:
 *
 * - `files`: the compose files' text, in merge order.
 * - `eligible`: the keys this run may decide (the template's, or for an update
 *   the keys it is adding).
 * - `given`: values that stay as they are, the `.env` on disk and the
 *   operator's answers. A key with a value here is never moved.
 * - `defaults`: the template default of each key, where the search starts.
 * - `exclude`: keys decided elsewhere (`APP_BIND_PORT`).
 * - `taken`: ports already in use by this run.
 * - `containers`: every container Docker knows, or `undefined` when Docker
 *   cannot be asked (probe-only).
 * - `probe`: says whether nothing listens on a port (default: the loopback bind
 *   probe).
 * - `limit`: the search bound per variable.
 *
 * @param options - The decision inputs, as above.
 * @returns one decision per variable decided, in file order.
 * @throws PreconditionError when a variable has no free port within the bound.
 */
export async function planPortValues(options: {
  files: readonly string[];
  eligible: ReadonlySet<string>;
  given: ReadonlyMap<string, string>;
  defaults: ReadonlyMap<string, string>;
  exclude?: ReadonlySet<string> | undefined;
  taken?: Iterable<number> | undefined;
  containers: readonly ComposeContainer[] | undefined;
  probe?: ((port: number) => Promise<boolean>) | undefined;
  limit?: number | undefined;
}): Promise<PortDecision[]> {
  const { given, defaults, eligible, exclude = new Set<string>() } = options;
  const probe = options.probe ?? isLoopbackPortFree;
  const containers = options.containers ?? [];

  const variables = publishedPortVariables({ files: options.files, env: new Map([...defaults, ...given]) });

  // What the run already uses: the ports it was told about, and every value
  // another published-port variable keeps.
  const taken = new Set<number>(options.taken ?? []);
  for (const { variable } of variables) {
    const value = Number(given.get(variable));
    if (given.get(variable) !== undefined && isPort(value)) taken.add(value);
  }

  const decisions: PortDecision[] = [];
  for (const candidate of variables) {
    const { variable } = candidate;
    if (!eligible.has(variable) || exclude.has(variable)) continue;
    if ((given.get(variable) ?? '') !== '') continue;

    const fromTemplate = Number(defaults.get(variable));
    const preferred = isPort(fromTemplate) ? fromTemplate : candidate.defaultPort;
    if (preferred === undefined) continue;

    const [first, ...rest] = candidate.claims;
    if (first === undefined) continue;
    const pick = await pickFreePort({
      preferred,
      hostIp: first.hostIp,
      protocol: first.protocol,
      also: rest,
      taken,
      containers,
      probe,
      limit: options.limit,
      label: variable,
    });
    taken.add(pick.port);
    decisions.push({ variable, port: pick.port, preferred, message: describePick(variable, pick, preferred) });
  }
  return decisions;
}

/**
 * The containers a pick must avoid: every one except those of the run's own
 * compose project, which `up -d` recreates (the rule `stack-ports-free` applies).
 *
 * @param containers - What `listComposeContainers` returned, or `undefined`.
 * @param project - The deployment's compose project.
 * @returns the other projects' containers, or `undefined` when Docker could not be asked.
 */
export function foreignContainers(
  containers: readonly ComposeContainer[] | undefined,
  project: string,
): ComposeContainer[] | undefined {
  return containers?.filter((container) => container.project !== project);
}

/**
 * The text of the deployment's compose files, in the order compose merges them
 * (the same list `up -d` uses, app overlays last). A file that cannot be read
 * is an empty string: a missing checkout is the compose call's error to report.
 *
 * @param deployRoot - The deployment folder.
 * @param groups - The deployment's groups.
 * @returns one text per compose file.
 */
export function readComposeFileTexts(deployRoot: string, groups?: readonly string[] | undefined): string[] {
  const composeDir = composeCwd(deployRoot);
  return composeFilesFor(groups, composeDir).map((file) => {
    try {
      return readFileSync(join(composeDir, file), 'utf8');
    } catch {
      return '';
    }
  });
}
