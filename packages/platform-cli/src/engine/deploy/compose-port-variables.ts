import { splitPortSpec, type PublishedPort } from './compose-ports.js';

// =============================================================================
// Which environment variable sets a published host port?  (#1024)
// =============================================================================
//
// `docker compose config` returns the port already interpolated, so the
// variable behind `127.0.0.1:${GREPTIME_BIND_PG_PORT:-14003}:4003` is gone from
// it. A failed `stack-ports-free` check has to tell the operator WHICH `.env`
// key to change, and a hard-coded map would go stale the day an app overlay adds
// a port. So the answer is DERIVED from the compose files the run uses: read the
// raw `ports:` lists of the service, in file order, and pick the entry that
// evaluates to the port compose reported.
//
// Deliberately small, not a YAML parser: a line scan that understands what the
// generated and overlay files actually contain -- `services:`, a service key, a
// `ports:` key (with `!override` / `!reset` and `[]`), and short-syntax list
// items. A long-syntax item (`- target: 80`) is skipped; the caller then names
// the service instead of a variable, which is still a correct remedy.
// =============================================================================

/** One short-syntax entry of a service's `ports:` list, before interpolation. */
interface RawPortEntry {
  hostIp: string;
  published: string;
  protocol: string;
}

/** The `${NAME}` / `${NAME:-default}` / `$NAME` forms compose interpolates. */
const INTERPOLATION = /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?)([-?+])([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Compose's interpolation of one token against an environment. `${V:-d}` takes
 * `d` when V is unset OR empty, `${V-d}` only when unset, `${V:?m}` and
 * `${V?m}` keep the value (the failure is compose's to report), `${V:+a}`
 * yields `a` when V is set and non-empty.
 */
function interpolate(token: string, env: ReadonlyMap<string, string>): string {
  return token.replace(INTERPOLATION, (match, braced?: string, colon?: string, operator?: string, argument?: string, bare?: string) => {
    if (match === '$$') return '$';
    const name = braced ?? bare ?? '';
    const value = env.get(name);
    const unset = value === undefined || (colon === ':' && value === '');
    if (operator === '-') return unset ? (argument ?? '') : (value ?? '');
    if (operator === '+') return unset ? '' : (argument ?? '');
    return value ?? '';
  });
}

/** The first variable a token reads, if any. */
function variableOf(token: string): string | undefined {
  for (const match of token.matchAll(INTERPOLATION)) {
    const name = match[1] ?? match[5];
    if (name !== undefined) return name;
  }
  return undefined;
}

/** The leading whitespace width of a line. */
function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** A list item's value: the quoted string, else the text up to a trailing comment. */
function itemValue(line: string): string | undefined {
  const body = line.trimStart();
  if (!body.startsWith('-')) return undefined;
  const rest = body.slice(1).trim();
  const quoted = /^(["'])(.*?)\1/.exec(rest);
  if (quoted !== null) return quoted[2] ?? '';
  return rest.replace(/\s+#.*$/, '').trim();
}

/**
 * The raw `ports:` entries of `service` after applying every file in order:
 * `ports: !override` / `!reset` drops what the earlier files listed (as compose
 * does), a plain `ports:` adds to it.
 */
function rawPortsOf(service: string, texts: readonly string[]): RawPortEntry[] {
  let entries: RawPortEntry[] = [];

  for (const text of texts) {
    let inServices = false;
    let serviceIndent = -1;
    let inService = false;
    let portsIndent = -1; // >= 0 while inside this service's `ports:` list

    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;
      const indent = indentOf(line);

      if (indent === 0) {
        inServices = /^services:\s*(#.*)?$/.test(trimmed);
        inService = false;
        portsIndent = -1;
        continue;
      }
      if (!inServices) continue;

      // Leaving a `ports:` list: the first line that is not deeper than its key
      // (an item may sit at the key's own indent, which YAML allows).
      if (portsIndent >= 0 && (indent < portsIndent || (indent === portsIndent && !trimmed.startsWith('-')))) {
        portsIndent = -1;
      }

      if (portsIndent >= 0) {
        const value = itemValue(line);
        const split = value === undefined ? undefined : splitPortSpec(value);
        if (split !== undefined) entries.push(split);
        continue;
      }

      // The first key under `services:` fixes the indent of the service names.
      if (serviceIndent === -1) serviceIndent = indent;
      if (indent === serviceIndent) {
        const name = /^([A-Za-z0-9_.-]+):/.exec(trimmed)?.[1];
        inService = name === service;
        continue;
      }
      if (!inService) continue;

      const ports = /^ports:\s*(!override|!reset)?\s*(\[\s*\])?\s*(#.*)?$/.exec(trimmed);
      if (ports === null) continue;
      if (ports[1] !== undefined) entries = [];
      if (ports[2] === undefined) portsIndent = indent;
    }
  }
  return entries;
}

/** Whether an interpolated published token (`14003`, `8000-8010`) covers `port`. */
function covers(published: string, port: number): boolean {
  const [first = '', last = first] = published.trim().split('-');
  const low = Number(first);
  const high = Number(last);
  return Number.isInteger(low) && Number.isInteger(high) && low <= port && port <= high;
}

/**
 * The environment variable that sets the host port compose reported, or
 * `undefined` when the port is a literal in the files (or cannot be traced).
 *
 * @param options - The port, the compose files' text in the order compose
 *   merges them, and the environment compose interpolates with (the
 *   deployment's `.env`, then the process environment).
 * @returns the variable name, such as `GREPTIME_BIND_PG_PORT`.
 * @stability experimental
 */
export function portVariableFor(options: {
  port: PublishedPort;
  /** The text of each compose file, in merge order. */
  files: readonly string[];
  env: ReadonlyMap<string, string>;
}): string | undefined {
  const { port, files, env } = options;
  const wildcard = (ip: string): boolean => ip === '' || ip === '0.0.0.0' || ip === '::';

  const matching = rawPortsOf(port.service, files).filter((entry) => {
    const hostIp = interpolate(entry.hostIp, env).replace(/^\[|\]$/g, '');
    return (
      covers(interpolate(entry.published, env), port.port) &&
      entry.protocol === port.protocol &&
      (hostIp === port.hostIp || (wildcard(hostIp) && wildcard(port.hostIp)))
    );
  });
  // The last file wins, so the last matching entry names the variable.
  const last = matching[matching.length - 1];
  return last === undefined ? undefined : variableOf(last.published);
}
