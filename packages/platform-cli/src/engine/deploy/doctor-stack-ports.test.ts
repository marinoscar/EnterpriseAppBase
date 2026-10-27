import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runDoctorCommand } from '../commands/deploy.js';
import { allChecks } from './checks/index.js';
import { composeCwd } from './compose-command.js';
import { composeFilesFor } from './compose-files.js';
import { DEPLOY_STATE_VERSION, writeState, type DeployState } from './state.js';
import { inspectOutput, psOutput, type FakeContainer } from './testing/fake-containers.js';
import { createFakeVps } from './testing/fake-vps.js';

// =============================================================================
// `deploy doctor` reports the stack's host ports  (#1024)
// =============================================================================
//
// Doctor runs the whole registry, so the check is in it without being listed
// anywhere; this proves the command's own context carries what the check needs
// (the recorded project and groups, the deployment's folder) and that a clash
// fails the run with the holder named.
// =============================================================================

const INFRA = resolve(__dirname, '..', '..', '..', '..', '..', 'infra', 'compose');
const NEEDED = ['docker-installed', 'docker-daemon', 'docker-compose-v2', 'stack-ports-free'];

/** The error a promise rejects with; a promise that resolves is a failed test. */
async function rejected(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the promise to reject');
}

describe('deploy doctor and stack-ports-free', () => {
  it('runs it, fails on a port another stack holds, and prints the variable that moves it', async () => {
    const compose = Object.fromEntries(
      composeFilesFor(undefined, INFRA).map((name) => [`repo/infra/compose/${name}`, readFileSync(join(INFRA, name), 'utf8')]),
    );
    const vps = createFakeVps({ withCheckout: true, files: compose });
    writeState({
      version: DEPLOY_STATE_VERSION,
      repoUrl: 'https://example.test/o/r',
      ref: 'main',
      commitSha: 'a'.repeat(40),
      bindPort: 3535,
      deployRoot: vps.deployRoot,
      composeProject: 'kvox',
      installedAt: '2026-01-01T00:00:00.000Z',
      lastDeployedAt: '2026-01-02T00:00:00.000Z',
      lastCommand: 'install',
      appctlVersion: '1.0.0',
    } as DeployState);
    const entry = (published: number, target: number) => ({ host_ip: '127.0.0.1', target, published: String(published), protocol: 'tcp' });
    const containers: FakeContainer[] = [
      { project: 'kvox', workingDir: composeCwd(vps.deployRoot), name: 'kvox-nginx-1', ports: [{ hostIp: '127.0.0.1', port: 3535 }] },
      { project: 'other', workingDir: '/opt/infra/apps/other/repo/infra/compose', name: 'other-greptimedb-1', ports: [{ hostIp: '127.0.0.1', port: 14003 }] },
    ];
    vps.route(['docker', 'ps', '-aq'], () => psOutput(containers));
    vps.route(['docker', 'inspect', '--format'], () => inspectOutput(containers));
    vps.route(
      ({ argv }) => argv[0] === 'docker' && argv[1] === 'compose' && argv.slice(-3).join(' ') === 'config --format json',
      () => JSON.stringify({ services: { nginx: { ports: [entry(3535, 80)] }, greptimedb: { ports: [entry(14003, 4003)] } } }),
    );
    const out: string[] = [];

    const failure = await rejected(
      runDoctorCommand(
      { root: vps.deployRoot, proxyRoot: join(vps.appsRoot, 'proxy'), port: '3535', json: true, color: false },
      {
        checks: allChecks().filter((check) => NEEDED.includes(check.id)),
        runCommand: vps.runCommand,
        stdout: { write: (chunk: string) => out.push(chunk) },
        stderr: { write: () => undefined },
      },
    ),
    );

    expect(failure.message).toContain('stack-ports-free');
    const report = JSON.parse(out.join('')) as { ok: boolean; checks: Array<{ id: string; status: string; severity: string; detail: string; remedy?: string }> };
    const result = report.checks.find((check) => check.id === 'stack-ports-free');
    expect(report.ok).toBe(false);
    expect(result).toMatchObject({ status: 'fail', severity: 'required' });
    expect(result?.detail).toContain('127.0.0.1:14003');
    expect(result?.detail).toContain('other-greptimedb-1');
    expect(result?.remedy).toContain('GREPTIME_BIND_PG_PORT');
    // Read-only: doctor changed nothing.
    expect(vps.calls('docker', 'compose').every((call) => call.argv.includes('config') || call.argv.includes('version'))).toBe(true);
  });

  it('is part of the registry doctor and the install preflight draw from', () => {
    expect(allChecks().map((check) => check.id)).toContain('stack-ports-free');
  });
});
