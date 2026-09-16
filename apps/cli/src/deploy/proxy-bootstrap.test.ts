import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { UsageError } from '../errors.js';
import { CommandFailedError, type CommandResult, type RunCommandOptions } from './executor.js';
import {
  CONTAINER_CERT_ROOT,
  CONTAINER_WEBROOT,
  DEFAULT_PROXY_CONTAINER,
} from './proxy.js';
import {
  PROXY_COMPOSE_FILE,
  PROXY_DEFAULT_CONF,
  bootstrapProxy,
  ensureSharedNetwork,
  renderDefaultServer,
  renderProxyCompose,
} from './proxy-bootstrap.js';

type Canned = { exitCode: number; stdout?: string; stderr?: string };

interface Recorder {
  runCommand: typeof import('./executor.js').runCommand;
  calls: string[][];
}

function recorder(respond: (argv: readonly string[]) => Canned = () => ({ exitCode: 0 })): Recorder {
  const calls: string[][] = [];
  const runCommand = (async (
    argv: readonly string[],
    options: RunCommandOptions,
  ): Promise<CommandResult> => {
    calls.push([...argv]);
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

  return { runCommand, calls };
}

function tempRoot(): string {
  return join(mkdtempSync(join(tmpdir(), 'appctl-proxy-')), 'proxy');
}

describe('an existing proxy root', () => {
  it('is never touched, and nothing is run', async () => {
    // THE rule of this module: the directory belongs to whichever application
    // got here first, and a second install rewriting its compose file takes
    // every site on the box down.
    const proxyRoot = tempRoot();
    mkdirSync(proxyRoot, { recursive: true });
    const compose = join(proxyRoot, PROXY_COMPOSE_FILE);
    writeFileSync(compose, 'services: { somebody-elses-proxy: {} }\n');

    const { runCommand, calls } = recorder();
    const result = await bootstrapProxy({
      proxyRoot,
      runCommand,
      // Stated explicitly, so the test proves the DIRECTORY is what stops it -
      // not a missing confirmation.
      bootstrapProxy: true,
      confirm: async () => true,
    });

    expect(result.outcome).toBe('exists');
    expect(readFileSync(compose, 'utf8')).toBe('services: { somebody-elses-proxy: {} }\n');
    expect(calls).toEqual([]);
  });

  it('does not even ask the question', async () => {
    const proxyRoot = tempRoot();
    mkdirSync(proxyRoot, { recursive: true });
    let asked = false;

    await bootstrapProxy({
      proxyRoot,
      runCommand: recorder().runCommand,
      confirm: async () => {
        asked = true;
        return true;
      },
    });

    expect(asked).toBe(false);
  });
});

describe('bootstrapping a box that has no proxy', () => {
  it('creates the directories, the compose project and the default server', async () => {
    const proxyRoot = tempRoot();
    // A box with no proxy has no shared network either, so `inspect` fails.
    const { runCommand, calls } = recorder((argv) =>
      argv.includes('inspect') ? { exitCode: 1, stderr: 'no such network' } : { exitCode: 0 },
    );

    const result = await bootstrapProxy({ proxyRoot, runCommand, bootstrapProxy: true });

    expect(result.outcome).toBe('created');
    for (const directory of ['nginx/conf.d', 'nginx/snippets', 'letsencrypt', 'webroot']) {
      expect(existsSync(join(proxyRoot, directory))).toBe(true);
    }
    expect(existsSync(join(proxyRoot, PROXY_COMPOSE_FILE))).toBe(true);
    expect(existsSync(join(proxyRoot, 'nginx', 'conf.d', PROXY_DEFAULT_CONF))).toBe(true);

    // The network, then the stack. `-f` is deliberately absent: the working
    // directory is the proxy root and Compose finds compose.yml unaided.
    expect(calls.map((argv) => argv.join(' '))).toEqual([
      'docker network inspect proxy',
      'docker network create proxy',
      'docker compose up -d',
    ]);
  });

  it('refuses under --non-interactive without the flag, naming it', async () => {
    const proxyRoot = tempRoot();

    const error = await bootstrapProxy({
      proxyRoot,
      runCommand: recorder().runCommand,
      nonInteractive: true,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toContain('--bootstrap-proxy');
    expect(existsSync(proxyRoot)).toBe(false);
  });

  it('creates nothing when the operator declines', async () => {
    const proxyRoot = tempRoot();
    const { runCommand, calls } = recorder();

    const result = await bootstrapProxy({
      proxyRoot,
      runCommand,
      confirm: async () => false,
    });

    expect(result.outcome).toBe('declined');
    expect(existsSync(proxyRoot)).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('the rendered proxy project', () => {
  it('uses the exact container name and mount points the rest of the code assumes', () => {
    // If the vhost and the proxy disagree about a mount point, that is #389
    // reintroduced from the other end: each half internally consistent, the
    // two of them wrong together.
    const compose = renderProxyCompose();

    expect(compose).toContain(`container_name: ${DEFAULT_PROXY_CONTAINER}`);
    expect(compose).toContain(`./letsencrypt:${CONTAINER_CERT_ROOT}`);
    expect(compose).toContain(`./webroot:${CONTAINER_WEBROOT}`);
  });

  it('shares the host network, because every vhost proxies to 127.0.0.1', () => {
    // A bridge-networked proxy renders, validates and reloads perfectly, then
    // 502s every request: 127.0.0.1 inside the container is the container.
    expect(renderProxyCompose()).toContain('network_mode: host');
  });

  it('honours a custom container name', () => {
    expect(renderProxyCompose({ container: 'edge' })).toContain('container_name: edge');
  });

  it('serves the ACME challenge over plain HTTP from the webroot', () => {
    const conf = renderDefaultServer();

    expect(conf).toContain('location /.well-known/acme-challenge/');
    expect(conf).toContain(`root ${CONTAINER_WEBROOT};`);
    // Redirecting the challenge to HTTPS breaks every future renewal on the
    // box, which is why the default server must not have a blanket redirect.
    expect(conf).not.toContain('return 301');
  });
});

describe('ensureSharedNetwork', () => {
  it('creates the network when it is missing', async () => {
    const { runCommand, calls } = recorder((argv) =>
      argv.includes('inspect') ? { exitCode: 1, stderr: 'no such network' } : { exitCode: 0 },
    );

    expect(await ensureSharedNetwork({ runCommand, cwd: '/tmp' })).toBe('created');
    expect(calls).toHaveLength(2);
  });

  it('leaves an existing network alone', async () => {
    const { runCommand, calls } = recorder(() => ({ exitCode: 0, stdout: '[]' }));

    expect(await ensureSharedNetwork({ runCommand, cwd: '/tmp' })).toBe('exists');
    expect(calls).toHaveLength(1);
  });
});
