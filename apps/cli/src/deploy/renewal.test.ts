import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { CheckFs } from './checks/index.js';
import { CommandFailedError, type CommandResult, type RunCommandOptions } from './executor.js';
import {
  CERTBOT_IMAGE,
  CONTAINER_CERT_ROOT,
  CONTAINER_WEBROOT,
  containerProxyRuntime,
  hostProxyRuntime,
} from './proxy.js';
import { ensureRenewal, isCronSafePath, renderRenewalEntry } from './renewal.js';

const PROXY_ROOT = '/opt/infra/proxy';

type Canned = { exitCode: number; stdout?: string; stderr?: string };

function fakeRunCommand(
  respond: (argv: readonly string[]) => Canned,
): typeof import('./executor.js').runCommand {
  return (async (argv: readonly string[], options: RunCommandOptions): Promise<CommandResult> => {
    const canned = respond(argv);
    const result: CommandResult = {
      argv: [...argv],
      cwd: options.cwd,
      exitCode: canned.exitCode,
      stdout: canned.stdout ?? '',
      stderr: canned.stderr ?? '',
      durationMs: 1,
      timedOut: false,
    };
    if (result.exitCode !== 0) throw new CommandFailedError(result.stderr || 'failed', result);
    return result;
  }) as typeof import('./executor.js').runCommand;
}

/** Nothing on disk, so `findRenewalOwner` can only answer from the probes. */
const absentFs: CheckFs = {
  exists: () => false,
  isDirectory: () => false,
  isWritable: () => false,
};

/** No systemd timer, no crontab. The "nobody owns renewal" server. */
const unowned = fakeRunCommand(() => ({ exitCode: 1, stderr: 'no such unit' }));

function cronPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'appctl-cron-')), 'certbot');
}

describe('when something already owns renewal', () => {
  it('stands down and writes nothing', async () => {
    // A second schedule against the same certificates is not redundancy: it is
    // two processes renewing the same tree, spending a rate limit Let's
    // Encrypt counts per registered domain across every subdomain on the box.
    const path = cronPath();

    const result = await ensureRenewal({
      proxyRoot: PROXY_ROOT,
      runtime: containerProxyRuntime('proxy-nginx'),
      // `systemctl is-enabled certbot.timer` succeeding is an owner.
      runCommand: fakeRunCommand(() => ({ exitCode: 0, stdout: 'enabled' })),
      fs: absentFs,
      cronPath: path,
    });

    expect(result.action).toBe('stood-down');
    expect(result.owner?.mechanism).toBe('systemd-timer');
    expect(existsSync(path)).toBe(false);
  });

  it('says so, rather than being silent about having done nothing', async () => {
    const messages: string[] = [];

    await ensureRenewal({
      proxyRoot: PROXY_ROOT,
      runtime: hostProxyRuntime({ proxyRoot: PROXY_ROOT }),
      runCommand: fakeRunCommand(() => ({ exitCode: 0, stdout: 'enabled' })),
      fs: absentFs,
      cronPath: cronPath(),
      hooks: { onProgress: (message) => messages.push(message) },
    });

    expect(messages.join('\n')).toContain('already handled');
  });

  it('recognises a central script scheduled from root\'s crontab', async () => {
    const script = `${PROXY_ROOT}/renew-certs.sh`;
    const path = cronPath();

    const result = await ensureRenewal({
      proxyRoot: PROXY_ROOT,
      runtime: containerProxyRuntime('proxy-nginx'),
      runCommand: fakeRunCommand((argv) =>
        argv[0] === 'crontab'
          ? { exitCode: 0, stdout: `0 3 * * * ${script}\n` }
          : { exitCode: 1, stderr: 'no such unit' },
      ),
      fs: { ...absentFs, exists: (candidate) => candidate === script },
      cronPath: path,
    });

    expect(result.action).toBe('stood-down');
    expect(result.owner?.mechanism).toBe('central-script');
    expect(existsSync(path)).toBe(false);
  });
});

describe('when nothing owns renewal', () => {
  it('writes a twice-daily entry that renews AND reloads', async () => {
    const path = cronPath();

    const result = await ensureRenewal({
      proxyRoot: PROXY_ROOT,
      runtime: containerProxyRuntime('proxy-nginx'),
      runCommand: unowned,
      fs: absentFs,
      cronPath: path,
    });

    expect(result.action).toBe('installed');
    const contents = readFileSync(path, 'utf8');

    expect(contents).toContain('17 3,15 * * * root ');
    expect(contents).toContain(`${CERTBOT_IMAGE} renew --quiet`);
    // THE LOAD-BEARING HALF. nginx holds its certificate in memory: a renewal
    // that writes a new file and reloads nothing serves the old one until the
    // process restarts, which is exactly what `certificate-served` detects.
    expect(contents).toContain('docker exec proxy-nginx nginx -t');
    expect(contents).toContain('docker exec proxy-nginx nginx -s reload');
  });

  it('mounts the same paths the issuance does', async () => {
    const entry = renderRenewalEntry({
      proxyRoot: PROXY_ROOT,
      runtime: containerProxyRuntime('proxy-nginx'),
    });

    expect(entry).toContain(`-v ${PROXY_ROOT}/letsencrypt:${CONTAINER_CERT_ROOT}`);
    expect(entry).toContain(`-v ${PROXY_ROOT}/webroot:${CONTAINER_WEBROOT}`);
    // Never forces a webroot on `renew`: the proxy is shared, and overriding
    // it would break the renewals this tool did not issue.
    expect(entry).not.toContain('renew --quiet --webroot');
  });

  it('uses the host certbot and host nginx in host mode', async () => {
    const entry = renderRenewalEntry({
      proxyRoot: PROXY_ROOT,
      runtime: hostProxyRuntime({ proxyRoot: PROXY_ROOT }),
    });

    expect(entry).toContain(`certbot renew --quiet --config-dir ${PROXY_ROOT}/letsencrypt`);
    expect(entry).toContain('&& nginx -t && nginx -s reload');
    expect(entry).not.toContain('docker');
  });

  it('is idempotent: identical content at the same path is a no-op', async () => {
    const path = cronPath();
    const options = {
      proxyRoot: PROXY_ROOT,
      runtime: containerProxyRuntime('proxy-nginx'),
      runCommand: unowned,
      fs: absentFs,
      cronPath: path,
    };

    const first = await ensureRenewal(options);
    const written = readFileSync(path, 'utf8');
    const second = await ensureRenewal(options);

    expect(first.action).toBe('installed');
    expect(second.action).toBe('unchanged');
    expect(readFileSync(path, 'utf8')).toBe(written);
  });

  it('reports rather than throws when the entry cannot be written', async () => {
    // The site is published and healthy at this point; a server where
    // /etc/cron.d is not writable has a real problem, but not one worth
    // turning a successful deployment into a failed one over.
    // A regular FILE where the entry's directory should be: mkdir fails with
    // ENOTDIR, which is this sandbox's stand-in for /etc/cron.d being
    // unwritable on a server the install is not running as root on.
    const blocker = join(mkdtempSync(join(tmpdir(), 'appctl-cron-')), 'not-a-directory');
    writeFileSync(blocker, 'a file, not a directory\n');

    const result = await ensureRenewal({
      proxyRoot: PROXY_ROOT,
      runtime: containerProxyRuntime('proxy-nginx'),
      runCommand: unowned,
      fs: absentFs,
      cronPath: join(blocker, 'certbot'),
    });

    expect(result.action).toBe('failed');
    expect(result.detail).toContain('NOT renew');
  });

  it('refuses a proxy root that cannot be written into a cron line', async () => {
    const result = await ensureRenewal({
      proxyRoot: '/opt/my proxy',
      runtime: containerProxyRuntime('proxy-nginx'),
      runCommand: unowned,
      fs: absentFs,
      cronPath: cronPath(),
    });

    expect(result.action).toBe('failed');
  });
});

describe('isCronSafePath', () => {
  it('accepts an ordinary path and rejects one that would change the line', () => {
    expect(isCronSafePath('/opt/infra/proxy')).toBe(true);
    for (const path of ['', '/opt/my proxy', '/opt/proxy;rm -rf /', '/opt/100%proxy']) {
      expect(isCronSafePath(path)).toBe(false);
    }
  });
});
