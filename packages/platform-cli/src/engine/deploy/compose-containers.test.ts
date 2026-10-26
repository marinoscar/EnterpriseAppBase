import { describe, expect, it } from 'vitest';

import { hostIpsOverlap, listComposeContainers, publishesPort, type ComposeContainer } from './compose-containers.js';
import { inspectOutput, psOutput, type FakeContainer } from './testing/fake-containers.js';

// =============================================================================
// Which host addresses and protocols does a container claim?  (#1024)
// =============================================================================

/** A runner answering the two questions `listComposeContainers` asks. */
function docker(containers: readonly FakeContainer[], seen: string[][] = []) {
  return async (argv: readonly string[]): Promise<{ stdout: string }> => {
    seen.push([...argv]);
    return { stdout: argv[1] === 'ps' ? psOutput(containers) : inspectOutput(containers) };
  };
}

describe('listComposeContainers', () => {
  it('reads the address, port and protocol of every binding, and keeps the ports a range claims whole', async () => {
    const containers = await listComposeContainers(
      docker([
        {
          project: 'kvox',
          workingDir: '/opt/kvox/repo/infra/compose',
          name: 'kvox-greptimedb-1',
          ports: [
            { hostIp: '127.0.0.1', port: 14003 },
            { hostIp: '', port: '8000-8010', protocol: 'udp' },
            9000,
          ],
        },
      ]),
    );

    // Grouped by protocol key, as Docker prints the map.
    expect(containers?.[0]?.bindings).toHaveLength(3);
    expect(containers?.[0]?.bindings).toEqual(
      expect.arrayContaining([
        { hostIp: '127.0.0.1', hostPort: '14003', protocol: 'tcp' },
        { hostIp: '', hostPort: '8000-8010', protocol: 'udp' },
        // A bare port is every interface, TCP.
        { hostIp: '', hostPort: '9000', protocol: 'tcp' },
      ]),
    );
    expect(containers?.[0]?.hostPorts.sort()).toEqual(['14003', '8000-8010', '9000'].sort());
  });

  it('asks Docker for the address and the container port/protocol of each binding, in argv', async () => {
    const seen: string[][] = [];

    await listComposeContainers(docker([{ project: 'p', workingDir: '/w', ports: [1] }], seen));

    const inspect = seen.find((argv) => argv[1] === 'inspect');
    expect(inspect?.[2]).toBe('--format');
    // The API's own JSON, not a typed field that one Docker CLI spells HostIP and another HostIp.
    expect(inspect?.[3]).toContain('{{json .HostConfig.PortBindings}}');
  });

  it('ignores a binding with no host port (Docker picks one): no claim', async () => {
    const containers = await listComposeContainers(
      docker([{ project: 'p', workingDir: '/w', ports: [{ hostIp: '127.0.0.1', port: '' }] }]),
    );

    expect(containers?.[0]?.bindings).toEqual([]);
  });
});

describe('listComposeContainers reading real inspect output', () => {
  /** What `docker inspect --format` prints for one container, line by line. */
  const run = (lines: string) => async (argv: readonly string[]): Promise<{ stdout: string }> => ({ stdout: argv[1] === 'ps' ? 'id0\nid1\nid2' : lines });

  it('reads the JSON Docker prints, `null` for a container with no bindings, and ignores a line it cannot read', async () => {
    const containers = await listComposeContainers(
      run(
        [
          '/kvox-greptimedb-1|true|{"4003/tcp":[{"HostIp":"127.0.0.1","HostPort":"14003"}]}|kvox|/opt/kvox/repo/infra/compose',
          '/kvox-api-1|true|null|kvox|/opt/kvox/repo/infra/compose',
          '/odd|false|{not json|kvox|/opt/kvox',
        ].join('\n'),
      ),
    );

    expect(containers?.map((container) => [container.name, container.running, container.bindings])).toEqual([
      ['kvox-greptimedb-1', true, [{ hostIp: '127.0.0.1', hostPort: '14003', protocol: 'tcp' }]],
      ['kvox-api-1', true, []],
      ['odd', false, []],
    ]);
  });

  it('gives a container published on several protocols and addresses one binding each', async () => {
    const containers = await listComposeContainers(
      run('/dns|true|{"53/tcp":[{"HostIp":"","HostPort":"5353"}],"53/udp":[{"HostIp":"0.0.0.0","HostPort":"5353"},{"HostIp":"::","HostPort":"5353"}]}|p|/w'),
    );

    expect(containers?.[0]?.bindings).toEqual([
      { hostIp: '', hostPort: '5353', protocol: 'tcp' },
      { hostIp: '0.0.0.0', hostPort: '5353', protocol: 'udp' },
      { hostIp: '::', hostPort: '5353', protocol: 'udp' },
    ]);
  });
});

describe('publishesPort', () => {
  const container = (...bindings: ComposeContainer['bindings']): Pick<ComposeContainer, 'hostPorts' | 'bindings'> => ({
    hostPorts: bindings.map((binding) => binding.hostPort),
    bindings,
  });

  it('without a match, any address and protocol counts, and a range covers its ports (what the bind-port checks want)', () => {
    const subject = container({ hostIp: '10.0.0.5', hostPort: '8000-8010', protocol: 'udp' });

    expect(publishesPort(subject, 8005)).toBe(true);
    expect(publishesPort(subject, 8011)).toBe(false);
    expect(publishesPort({ hostPorts: ['3535'] }, 3535)).toBe(true);
  });

  it('with an address, only an overlapping binding counts', () => {
    const loopback = container({ hostIp: '127.0.0.1', hostPort: '14003', protocol: 'tcp' });
    const wildcard = container({ hostIp: '', hostPort: '14003', protocol: 'tcp' });

    expect(publishesPort(loopback, 14003, { hostIp: '127.0.0.1' })).toBe(true);
    expect(publishesPort(loopback, 14003, { hostIp: '127.0.0.2' })).toBe(false);
    expect(publishesPort(loopback, 14003, { hostIp: '' })).toBe(true);
    expect(publishesPort(wildcard, 14003, { hostIp: '127.0.0.1' })).toBe(true);
  });

  it('with a protocol, only that protocol counts; a binding that recorded none counts for both', () => {
    const udp = container({ hostIp: '', hostPort: '53', protocol: 'udp' });
    const unknown = container({ hostIp: '', hostPort: '53', protocol: '' });

    expect(publishesPort(udp, 53, { protocol: 'tcp' })).toBe(false);
    expect(publishesPort(udp, 53, { protocol: 'udp' })).toBe(true);
    expect(publishesPort(unknown, 53, { protocol: 'tcp' })).toBe(true);
  });
});

describe('hostIpsOverlap', () => {
  it('treats every wildcard spelling as overlapping everything, and two distinct addresses as apart', () => {
    for (const wildcard of ['', '0.0.0.0', '::', '[::]']) expect(hostIpsOverlap(wildcard, '127.0.0.1')).toBe(true);
    expect(hostIpsOverlap('127.0.0.1', '127.0.0.1')).toBe(true);
    expect(hostIpsOverlap('127.0.0.1', '127.0.0.2')).toBe(false);
  });
});
