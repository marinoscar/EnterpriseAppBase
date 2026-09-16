import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { UsageError } from '../errors.js';
import { CommandFailedError, type CommandResult, type RunCommandOptions } from './executor.js';
import {
  assertValidDomain,
  certificateStatus,
  CERTBOT_IMAGE,
  CONTAINER_CERT_ROOT,
  CONTAINER_WEBROOT,
  containerProxyRuntime,
  hostProxyRuntime,
  installVhost,
  issueCertificate,
  livePath,
  reloadProxy,
  removeVhost,
  renderVhost,
  resolveProxyRuntime,
  servedCertPath,
  validateProxy,
  vhostPath,
  type ProxyTarget,
} from './proxy.js';

type Canned = { exitCode: number; stdout?: string; stderr?: string };

function fakeRunCommand(
  respond: (argv: readonly string[]) => Canned | undefined,
  log?: string[][],
): typeof import('./executor.js').runCommand {
  return (async (argv: readonly string[], options: RunCommandOptions): Promise<CommandResult> => {
    log?.push([...argv]);
    const canned = respond(argv) ?? { exitCode: 0 };
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

function makeProxyRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'appctl-proxy-'));
  mkdirSync(join(root, 'nginx', 'conf.d'), { recursive: true });
  mkdirSync(join(root, 'webroot'), { recursive: true });
  return root;
}

function target(proxyRoot: string): ProxyTarget {
  return { domain: 'app.example.test', bindPort: 3535, proxyRoot };
}

/** These cases predate #389 and describe the host setup, where the host and
 * served path spaces coincide. The container cases live in their own tests. */
function hostRuntime(proxyRoot: string) {
  return hostProxyRuntime({ proxyRoot });
}

describe('assertValidDomain', () => {
  it('accepts a normal hostname', () => {
    expect(() => assertValidDomain('app.example.test')).not.toThrow();
  });

  it.each([
    'has spaces.example',
    'semi;colon.example',
    'new\nline.example',
    '../escape',
    '-leading-hyphen.example',
    '',
  ])('rejects %j before it reaches a config file', (domain) => {
    // Not a shell, but a newline in a domain would let a vhost be extended
    // with arbitrary directives - the same class of problem.
    expect(() => assertValidDomain(domain)).toThrow(UsageError);
  });
});

describe('renderVhost', () => {
  const root = makeProxyRoot();
  const rendered = renderVhost(target(root), hostRuntime(root));

  it('redirects HTTP to HTTPS', () => {
    expect(rendered).toContain('return 301 https://$host$request_uri;');
  });

  it('keeps the ACME challenge on HTTP so renewal keeps working', () => {
    const acme = rendered.indexOf('/.well-known/acme-challenge/');
    const redirect = rendered.indexOf('return 301');

    expect(acme).toBeGreaterThan(-1);
    // It must come BEFORE the catch-all redirect, or renewal 301s away.
    expect(acme).toBeLessThan(redirect);
  });

  it('proxies to the loopback port', () => {
    expect(rendered).toContain('proxy_pass http://127.0.0.1:3535;');
  });

  it('sets X-Forwarded-Proto to https, not $scheme', () => {
    // The application forwards $scheme onward, so this is the value it
    // ultimately sees; $scheme here would make it build http:// URLs and the
    // OAuth login redirect would loop.
    expect(rendered).toContain('proxy_set_header X-Forwarded-Proto https;');
  });

  it('adds no headers of its own', () => {
    // nginx's add_header REPLACES the inherited set, so any header here would
    // silently delete the application's CSP and HSTS.
    expect(rendered).not.toContain('add_header');
  });

  it('gives the SSE endpoint its own unbuffered block', () => {
    expect(rendered).toContain('/api/notifications/stream');
    expect(rendered).toContain('proxy_buffering off;');
    expect(rendered).toContain('proxy_read_timeout 1h;');
  });

  it('is deterministic, so a re-run produces no spurious diff', () => {
    expect(renderVhost(target(root), hostRuntime(root))).toBe(rendered);
  });

  it('sizes client_max_body_size from the configured upload limit', () => {
    const sized = renderVhost(target(root), hostRuntime(root), {
      maxBodyBytes: 10 * 1024 * 1024,
    });
    expect(sized).toContain('client_max_body_size 10m;');
  });

  it('refuses a hostile domain', () => {
    expect(() => renderVhost({ ...target(root), domain: 'a b;c' }, hostRuntime(root))).toThrow(
      UsageError,
    );
  });
});

// =============================================================================
// Regression tests for issue #389: a container-mode vhost/certbot invocation
// must never contain a host path, and host mode must stay exactly as it was.
// =============================================================================

describe('renderVhost in container mode (issue #389)', () => {
  it('contains no host path', () => {
    const root = makeProxyRoot();
    const runtime = containerProxyRuntime('proxy-nginx');
    const rendered = renderVhost(target(root), runtime);

    // The host proxy root must never leak into a config the container-mode
    // nginx has to resolve; it has no such directory.
    expect(rendered).not.toContain(root);
    expect(rendered).toContain(`root ${CONTAINER_WEBROOT};`);
    expect(rendered).toContain(
      `ssl_certificate     ${CONTAINER_CERT_ROOT}/live/app.example.test/fullchain.pem;`,
    );
    expect(rendered).toContain(
      `ssl_certificate_key ${CONTAINER_CERT_ROOT}/live/app.example.test/privkey.pem;`,
    );
  });

  it('still renders host paths in host mode, unchanged', () => {
    const root = makeProxyRoot();
    const rendered = renderVhost(target(root), hostRuntime(root));

    expect(rendered).toContain(`root ${join(root, 'webroot')};`);
    expect(rendered).toContain(
      `ssl_certificate     ${join(root, 'letsencrypt', 'live', 'app.example.test', 'fullchain.pem')};`,
    );
    expect(rendered).toContain(
      `ssl_certificate_key ${join(root, 'letsencrypt', 'live', 'app.example.test', 'privkey.pem')};`,
    );
  });
});

describe('servedCertPath vs livePath (issue #389)', () => {
  it('coincide in host mode', () => {
    const root = makeProxyRoot();
    const t = target(root);

    expect(servedCertPath(hostRuntime(root), t.domain, 'fullchain.pem')).toBe(
      livePath(t, 'fullchain.pem'),
    );
  });

  it('diverge in container mode', () => {
    const root = makeProxyRoot();
    const t = target(root);

    const served = servedCertPath(containerProxyRuntime('proxy-nginx'), t.domain, 'fullchain.pem');
    const host = livePath(t, 'fullchain.pem');

    expect(served).not.toBe(host);
    expect(served).toBe(`${CONTAINER_CERT_ROOT}/live/app.example.test/fullchain.pem`);
  });
});

describe('resolveProxyRuntime (issue #389)', () => {
  it('an explicit proxyMode wins without probing', async () => {
    const calls: string[][] = [];
    const runtime = await resolveProxyRuntime(
      { proxyRoot: '/opt/infra/proxy' },
      { runCommand: fakeRunCommand(() => ({ exitCode: 0, stdout: 'true' }), calls), proxyMode: 'host' },
    );

    expect(runtime.mode).toBe('host');
    expect(calls).toEqual([]);
  });

  it('a running container probes to container mode', async () => {
    const runtime = await resolveProxyRuntime(
      { proxyRoot: '/opt/infra/proxy' },
      { runCommand: fakeRunCommand(() => ({ exitCode: 0, stdout: 'true' })) },
    );

    expect(runtime.mode).toBe('container');
    expect(runtime.container).toBe('proxy-nginx');
  });

  it('a stopped container resolves to host mode', async () => {
    const runtime = await resolveProxyRuntime(
      { proxyRoot: '/opt/infra/proxy' },
      { runCommand: fakeRunCommand(() => ({ exitCode: 0, stdout: 'false' })) },
    );

    expect(runtime.mode).toBe('host');
  });

  it('a missing container (docker inspect fails) resolves to host mode', async () => {
    const runtime = await resolveProxyRuntime(
      { proxyRoot: '/opt/infra/proxy' },
      {
        runCommand: fakeRunCommand(() => ({
          exitCode: 1,
          stderr: 'Error: No such object: proxy-nginx',
        })),
      },
    );

    expect(runtime.mode).toBe('host');
  });

  it('a runCommand that throws resolves to host mode rather than propagating', async () => {
    const throwing: typeof import('./executor.js').runCommand = (async () => {
      throw new Error('docker not installed');
    }) as typeof import('./executor.js').runCommand;

    await expect(
      resolveProxyRuntime({ proxyRoot: '/opt/infra/proxy' }, { runCommand: throwing }),
    ).resolves.toEqual(expect.objectContaining({ mode: 'host' }));
  });

  it('never throws, across every scenario above', async () => {
    const scenarios: Array<typeof import('./executor.js').runCommand> = [
      fakeRunCommand(() => ({ exitCode: 0, stdout: 'true' })),
      fakeRunCommand(() => ({ exitCode: 0, stdout: 'false' })),
      fakeRunCommand(() => ({ exitCode: 1, stderr: 'no such object' })),
      (async () => {
        throw new Error('boom');
      }) as typeof import('./executor.js').runCommand,
    ];

    for (const runCommand of scenarios) {
      await expect(
        resolveProxyRuntime({ proxyRoot: '/opt/infra/proxy' }, { runCommand }),
      ).resolves.toBeDefined();
    }
  });

  it('respects a custom --proxy-container name when probing', async () => {
    const calls: string[][] = [];
    await resolveProxyRuntime(
      { proxyRoot: '/opt/infra/proxy' },
      {
        runCommand: fakeRunCommand(() => ({ exitCode: 0, stdout: 'true' }), calls),
        proxyContainer: 'infra-proxy-1',
      },
    );

    expect(calls[0]).toContain('infra-proxy-1');
    expect(calls[0]).not.toContain('proxy-nginx');
  });
});

describe('installVhost/validateProxy/reloadProxy target the right runtime (issue #389)', () => {
  it('container runtime uses docker exec for both validate and reload', async () => {
    const root = makeProxyRoot();
    const calls: string[][] = [];

    await installVhost(target(root), {
      runCommand: fakeRunCommand(() => ({ exitCode: 0 }), calls),
      runtime: containerProxyRuntime('proxy-nginx'),
    });

    expect(calls.map((argv) => argv.join(' '))).toEqual([
      'docker exec proxy-nginx nginx -t',
      'docker exec proxy-nginx nginx -s reload',
    ]);
  });

  it('host runtime uses the bare binary, unchanged', async () => {
    const root = makeProxyRoot();
    const calls: string[][] = [];

    await installVhost(target(root), {
      runCommand: fakeRunCommand(() => ({ exitCode: 0 }), calls),
      runtime: hostRuntime(root),
    });

    expect(calls.map((argv) => argv.join(' '))).toEqual(['nginx -t', 'nginx -s reload']);
  });

  it('reloadProxy alone also targets the container from the runtime', async () => {
    const calls: string[][] = [];

    await reloadProxy({
      runCommand: fakeRunCommand(() => ({ exitCode: 0 }), calls),
      runtime: containerProxyRuntime('proxy-nginx'),
    });

    expect(calls[0]).toEqual(['docker', 'exec', 'proxy-nginx', 'nginx', '-s', 'reload']);
  });

  it('rolls back a container-mode vhost that fails nginx -t, via docker exec', async () => {
    const root = makeProxyRoot();
    let validations = 0;

    const error = await installVhost(target(root), {
      runtime: containerProxyRuntime('proxy-nginx'),
      runCommand: fakeRunCommand((argv) => {
        if (argv.join(' ') === 'docker exec proxy-nginx nginx -t') {
          validations += 1;
          return validations === 1
            ? { exitCode: 1, stderr: 'nginx: [emerg] invalid parameter' }
            : { exitCode: 0 };
        }
        return { exitCode: 0 };
      }),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UsageError);
    // The proxy must be left exactly as it was found, same as in host mode.
    expect(existsSync(vhostPath(target(root)))).toBe(false);
  });
});

// =============================================================================
// KNOWN DEFECT, found while writing coverage for #389, NOT fixed here per the
// scope of this pass (tests only). Reported alongside this test suite.
//
// `runtimeFor()` (what renderVhost/installVhost use) ONLY reads
// `options.runtime`, and falls back to host mode when it is absent — it never
// looks at the deprecated `options.proxyContainer`. `containerFor()` (what
// validateProxy/reloadProxy use) reads `options.runtime?.container` FIRST but
// falls back to `options.proxyContainer` when there is no runtime.
//
// So a caller of `installVhost` that sets only the deprecated `proxyContainer`
// field (no `runtime`) gets a vhost rendered with HOST paths, validated and
// reloaded by `docker exec`-ing INTO the container — reproducing issue #389
// exactly, through the field whose own JSDoc claims callers "work unchanged".
// The claim held for a caller that only ever wanted `docker exec` from
// validateProxy/reloadProxy directly; it does not hold for `installVhost`,
// which also renders paths from the very same options.
// =============================================================================
describe('KNOWN DEFECT: the deprecated proxyContainer field alone still reproduces #389', () => {
  it.fails(
    'installVhost renders host paths while validateProxy targets the container, when only the deprecated proxyContainer field is set',
    async () => {
      const root = makeProxyRoot();
      const calls: string[][] = [];

      const result = await installVhost(target(root), {
        runCommand: fakeRunCommand(() => ({ exitCode: 0 }), calls),
        // Deprecated field, no `runtime` — exactly the shape the old
        // "uses docker exec when the proxy is containerised" test below uses.
        proxyContainer: 'infra-proxy-1',
      });

      const rendered = readFileSync(result.path, 'utf8');

      // What SHOULD be true: a vhost validated inside a container must never
      // contain a host path (this is the entire point of #389). It currently
      // does, because renderVhost fell back to host mode.
      expect(rendered).not.toContain(root);
      // And validation targets the container this vhost was never rendered
      // for.
      expect(calls[0]).toEqual(['docker', 'exec', 'infra-proxy-1', 'nginx', '-t']);
    },
  );
});

describe('issueCertificate argv shape (issue #389)', () => {
  it('runs certbot inside docker in container mode, mounting both paths and none of the renewal-recording flags', async () => {
    const root = makeProxyRoot();
    const calls: string[][] = [];

    await issueCertificate(target(root), {
      runCommand: fakeRunCommand(() => ({ exitCode: 0 }), calls),
      email: 'admin@example.test',
      runtime: containerProxyRuntime('proxy-nginx'),
    });

    const argv = calls[0] ?? [];
    expect(argv.slice(0, 3)).toEqual(['docker', 'run', '--rm']);
    // The mounts are the ONLY place a host path may legitimately appear.
    expect(argv).toContain(`${join(root, 'letsencrypt')}:${CONTAINER_CERT_ROOT}`);
    expect(argv).toContain(`${join(root, 'webroot')}:${CONTAINER_WEBROOT}`);
    expect(argv).toContain(CERTBOT_IMAGE);
    expect(argv.join(' ')).toContain(`--webroot -w ${CONTAINER_WEBROOT}`);

    // These three flags are what wrote host paths into the renewal config.
    expect(argv).not.toContain('--config-dir');
    expect(argv).not.toContain('--work-dir');
    expect(argv).not.toContain('--logs-dir');
  });

  it('keeps the host-mode certbot argv unchanged, including the three dir flags', async () => {
    const root = makeProxyRoot();
    const calls: string[][] = [];

    await issueCertificate(target(root), {
      runCommand: fakeRunCommand(() => ({ exitCode: 0 }), calls),
      email: 'admin@example.test',
      runtime: hostRuntime(root),
    });

    const argv = calls[0] ?? [];
    expect(argv.slice(0, 2)).toEqual(['certbot', 'certonly']);
    expect(argv).not.toContain('docker');
    expect(argv).toContain('--config-dir');
    expect(argv).toContain('--work-dir');
    expect(argv).toContain('--logs-dir');
  });
});

describe('installVhost', () => {
  it('writes, validates and reloads, in that order', async () => {
    const root = makeProxyRoot();
    const calls: string[][] = [];

    const result = await installVhost(target(root), {
      runCommand: fakeRunCommand(() => ({ exitCode: 0 }), calls),
    });

    expect(existsSync(result.path)).toBe(true);
    expect(calls.map((argv) => argv.join(' '))).toEqual(['nginx -t', 'nginx -s reload']);
  });

  it('reloads rather than restarts', async () => {
    const root = makeProxyRoot();
    const calls: string[][] = [];

    await installVhost(target(root), {
      runCommand: fakeRunCommand(() => ({ exitCode: 0 }), calls),
    });

    // A restart drops connections for every other application on the box.
    expect(calls.flat()).not.toContain('restart');
  });

  it('does nothing when the vhost is already byte-identical', async () => {
    const root = makeProxyRoot();
    const options = { runCommand: fakeRunCommand(() => ({ exitCode: 0 })) };

    await installVhost(target(root), options);
    const calls: string[][] = [];
    const second = await installVhost(target(root), {
      runCommand: fakeRunCommand(() => ({ exitCode: 0 }), calls),
    });

    expect(second.changed).toBe(false);
    expect(calls).toEqual([]);
  });

  it('removes the new vhost and re-validates when nginx -t fails', async () => {
    const root = makeProxyRoot();
    let validations = 0;

    const error = await installVhost(target(root), {
      runCommand: fakeRunCommand((argv) => {
        if (argv.join(' ') === 'nginx -t') {
          validations += 1;
          // Fails while the new vhost is present, passes once it is gone.
          return validations === 1
            ? { exitCode: 1, stderr: 'nginx: [emerg] invalid parameter' }
            : { exitCode: 0 };
        }
        return { exitCode: 0 };
      }),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toContain('invalid parameter');
    expect((error as Error).message).toContain('restored');
    // The proxy must be left exactly as it was found.
    expect(existsSync(vhostPath(target(root)))).toBe(false);
  });

  it('restores the previous contents when it overwrote one', async () => {
    const root = makeProxyRoot();
    const path = vhostPath(target(root));
    const previous = '# Managed by appctl deploy\n# an older version\n';
    writeFileSync(path, previous);

    await installVhost(target(root), {
      runCommand: fakeRunCommand((argv) =>
        argv.join(' ') === 'nginx -t' ? { exitCode: 1, stderr: 'nope' } : { exitCode: 0 },
      ),
    }).catch(() => undefined);

    expect(readFileSync(path, 'utf8')).toBe(previous);
  });

  it('never reloads when validation failed', async () => {
    const root = makeProxyRoot();
    const calls: string[][] = [];

    await installVhost(target(root), {
      runCommand: fakeRunCommand(
        (argv) => (argv.join(' ') === 'nginx -t' ? { exitCode: 1, stderr: 'no' } : { exitCode: 0 }),
        calls,
      ),
    }).catch(() => undefined);

    expect(calls.flat()).not.toContain('reload');
  });

  it('warns when the proxy was already broken before this run', async () => {
    const root = makeProxyRoot();

    const error = await installVhost(target(root), {
      // Fails even after the rollback: the problem predates this deployment.
      runCommand: fakeRunCommand((argv) =>
        argv.join(' ') === 'nginx -t' ? { exitCode: 1, stderr: 'broken already' } : { exitCode: 0 },
      ),
    }).catch((caught: unknown) => caught);

    expect((error as Error).message).toContain('already broken');
  });

  it('uses docker exec when the proxy is containerised', async () => {
    const root = makeProxyRoot();
    const calls: string[][] = [];

    await installVhost(target(root), {
      runCommand: fakeRunCommand(() => ({ exitCode: 0 }), calls),
      proxyContainer: 'infra-proxy-1',
    });

    expect(calls[0]).toEqual(['docker', 'exec', 'infra-proxy-1', 'nginx', '-t']);
  });
});

describe('issueCertificate', () => {
  it('skips issuance when a certificate already exists', async () => {
    const root = makeProxyRoot();
    const live = join(root, 'letsencrypt', 'live', 'app.example.test');
    mkdirSync(live, { recursive: true });
    writeFileSync(join(live, 'fullchain.pem'), 'cert');

    const calls: string[][] = [];
    const result = await issueCertificate(target(root), {
      runCommand: fakeRunCommand(() => ({ exitCode: 0 }), calls),
      email: 'admin@example.test',
    });

    // Re-issuing on every deploy spends the rate limit for nothing, and that
    // limit is shared with every other subdomain on the same server.
    expect(result.issued).toBe(false);
    expect(calls).toEqual([]);
  });

  it('requests one with the webroot method when there is none', async () => {
    const root = makeProxyRoot();
    const calls: string[][] = [];

    await issueCertificate(target(root), {
      runCommand: fakeRunCommand(() => ({ exitCode: 0 }), calls),
      email: 'admin@example.test',
    });

    const argv = calls[0]?.join(' ') ?? '';
    expect(argv).toContain('certbot certonly');
    expect(argv).toContain('--webroot');
    expect(argv).toContain('-d app.example.test');
    expect(argv).toContain('--non-interactive');
  });

  it('passes --staging when asked', async () => {
    const root = makeProxyRoot();
    const calls: string[][] = [];

    await issueCertificate(target(root), {
      runCommand: fakeRunCommand(() => ({ exitCode: 0 }), calls),
      email: 'admin@example.test',
      staging: true,
    });

    expect(calls[0]).toContain('--staging');
  });

  it('reports rate limiting distinctly, because the fix is to wait', async () => {
    const root = makeProxyRoot();

    const error = await issueCertificate(target(root), {
      runCommand: fakeRunCommand(() => ({
        exitCode: 1,
        stderr: 'too many certificates already issued for exact set of domains',
      })),
      email: 'admin@example.test',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toContain('rate-limiting');
    // Retrying is what put them there in the first place.
    expect((error as Error).message).toContain('--staging');
  });

  it('reports an absent certificate', () => {
    const root = makeProxyRoot();
    expect(certificateStatus(target(root)).exists).toBe(false);
  });
});

describe('removeVhost', () => {
  it('refuses to remove a vhost appctl did not write', async () => {
    const root = makeProxyRoot();
    const path = vhostPath(target(root));
    writeFileSync(path, 'server { listen 80; } # somebody else wrote this\n');

    await expect(
      removeVhost(target(root), { runCommand: fakeRunCommand(() => ({ exitCode: 0 })) }),
    ).rejects.toBeInstanceOf(UsageError);

    expect(existsSync(path)).toBe(true);
  });

  it('removes one it did write', async () => {
    const root = makeProxyRoot();
    await installVhost(target(root), { runCommand: fakeRunCommand(() => ({ exitCode: 0 })) });

    await removeVhost(target(root), { runCommand: fakeRunCommand(() => ({ exitCode: 0 })) });

    expect(existsSync(vhostPath(target(root)))).toBe(false);
  });

  it('is a no-op when there is nothing there', async () => {
    const root = makeProxyRoot();
    await expect(
      removeVhost(target(root), { runCommand: fakeRunCommand(() => ({ exitCode: 0 })) }),
    ).resolves.toBeUndefined();
  });
});

describe('validateProxy', () => {
  it('captures nginx output on failure', async () => {
    const result = await validateProxy({
      runCommand: fakeRunCommand(() => ({ exitCode: 1, stderr: 'nginx: [emerg] oops' })),
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('oops');
  });
});
