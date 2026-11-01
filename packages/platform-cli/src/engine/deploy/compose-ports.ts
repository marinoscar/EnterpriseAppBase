import { composeArgv, composeCwd } from './compose-command.js';
import type { ComposeProjectCommandRunner } from './compose-containers.js';

// =============================================================================
// Which host ports will the composed stack publish?  (#1024)
// =============================================================================
//
// `docker compose up -d` recreates the services that changed, in dependency
// order, and only THEN meets a host port something else holds. By that point the
// web, api and nginx containers have been replaced and the one that needed the
// port (`greptimedb` on 127.0.0.1:14003) cannot start: the site is down. So the
// question "will every port the stack publishes bind?" has to be answered before
// the first container is touched, and the only complete answer to "which ports
// does the stack publish?" is compose's own: the same files, the same project and
// the same `.env` `up` will read, merged and interpolated (`!override` and
// `${APP_BIND_PORT:-3535}` included), i.e. `docker compose config --format json`.
//
// ⚠ THAT OUTPUT CARRIES EVERY SECRET. The rendered `environment:` of each
// service holds POSTGRES_PASSWORD, JWT_SECRET and the rest, in clear. This module
// parses it in memory and hands back ports only; it never logs, journals or
// quotes stdout, not even to explain a parse failure. A failed command's message
// is stderr (the executor's tail), which compose does not fill with values.
//
// Read-only, argv only, never a shell string. `config` needs no daemon: whether
// Docker is reachable is the caller's question (`listComposeContainers`).
// =============================================================================

/** Hard stop on one published range, so a pathological `1-65535` cannot make a check probe 65k sockets. */
const MAX_RANGE_PORTS = 1024;

/** Compose renders the whole stack; a big project on a small VPS is slow, a hang is not. */
const CONFIG_TIMEOUT_MS = 60_000;

/**
 * One host port the composed stack publishes.
 *
 * @stability experimental
 */
export interface PublishedPort {
  /** The compose service that publishes it. */
  service: string;
  /** The host address; `''` when none was given, which is every interface. */
  hostIp: string;
  /** The host port. A published range is one entry per port. */
  port: number;
  /** `tcp`, `udp` or `sctp`. */
  protocol: string;
}

/** `docker compose config --format json` output that is not the stack this module can read. */
export class ComposeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComposeConfigError';
  }
}

/**
 * Splits a short-syntax port spec (`127.0.0.1:14003:4003/tcp`) at the colons
 * that are not inside `${...}` or an IPv6 `[...]`, and returns the host side.
 *
 * Shared by the rendered-config fallback and the raw-file variable scan, so
 * both read one grammar.
 *
 * @param spec - The spec, quotes and whitespace already removed.
 * @returns the host address (`''` when none), the published token (which may
 *   still hold `${VAR:-default}`), and the protocol; `undefined` for a spec
 *   with no published side (`"80"`, a container-only port).
 */
export function splitPortSpec(spec: string): { hostIp: string; published: string; protocol: string } | undefined {
  const parts: string[] = [];
  let current = '';
  let braces = 0;
  let brackets = 0;
  for (const char of spec) {
    if (char === '{') braces += 1;
    else if (char === '}') braces = Math.max(0, braces - 1);
    else if (char === '[') brackets += 1;
    else if (char === ']') brackets = Math.max(0, brackets - 1);
    if (char === ':' && braces === 0 && brackets === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);

  // [hostIp:]published:target[/protocol]; fewer than two parts publishes nothing.
  if (parts.length < 2) return undefined;
  const target = parts[parts.length - 1] ?? '';
  const slash = target.indexOf('/');
  const protocol = slash === -1 ? 'tcp' : target.slice(slash + 1).toLowerCase();
  const published = parts[parts.length - 2] ?? '';
  const hostIp = parts.length >= 3 ? parts.slice(0, parts.length - 2).join(':').replace(/^\[|\]$/g, '') : '';
  return { hostIp, published, protocol: protocol === '' ? 'tcp' : protocol };
}

/** The ports a `published` token names: `3535`, `"3535"` or the range `"8000-8002"`. */
function expandPublished(published: unknown): number[] {
  if (published === undefined || published === null) return [];
  const text = String(published).trim();
  // '' and 0 mean "Docker picks one": no claim to collide with.
  if (text === '' || text === '0') return [];
  const [first = '', last = first] = text.split('-');
  const low = Number(first);
  const high = Number(last);
  if (!Number.isInteger(low) || !Number.isInteger(high) || low < 1 || high < low || high > 65535) {
    throw new ComposeConfigError(`unreadable published port ${JSON.stringify(text)}`);
  }
  const ports: number[] = [];
  for (let port = low; port <= high && ports.length < MAX_RANGE_PORTS; port += 1) ports.push(port);
  return ports;
}

/**
 * Every host port a rendered compose project publishes, from the JSON of
 * `docker compose config --format json`.
 *
 * `published` is a string for compose v2 and a number elsewhere, and a range
 * (`"8000-8002"`) is one entry per port; no `published` (or `0`) is a port
 * Docker picks and is no claim; no `host_ip` is every interface; the protocol
 * defaults to `tcp`. A service that lists a short-syntax string instead of the
 * long form is read too. A range wider than 1024 ports is cut at 1024.
 *
 * @param json - The command's stdout.
 * @returns the ports, deduplicated, in service order.
 * @throws ComposeConfigError when the text is not a compose project. The
 *   message never quotes the text: it holds the stack's secrets.
 * @stability experimental
 */
export function parseComposePorts(json: string): PublishedPort[] {
  let document: unknown;
  try {
    document = JSON.parse(json);
  } catch {
    throw new ComposeConfigError('the output of `docker compose config --format json` is not JSON');
  }
  const services = (document as { services?: unknown } | null)?.services;
  if (typeof services !== 'object' || services === null || Array.isArray(services)) {
    throw new ComposeConfigError('the output of `docker compose config --format json` has no services');
  }

  const found: PublishedPort[] = [];
  const seen = new Set<string>();
  const add = (entry: PublishedPort): void => {
    const key = `${entry.service}|${entry.hostIp}|${entry.port}|${entry.protocol}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(entry);
  };

  for (const [service, definition] of Object.entries(services as Record<string, unknown>)) {
    const ports = (definition as { ports?: unknown } | null)?.ports;
    if (!Array.isArray(ports)) continue;
    for (const raw of ports as unknown[]) {
      if (typeof raw === 'string') {
        const split = splitPortSpec(raw.replace(/["'\s]/g, ''));
        if (split === undefined) continue;
        for (const port of expandPublished(split.published)) {
          add({ service, hostIp: split.hostIp, port, protocol: split.protocol });
        }
        continue;
      }
      if (typeof raw !== 'object' || raw === null) continue;
      const entry = raw as { published?: unknown; host_ip?: unknown; protocol?: unknown };
      const hostIp = typeof entry.host_ip === 'string' ? entry.host_ip.replace(/^\[|\]$/g, '') : '';
      const protocol = typeof entry.protocol === 'string' && entry.protocol !== '' ? entry.protocol.toLowerCase() : 'tcp';
      for (const port of expandPublished(entry.published)) add({ service, hostIp, port, protocol });
    }
  }
  return found;
}

/**
 * What asking compose for the stack's ports came to.
 *
 * @stability experimental
 */
export type StackPortsResult =
  /** The ports the stack publishes. */
  | { status: 'ok'; ports: PublishedPort[] }
  /** Docker could not be reached at all (no `docker`, no daemon, no socket access): nothing was learned. */
  | { status: 'docker-unreachable'; message: string }
  /** Compose refused to render the stack (a missing required variable, an invalid file) or printed something unreadable. */
  | { status: 'render-failed'; message: string };

/** The wordings Docker uses for "I cannot be asked", from the docker-daemon check plus the missing binary. */
const DOCKER_UNREACHABLE =
  /cannot connect to the docker daemon|failed to connect to the docker api|is the docker daemon running|docker\.sock|docker: command not found/i;

/** The failure's own words: the executor's message (argv and stderr tail), and stderr. Never stdout. */
function failureText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const result = (error as { result?: { stderr?: string } }).result;
  const stderr = result?.stderr?.trim() ?? '';
  return stderr === '' || error.message.includes(stderr) ? error.message : `${error.message}\n${stderr}`;
}

/**
 * Renders the deployment's compose project exactly as `up -d` would and lists
 * the host ports it publishes, with `docker compose config --format json` run
 * under the run's project and files, in the checkout's compose directory. That
 * directory is where compose finds the deployment's `.env`: no `--env-file` is
 * passed by any `up`, so none is passed here, and the process environment
 * overrides the file the same way. Never runs anything that changes a container.
 *
 * @param options - The command seam, the deployment and the project.
 * @returns the ports, or why they could not be read.
 * @stability experimental
 */
export async function readStackPorts(options: {
  /** The command seam; the engine's `runCommand`. */
  run: ComposeProjectCommandRunner;
  /** The deployment folder. */
  deployRoot: string;
  /** The compose project the run passes to `-p`. */
  project: string;
  /** The deployment's groups; the always-on ones are added. */
  groups?: readonly string[] | undefined;
}): Promise<StackPortsResult> {
  const cwd = composeCwd(options.deployRoot);
  const argv = composeArgv(['config', '--format', 'json'], options.project, options.groups, cwd);

  let stdout: string;
  try {
    ({ stdout } = await options.run(argv, { cwd, timeoutMs: CONFIG_TIMEOUT_MS }));
  } catch (error) {
    const message = failureText(error);
    return DOCKER_UNREACHABLE.test(message)
      ? { status: 'docker-unreachable', message }
      : { status: 'render-failed', message };
  }

  try {
    return { status: 'ok', ports: parseComposePorts(stdout) };
  } catch (error) {
    return { status: 'render-failed', message: error instanceof Error ? error.message : String(error) };
  }
}
