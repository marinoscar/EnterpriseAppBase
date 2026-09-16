import { readFileSync } from 'node:fs';
import { arch, cpus, hostname, networkInterfaces, release, totalmem, type } from 'node:os';

import { runCommand as defaultRunCommand } from './executor.js';
import type { DeployHostFacts } from './state.js';

// =============================================================================
// Which machine is this?  (issue #392, epic #388)
// =============================================================================
//
// The state file records what was deployed; this records WHERE. An operator
// looking at the deployments page is usually trying to answer "is this the
// box I think it is, and does it have enough of anything" - which is hostname,
// distribution, kernel, architecture, cores, memory, and the two runtimes the
// whole deployment rests on.
//
// THREE RULES, AND THEY ARE THE ENTIRE DESIGN:
//
//   1. THIS FUNCTION NEVER THROWS. It is called at the very end of a
//      successful install or update, after images are built, migrations are
//      applied and the stack is healthy. A deployment that did all of that and
//      then reported failure because `docker compose version` was slow would
//      be an absurd outcome, and worse, the operator's next move would be to
//      re-run the whole thing. This is diagnostic metadata, not a
//      prerequisite. `resolveProxyRuntime` states the same contract for the
//      same kind of reason.
//   2. EVERY PROBE IS INDEPENDENT. One failure loses one field, never the
//      rest. A host with no /etc/os-release still knows its own core count.
//      A failed probe records `unknown` rather than dropping its field, so
//      the shape the API validates does not vary with how much of the machine
//      happened to be readable.
//   3. NO OUTBOUND REQUEST IS MADE TO LEARN THE PUBLIC ADDRESS. See
//      `collectPublicIp`.
//
// Everything reachable is read through the injected `runCommand` or through
// node:fs, so the whole module is exercised without a Docker daemon.
// =============================================================================

/**
 * Recorded when a probe cannot answer.
 *
 * A sentinel rather than an omission: `DeployHostFacts` keeps these members
 * required so the API validates one shape, and "unknown" reads correctly in a
 * table where the alternative is a blank cell that could equally mean a bug.
 */
const UNKNOWN = 'unknown';

/** Long enough for a cold `docker compose`, short enough not to stall a deploy. */
const PROBE_TIMEOUT_MS = 15_000;

const OS_RELEASE_PATH = '/etc/os-release';

export interface CollectHostFactsOptions {
  runCommand: typeof defaultRunCommand;
  /** Overridden by the tests; there is no reason for a caller to set it. */
  osReleasePath?: string | undefined;
}

/** Runs a command purely for its stdout. Never throws, never rejects. */
async function probe(
  options: CollectHostFactsOptions,
  argv: readonly string[],
): Promise<string | undefined> {
  try {
    const result = await options.runCommand(argv, {
      cwd: process.cwd(),
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    const value = result.stdout.trim();
    return value === '' ? undefined : value;
  } catch {
    // Not installed, daemon unreachable, timed out, permission denied: every
    // one of those means "this host will not tell us", which is a field, not
    // a failure.
    return undefined;
  }
}

/**
 * `PRETTY_NAME=...` out of an os-release file. Exported for its test.
 *
 * os-release is shell-ish: values may be bare, double-quoted or single-quoted,
 * and PRETTY_NAME is the one line in it written to be shown to a person.
 */
export function parsePrettyName(content: string): string | undefined {
  for (const line of content.split('\n')) {
    const match = /^\s*PRETTY_NAME\s*=\s*(.*)$/.exec(line);
    const raw = match?.[1]?.trim();
    if (raw === undefined || raw === '') continue;

    const unquoted = /^"(.*)"$/.exec(raw) ?? /^'(.*)'$/.exec(raw);
    const value = (unquoted?.[1] ?? raw).trim();
    if (value !== '') return value;
  }
  return undefined;
}

/**
 * The distribution's own name for itself, or the kernel's.
 *
 * The fallback is deliberately not `UNKNOWN`: node:os always answers, and
 * "Linux 6.8.0-45-generic" is a genuinely useful thing to have recorded from a
 * host that simply has no /etc/os-release (a container, or a BSD).
 */
function collectOsName(options: CollectHostFactsOptions): string {
  try {
    const pretty = parsePrettyName(
      readFileSync(options.osReleasePath ?? OS_RELEASE_PATH, 'utf8'),
    );
    if (pretty !== undefined) return pretty;
  } catch {
    // No such file, or unreadable. Both fall through to the kernel's answer.
  }

  try {
    return `${type()} ${release()}`.trim();
  } catch {
    return UNKNOWN;
  }
}

/** The `src` address from `ip route get`. Exported for its test. */
export function parseRouteSource(output: string): string | undefined {
  const match = /\bsrc\s+(\S+)/.exec(output);
  return match?.[1];
}

/**
 * Can the internet reach back on this address?
 *
 * Everything private, loopback, link-local, carrier-grade-NAT or multicast is
 * rejected, because recording a LAN address in a field called `publicIp` is
 * worse than recording nothing: it looks like an answer. Exported for its
 * test, which is where the range boundaries are pinned.
 */
export function isRoutableAddress(address: string): boolean {
  if (address.includes(':')) {
    // Global unicast is 2000::/3. Everything else a host holds - ::1, fe80::/10
    // link-local, fc00::/7 unique-local - is not reachable from outside.
    const head = Number.parseInt(address.split(':')[0] ?? '', 16);
    return Number.isFinite(head) && head >= 0x2000 && head <= 0x3fff;
  }

  const octets = address.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return false;

  const [a = -1, b = -1] = octets;

  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  // 224.0.0.0/4 multicast and everything above it, which includes 255/8.
  if (a >= 224) return false;

  return true;
}

/**
 * The address this server is reachable on, if it can be known LOCALLY.
 *
 * `ip route get` is asked first because it names the address the DEFAULT ROUTE
 * leaves from, which is the one that matters on a host with several
 * interfaces; node:os can only list them all. Despite appearances it SENDS
 * NOTHING - it is a routing-table lookup in the kernel, and 1.1.1.1 is just an
 * off-link destination to resolve a route for. It answers instantly on an
 * air-gapped host.
 *
 * THERE IS DELIBERATELY NO CALL TO AN EXTERNAL IP-ECHO SERVICE, which is the
 * obvious way to get this right behind NAT. A deploy tool that quietly makes
 * an outbound request to a third party is a surprise an operator should not
 * have to discover from `tcpdump`, it hands that third party a log of every
 * deployment, and it hangs or fails on exactly the isolated hosts this is most
 * likely to run on. Behind NAT the field is simply absent, and absent is an
 * honest answer.
 */
async function collectPublicIp(
  options: CollectHostFactsOptions,
): Promise<string | undefined> {
  const candidates: string[] = [];

  const route = await probe(options, ['ip', '-4', 'route', 'get', '1.1.1.1']);
  const source = route === undefined ? undefined : parseRouteSource(route);
  if (source !== undefined) candidates.push(source);

  try {
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (!entry.internal) candidates.push(entry.address);
      }
    }
  } catch {
    // Nothing to add; the route probe may still have answered.
  }

  // The default route's address wins when it is routable; otherwise a public
  // address on any other interface is still better than nothing.
  return candidates.find((candidate) => isRoutableAddress(candidate));
}

/**
 * Everything worth recording about this machine.
 *
 * Returns undefined only when node:os itself cannot answer - the case where
 * every field would be a sentinel and writing the block would assert a machine
 * we know nothing about. A single failed probe never gets here.
 */
export async function collectHostFacts(
  options: CollectHostFactsOptions,
): Promise<DeployHostFacts | undefined> {
  let identity: Pick<DeployHostFacts, 'hostname' | 'kernel' | 'arch' | 'cpus' | 'memoryBytes'>;
  try {
    identity = {
      hostname: hostname(),
      kernel: release(),
      arch: arch(),
      cpus: cpus().length,
      memoryBytes: totalmem(),
    };
  } catch {
    return undefined;
  }

  // In parallel because they are three independent subprocesses at the end of
  // a deploy that has already taken minutes. None of these can reject - see
  // `probe` and rule 1 - so there is no aggregate failure to handle here.
  const [dockerVersion, composeVersion, publicIp] = await Promise.all([
    probe(options, ['docker', 'version', '--format', '{{.Server.Version}}']),
    probe(options, ['docker', 'compose', 'version', '--short']),
    collectPublicIp(options),
  ]);

  return {
    ...identity,
    os: collectOsName(options),
    dockerVersion: dockerVersion ?? UNKNOWN,
    composeVersion: composeVersion ?? UNKNOWN,
    ...(publicIp === undefined ? {} : { publicIp }),
  };
}
