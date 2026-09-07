import { CLI_NAME } from '../branding.js';
import { ApiError, NetworkError } from '../errors.js';
import { probeCapabilities, evaluateCapabilities, isWritable, type CapabilityProbe } from './capabilities.js';
import { readLiveStatus } from './lifecycle.js';
import type { NodeApi } from './node-api.js';
import type { ResolvedNodeConfig } from './node-config.js';

// =============================================================================
// `node doctor`  (issue #276, epic #254)
// =============================================================================
//
// One command over THREE INDEPENDENT THINGS an operator routinely conflates:
//
//   1. local capabilities — can this machine do the work?
//   2. the server — can we reach it, and does it accept this credential?
//   3. the daemon — is a worker actually running here?
//
// They are independent by construction: a failure in one MUST NOT mask the
// others, because the common real-world case is two of them being wrong at
// once, and a doctor that stops at the first failure makes you run it three
// times to find that out.
//
// The most valuable distinction it draws is between "cannot reach the server"
// and "reached it and was refused". Those look identical in a stack trace and
// have completely different fixes — a firewall or a wrong URL on one side, a
// revoked credential or a missing permission on the other.
// =============================================================================

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface DoctorCheck {
  id: string;
  group: 'capabilities' | 'api' | 'daemon';
  label: string;
  status: CheckStatus;
  detail: string;
  /** What to do about it. Only present when there is something to do. */
  action?: string | undefined;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
  probe: CapabilityProbe;
}

export interface DoctorOptions {
  config: ResolvedNodeConfig;
  socketPath: string;
  pidPath: string;
  stateDir: string;
  /** Injected so `doctor` needs neither a network nor a running daemon in tests. */
  api?: NodeApi | undefined;
  probe?: CapabilityProbe | undefined;
  readStatus?: typeof readLiveStatus | undefined;
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const probe = options.probe ?? probeCapabilities();

  // ---- 1. Capabilities -------------------------------------------------------
  checks.push({
    id: 'runtime',
    group: 'capabilities',
    label: 'Node.js runtime',
    status: 'pass',
    detail: `${probe.nodeVersion} on ${probe.platform}/${probe.arch}, ${probe.cpus} CPU(s), ${probe.totalMemoryMb} MB RAM`,
  });

  const selfTest = evaluateCapabilities(options.config.node.eligibleTypes, probe);
  checks.push({
    id: 'job-capabilities',
    group: 'capabilities',
    label: 'Capabilities for the advertised job types',
    status: selfTest.ok ? (selfTest.missingDegradable.length > 0 ? 'warn' : 'pass') : 'fail',
    detail: selfTest.ok
      ? selfTest.missingDegradable.length > 0
        ? `Reduced function: ${selfTest.missingDegradable.map((gap) => `${gap.capability} (${gap.type})`).join(', ')}`
        : 'Every advertised type has what it needs'
      : `Missing: ${selfTest.missingRequired.map((gap) => `${gap.capability} (${gap.type})`).join(', ')}`,
    action: selfTest.ok
      ? undefined
      : `Install the missing dependencies, or drop those types with \`${CLI_NAME} node register --types ...\`.`,
  });

  checks.push({
    id: 'state-dir',
    group: 'capabilities',
    label: 'State directory is writable',
    status: isWritable(options.stateDir) ? 'pass' : 'warn',
    detail: options.stateDir,
    action: isWritable(options.stateDir)
      ? undefined
      : 'The worker will still run, but cannot persist its node id, logs or heap snapshots.',
  });

  // ---- 2. The server ---------------------------------------------------------
  // Each API check is separate, and a failure in one does not skip the rest.
  if (options.api === undefined) {
    checks.push({
      id: 'api-auth',
      group: 'api',
      label: 'Server reachable and credential accepted',
      status: 'skip',
      detail: 'No API client was supplied',
    });
  } else {
    const auth = await checkApi(options.api, options.config);
    checks.push(...auth);
  }

  // ---- 3. The daemon ---------------------------------------------------------
  const readStatus = options.readStatus ?? readLiveStatus;
  const status = await readStatus({ socketPath: options.socketPath, pidPath: options.pidPath, timeoutMs: 1_000 });
  checks.push({
    id: 'daemon',
    group: 'daemon',
    label: 'Worker running on this machine',
    status: status.live ? 'pass' : 'warn',
    detail: status.live
      ? `Running (${status.snapshot?.status}, concurrency ${status.snapshot?.concurrency}, ` +
        `${status.snapshot?.activeJobs.length ?? 0} active)`
      : status.pid !== undefined
        ? `A process (pid ${status.pid}) holds the pidfile but is not answering on the control socket`
        : 'No worker is running here',
    action: status.live ? undefined : `Start one with \`${CLI_NAME} node start\`.`,
  });

  return { checks, ok: checks.every((check) => check.status !== 'fail'), probe };
}

/**
 * Reachability, authentication and authorization — as THREE ANSWERS, not one.
 *
 * `GET /api/nodes` rather than `/api/auth/me`, deliberately: a `nod_`
 * credential is refused everywhere outside `/api/nodes/*`, so probing
 * `/auth/me` would report a perfectly good worker credential as forbidden and
 * send the operator to fix something that is working exactly as designed.
 */
async function checkApi(api: NodeApi, config: ResolvedNodeConfig): Promise<DoctorCheck[]> {
  try {
    await api.listNodes();
  } catch (error) {
    if (error instanceof NetworkError) {
      return [
        {
          id: 'api-reachable',
          group: 'api',
          label: 'Server reachable',
          status: 'fail',
          detail: `Could not reach ${config.serverUrl}: ${error.message}`,
          action: 'Check the URL, DNS, and whether anything is blocking outbound HTTPS from this machine.',
        },
      ];
    }

    if (error instanceof ApiError) {
      // REACHED IT AND WAS REFUSED — a completely different fix from the above.
      const status: CheckStatus = 'fail';
      if (error.status === 401) {
        return [
          reachable(config),
          {
            id: 'api-auth',
            group: 'api',
            label: 'Credential accepted',
            status,
            detail: 'The server rejected this credential (401). It may be revoked, expired, or from another server.',
            action: `Run \`${CLI_NAME} node enroll\` to mint a new node credential.`,
          },
        ];
      }
      if (error.status === 403) {
        return [
          reachable(config),
          {
            id: 'api-permission',
            group: 'api',
            label: 'Credential has the node permissions',
            status,
            detail: 'Authenticated, but refused (403) — the account is missing `nodes:read`/`nodes:write`.',
            action: 'Ask an administrator to grant the node permissions to this account.',
          },
        ];
      }
      if (error.status === 404) {
        return [
          reachable(config),
          {
            id: 'api-support',
            group: 'api',
            label: 'Server supports worker nodes',
            status,
            detail: `${config.serverUrl} has no /api/nodes routes (404) — it predates worker nodes.`,
            action: 'Upgrade the server.',
          },
        ];
      }
      return [
        reachable(config),
        {
          id: 'api-auth',
          group: 'api',
          label: 'Credential accepted',
          status,
          detail: `The server answered ${error.status}: ${error.message}`,
        },
      ];
    }

    return [
      {
        id: 'api-reachable',
        group: 'api',
        label: 'Server reachable',
        status: 'fail',
        detail: error instanceof Error ? error.message : String(error),
      },
    ];
  }

  return [
    reachable(config),
    {
      id: 'api-auth',
      group: 'api',
      label: 'Credential accepted',
      status: 'pass',
      detail: `Authenticated against ${config.serverUrl} (token from ${config.tokenSource}).`,
    },
  ];
}

function reachable(config: ResolvedNodeConfig): DoctorCheck {
  return {
    id: 'api-reachable',
    group: 'api',
    label: 'Server reachable',
    status: 'pass',
    detail: config.serverUrl,
  };
}

const SYMBOL: Record<CheckStatus, string> = { pass: '✓', warn: '!', fail: '✗', skip: '·' };

/** Render the report as a table. Human output, so it goes to stderr. */
export function formatDoctorReport(report: DoctorReport): string {
  const width = Math.max(...report.checks.map((check) => check.label.length));
  const lines: string[] = [];
  let group: DoctorCheck['group'] | '' = '';

  for (const check of report.checks) {
    if (check.group !== group) {
      group = check.group;
      lines.push('', GROUP_TITLES[group]);
    }
    lines.push(`  ${SYMBOL[check.status]} ${check.label.padEnd(width)}  ${check.detail}`);
    if (check.action !== undefined) lines.push(`  ${' '.repeat(width + 3)}→ ${check.action}`);
  }

  lines.push('', report.ok ? 'No blocking problems found.' : 'At least one check failed.');
  return `${lines.join('\n')}\n`;
}

const GROUP_TITLES: Record<DoctorCheck['group'], string> = {
  capabilities: 'This machine',
  api: 'The server',
  daemon: 'The worker',
};
