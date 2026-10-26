import { describe, expect, it } from 'vitest';

import { composeArgv, composeCwd } from './compose-command.js';
import { ComposeConfigError, parseComposePorts, readStackPorts, splitPortSpec } from './compose-ports.js';
import { CommandFailedError, type CommandResult } from './executor.js';

// =============================================================================
// Reading the host ports out of `docker compose config --format json`  (#1024)
// =============================================================================

const SECRET = 'jwt-secret-5d41402abc4b2a76b9719d911017c592';

/** A rendered project, as compose prints it, with a secret in `environment`. */
function rendered(services: Record<string, unknown>): string {
  return JSON.stringify({
    name: 'kvox',
    services: Object.fromEntries(
      Object.entries(services).map(([name, ports]) => [name, { image: `${name}:1`, environment: { JWT_SECRET: SECRET }, ports }]),
    ),
  });
}

describe('parseComposePorts', () => {
  it('reads published as a string, as a number, and as a range', () => {
    const ports = parseComposePorts(
      rendered({
        nginx: [{ mode: 'ingress', host_ip: '127.0.0.1', target: 80, published: '3535', protocol: 'tcp' }],
        greptimedb: [{ mode: 'ingress', host_ip: '127.0.0.1', target: 4003, published: 14003, protocol: 'tcp' }],
        range: [{ target: 80, published: '8000-8002', protocol: 'tcp' }],
      }),
    );

    expect(ports).toEqual([
      { service: 'nginx', hostIp: '127.0.0.1', port: 3535, protocol: 'tcp' },
      { service: 'greptimedb', hostIp: '127.0.0.1', port: 14003, protocol: 'tcp' },
      { service: 'range', hostIp: '', port: 8000, protocol: 'tcp' },
      { service: 'range', hostIp: '', port: 8001, protocol: 'tcp' },
      { service: 'range', hostIp: '', port: 8002, protocol: 'tcp' },
    ]);
  });

  it('reads a missing host_ip as every interface, and a missing protocol as tcp', () => {
    const [port] = parseComposePorts(rendered({ web: [{ target: 80, published: '8080' }] }));

    expect(port).toEqual({ service: 'web', hostIp: '', port: 8080, protocol: 'tcp' });
  });

  it('keeps the protocol: udp is not tcp', () => {
    const ports = parseComposePorts(
      rendered({ dns: [{ target: 53, published: '5353', protocol: 'udp' }, { target: 53, published: '5353', protocol: 'tcp' }] }),
    );

    expect(ports.map((port) => port.protocol)).toEqual(['udp', 'tcp']);
  });

  it('treats an unpublished or random host port (no published, "", 0) as no claim', () => {
    const ports = parseComposePorts(
      rendered({ web: [{ target: 80 }, { target: 81, published: '' }, { target: 82, published: '0' }, { target: 83, published: 0 }] }),
    );

    expect(ports).toEqual([]);
  });

  it('reads a short-syntax string entry, an IPv6 address and a protocol suffix', () => {
    const ports = parseComposePorts(rendered({ web: ['127.0.0.1:9000:80', '[::1]:9001:80/udp', '9002:80'] }));

    expect(ports).toEqual([
      { service: 'web', hostIp: '127.0.0.1', port: 9000, protocol: 'tcp' },
      { service: 'web', hostIp: '::1', port: 9001, protocol: 'udp' },
      { service: 'web', hostIp: '', port: 9002, protocol: 'tcp' },
    ]);
  });

  it('lists a service with no ports, and an empty project, as no ports', () => {
    expect(parseComposePorts(rendered({ api: undefined }))).toEqual([]);
    expect(parseComposePorts(JSON.stringify({ services: {} }))).toEqual([]);
  });

  it('collapses the same binding listed twice', () => {
    const entry = { host_ip: '127.0.0.1', target: 80, published: '3535', protocol: 'tcp' };

    expect(parseComposePorts(rendered({ nginx: [entry, entry] }))).toHaveLength(1);
  });

  it('cuts a pathological range instead of expanding 65k ports', () => {
    expect(parseComposePorts(rendered({ web: [{ target: 1, published: '1-65535' }] })).length).toBeLessThanOrEqual(1024);
  });

  it('rejects output that is not a compose project, without quoting it (it holds the secrets)', () => {
    for (const text of ['', 'not json', `{"name":"x","secret":"${SECRET}"}`, '[]', 'null']) {
      const failure = (() => {
        try {
          parseComposePorts(text);
          return undefined;
        } catch (error) {
          return error;
        }
      })();

      expect(failure).toBeInstanceOf(ComposeConfigError);
      expect((failure as Error).message).not.toContain(SECRET);
      expect((failure as Error).message).not.toContain('not json');
    }
  });

  it('rejects a published port that is not a port', () => {
    expect(() => parseComposePorts(rendered({ web: [{ target: 80, published: '99999' }] }))).toThrow(ComposeConfigError);
    expect(() => parseComposePorts(rendered({ web: [{ target: 80, published: 'abc' }] }))).toThrow(ComposeConfigError);
  });
});

describe('splitPortSpec', () => {
  it('splits at the colons outside ${...}, so a default does not break the spec', () => {
    expect(splitPortSpec('127.0.0.1:${GREPTIME_BIND_PG_PORT:-14003}:4003')).toEqual({
      hostIp: '127.0.0.1',
      published: '${GREPTIME_BIND_PG_PORT:-14003}',
      protocol: 'tcp',
    });
    expect(splitPortSpec('${NGINX_PORT:-3535}:80')).toEqual({ hostIp: '', published: '${NGINX_PORT:-3535}', protocol: 'tcp' });
  });

  it('finds no host side in a container-only port', () => {
    expect(splitPortSpec('80')).toBeUndefined();
  });
});

describe('readStackPorts', () => {
  const ROOT = '/opt/infra/apps/kvox';

  /** A runner answering with `stdout`, or failing with `error`; records the argv it was given. */
  function runner(outcome: { stdout: string } | { error: Error }) {
    const calls: Array<{ argv: readonly string[]; cwd: string }> = [];
    return {
      calls,
      run: async (argv: readonly string[], options: { cwd: string }) => {
        calls.push({ argv, cwd: options.cwd });
        if ('error' in outcome) throw outcome.error;
        return { stdout: outcome.stdout };
      },
    };
  }

  const failure = (message: string, stderr = ''): CommandFailedError =>
    new CommandFailedError(message, {
      argv: [],
      cwd: '',
      exitCode: 1,
      stdout: `{"leaked":"${SECRET}"}`,
      stderr,
      durationMs: 1,
      timedOut: false,
    } satisfies CommandResult);

  it('renders the stack with the argv and cwd `up -d` uses: same project, same files, in the compose directory', async () => {
    const subject = runner({ stdout: rendered({ nginx: [{ host_ip: '127.0.0.1', target: 80, published: '3535' }] }) });

    const result = await readStackPorts({ run: subject.run, deployRoot: ROOT, project: 'kvox', groups: ['email'] });

    expect(subject.calls).toHaveLength(1);
    expect(subject.calls[0]?.cwd).toBe(composeCwd(ROOT));
    expect(subject.calls[0]?.argv).toEqual(
      composeArgv(['config', '--format', 'json'], 'kvox', ['email'], composeCwd(ROOT)),
    );
    // The project and the telemetry files are in it: the second port lives there.
    expect(subject.calls[0]?.argv.slice(0, 4)).toEqual(['docker', 'compose', '-p', 'kvox']);
    expect(subject.calls[0]?.argv).toContain('vps.telemetry.compose.yml');
    expect(result).toEqual({ status: 'ok', ports: [{ service: 'nginx', hostIp: '127.0.0.1', port: 3535, protocol: 'tcp' }] });
  });

  it('reports a compose error as render-failed, carrying compose\'s own words and nothing from stdout', async () => {
    const subject = runner({
      error: failure(
        '`docker compose config` exited 1\n    error while interpolating: required variable POSTGRES_PASSWORD is missing a value',
        'required variable POSTGRES_PASSWORD is missing a value',
      ),
    });

    const result = await readStackPorts({ run: subject.run, deployRoot: ROOT, project: 'kvox' });

    expect(result.status).toBe('render-failed');
    expect(JSON.stringify(result)).toContain('required variable POSTGRES_PASSWORD is missing a value');
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('reports unreadable output as render-failed', async () => {
    const result = await readStackPorts({ run: runner({ stdout: 'warning: something\n' }).run, deployRoot: ROOT, project: 'kvox' });

    expect(result.status).toBe('render-failed');
  });

  it.each([
    'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
    'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock',
    'failed to connect to the docker API at unix:///var/run/docker.sock',
    'docker: command not found',
  ])('reports docker as unreachable (not a compose error) for: %s', async (message) => {
    const result = await readStackPorts({ run: runner({ error: failure(message) }).run, deployRoot: ROOT, project: 'kvox' });

    expect(result.status).toBe('docker-unreachable');
  });
});
