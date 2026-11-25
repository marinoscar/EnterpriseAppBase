import { describe, expect, it, vi } from 'vitest';

import { PreconditionError } from '../errors.js';
import type { ComposeContainer } from './compose-containers.js';
import { describePick, foreignContainers, pickFreePort, planPortValues } from './free-ports.js';

// =============================================================================
// Picking a free host port  (#1027)
// =============================================================================

/** A container as Docker reports it: one binding per entry of `ports`. */
function container(
  name: string,
  ports: Array<number | string | { port: number | string; hostIp?: string; protocol?: string }>,
  extra: Partial<ComposeContainer> = {},
): ComposeContainer {
  const bindings = ports.map((entry) => {
    const binding = typeof entry === 'object' ? entry : { port: entry };
    return { hostIp: binding.hostIp ?? '', hostPort: String(binding.port), protocol: binding.protocol ?? 'tcp' };
  });
  return { name, running: true, hostPorts: bindings.map((binding) => binding.hostPort), bindings, project: 'other', workingDir: '/opt/other', ...extra };
}

const free = async (): Promise<boolean> => true;
const loopback = { hostIp: '127.0.0.1', protocol: 'tcp' };

describe('pickFreePort', () => {
  it('keeps the default when nothing holds it, and says nothing was skipped', async () => {
    const probe = vi.fn(free);

    const pick = await pickFreePort({ preferred: 14003, ...loopback, containers: [], probe });

    expect(pick).toEqual({ port: 14003, skipped: [] });
    expect(probe).toHaveBeenCalledWith(14003);
  });

  it('walks past a container that is running, naming it', async () => {
    const holder = container('evopath-greptimedb-1', [{ port: 14003, hostIp: '127.0.0.1' }]);

    const pick = await pickFreePort({ preferred: 14003, ...loopback, containers: [holder], probe: free });

    expect(pick).toEqual({ port: 14004, skipped: [{ port: 14003, reason: 'container', holder: 'evopath-greptimedb-1' }] });
  });

  it('walks past a STOPPED container too: it is configured to publish the port', async () => {
    const holder = container('old-greptimedb-1', [{ port: 14003, hostIp: '127.0.0.1' }], { running: false });

    const pick = await pickFreePort({ preferred: 14003, ...loopback, containers: [holder], probe: free });

    expect(pick.port).toBe(14004);
    expect(pick.skipped).toEqual([{ port: 14003, reason: 'container', holder: 'old-greptimedb-1' }]);
  });

  it('names the running holder when a stopped one claims the same port', async () => {
    const stopped = container('a-stopped', [14003], { running: false });
    const running = container('b-running', [14003]);

    const pick = await pickFreePort({ preferred: 14003, ...loopback, containers: [stopped, running], probe: free });

    expect(pick.skipped[0]?.holder).toBe('b-running');
  });

  it('walks past a port something outside Docker listens on', async () => {
    const probe = vi.fn(async (port: number) => port !== 14003 && port !== 14004);

    const pick = await pickFreePort({ preferred: 14003, ...loopback, containers: [], probe });

    expect(pick).toEqual({ port: 14005, skipped: [{ port: 14003, reason: 'listener' }, { port: 14004, reason: 'listener' }] });
  });

  it('does not probe a port a container already accounts for (docker-proxy is the listener)', async () => {
    const probe = vi.fn(free);

    await pickFreePort({ preferred: 14003, ...loopback, containers: [container('h', [14003])], probe });

    expect(probe).not.toHaveBeenCalledWith(14003);
  });

  it('skips the ports already chosen for other variables', async () => {
    const pick = await pickFreePort({ preferred: 14003, ...loopback, taken: new Set([14003, 14004]), containers: [], probe: free });

    expect(pick.port).toBe(14005);
    expect(pick.skipped.map((entry) => entry.reason)).toEqual(['taken', 'taken']);
  });

  describe('address', () => {
    it('a wildcard publish clashes with a 127.0.0.1 claim, and the reverse', async () => {
      const wildcard = container('w', [{ port: 14003, hostIp: '' }]);
      const zeros = container('z', [{ port: 14003, hostIp: '0.0.0.0' }]);

      expect((await pickFreePort({ preferred: 14003, ...loopback, containers: [wildcard], probe: free })).port).toBe(14004);
      expect((await pickFreePort({ preferred: 14003, ...loopback, containers: [zeros], probe: free })).port).toBe(14004);
      // A wildcard CLAIM (the main bind port) is held by any address.
      expect((await pickFreePort({ preferred: 14003, hostIp: '', protocol: 'tcp', containers: [container('l', [{ port: 14003, hostIp: '127.0.0.1' }])], probe: free })).port).toBe(14004);
    });

    it('a different specific address does not clash', async () => {
      const other = container('o', [{ port: 14003, hostIp: '127.0.0.2' }]);

      const pick = await pickFreePort({ preferred: 14003, ...loopback, containers: [other], probe: free });

      expect(pick).toEqual({ port: 14003, skipped: [] });
    });
  });

  describe('protocol', () => {
    it('a UDP publish does not hold a TCP port, and a TCP one does not hold a UDP port', async () => {
      const udp = container('u', [{ port: 14003, hostIp: '127.0.0.1', protocol: 'udp' }]);
      const tcp = container('t', [{ port: 14003, hostIp: '127.0.0.1', protocol: 'tcp' }]);

      expect((await pickFreePort({ preferred: 14003, ...loopback, containers: [udp], probe: free })).port).toBe(14003);
      expect((await pickFreePort({ preferred: 14003, hostIp: '127.0.0.1', protocol: 'udp', containers: [tcp], probe: free })).port).toBe(14003);
      expect((await pickFreePort({ preferred: 14003, hostIp: '127.0.0.1', protocol: 'udp', containers: [udp], probe: free })).port).toBe(14004);
    });

    it('never probes a UDP claim: the bind probe is TCP and would report a false clash', async () => {
      const probe = vi.fn(async () => false);

      const pick = await pickFreePort({ preferred: 5353, hostIp: '127.0.0.1', protocol: 'udp', containers: [], probe });

      expect(pick.port).toBe(5353);
      expect(probe).not.toHaveBeenCalled();
    });

    it('needs every claim of a variable free: a TCP and a UDP mapping of one number', async () => {
      const udp = container('u', [{ port: 5353, hostIp: '127.0.0.1', protocol: 'udp' }]);

      const pick = await pickFreePort({
        preferred: 5353,
        ...loopback,
        also: [{ hostIp: '127.0.0.1', protocol: 'udp' }],
        containers: [udp],
        probe: free,
      });

      expect(pick.port).toBe(5354);
    });
  });

  it('treats a published range as claiming every port in it', async () => {
    const range = container('r', [{ port: '14003-14005', hostIp: '127.0.0.1' }]);

    const pick = await pickFreePort({ preferred: 14003, ...loopback, containers: [range], probe: free });

    expect(pick.port).toBe(14006);
  });

  describe('exhaustion', () => {
    it('stops after the limit with an error that names the variable and the range', async () => {
      const failure = await pickFreePort({ preferred: 14003, ...loopback, containers: [], probe: async () => false, limit: 5, label: 'GREPTIME_BIND_PG_PORT' }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(PreconditionError);
      expect((failure as Error).message).toContain('GREPTIME_BIND_PG_PORT');
      expect((failure as Error).message).toContain('from 14003 to 14007');
    });

    it('tries 200 ports by default', async () => {
      const probe = vi.fn(async () => false);

      await pickFreePort({ preferred: 20000, ...loopback, containers: [], probe }).catch(() => undefined);

      expect(probe).toHaveBeenCalledTimes(200);
    });

    it('never goes above 65535', async () => {
      const probe = vi.fn(async (port: number) => port === 65535);

      const pick = await pickFreePort({ preferred: 65534, ...loopback, containers: [], probe });
      expect(pick.port).toBe(65535);

      const none = vi.fn(async () => false);
      await expect(pickFreePort({ preferred: 65534, ...loopback, containers: [], probe: none, limit: 200 })).rejects.toThrow(/from 65534 to 65535/);
      expect(none).toHaveBeenCalledTimes(2);
    });

    it('rejects a default that is not a port', async () => {
      await expect(pickFreePort({ preferred: 0, ...loopback, containers: [], probe: free })).rejects.toThrow(/not a port number/);
      await expect(pickFreePort({ preferred: 70000, ...loopback, containers: [], probe: free })).rejects.toThrow(/not a port number/);
    });
  });
});

describe('describePick', () => {
  it('says nothing when the default was free', () => {
    expect(describePick('GREPTIME_BIND_PG_PORT', { port: 14003, skipped: [] }, 14003)).toBeUndefined();
  });

  it('names the holder of the default', () => {
    expect(
      describePick('GREPTIME_BIND_PG_PORT', { port: 14013, skipped: [{ port: 14003, reason: 'container', holder: 'evopath-greptimedb-1' }] }, 14003),
    ).toBe('GREPTIME_BIND_PG_PORT=14013 (14003 is held by evopath-greptimedb-1)');
  });

  it('describes a listener and another variable, and shortens a long walk', () => {
    expect(describePick('X', { port: 3, skipped: [{ port: 1, reason: 'listener' }, { port: 2, reason: 'taken' }] }, 1)).toBe(
      'X=3 (1 has a listener, 2 is used by another variable of this run)',
    );
    const many = [1, 2, 3, 4, 5].map((port) => ({ port, reason: 'listener' as const }));
    expect(describePick('X', { port: 6, skipped: many }, 1)).toBe('X=6 (1 has a listener, 2 has a listener, 3 has a listener, 2 more in use)');
  });
});

describe('foreignContainers', () => {
  it('drops the run\'s own project (up -d recreates those) and keeps the rest', () => {
    const own = container('app-nginx-1', [3535], { project: 'app' });
    const other = container('x', [3535], { project: 'other' });

    expect(foreignContainers([own, other], 'app')).toEqual([other]);
  });

  it('passes "Docker could not be asked" through', () => {
    expect(foreignContainers(undefined, 'app')).toBeUndefined();
  });
});

// =============================================================================
// planPortValues: which variables get a value, and which are left alone
// =============================================================================
describe('planPortValues', () => {
  const FILE = [
    'services:',
    '  nginx:',
    '    ports:',
    '      - "127.0.0.1:${APP_BIND_PORT:-3535}:80"',
    '  greptimedb:',
    '    ports:',
    '      - "127.0.0.1:${GREPTIME_BIND_PG_PORT:-14003}:4003"',
    '  other:',
    '    ports:',
    '      - "127.0.0.1:${OTHER_BIND_PORT:-14003}:5000"',
    '      - "9999:5001"',
  ].join('\n');
  const ALL = new Set(['APP_BIND_PORT', 'GREPTIME_BIND_PG_PORT', 'OTHER_BIND_PORT']);
  const DEFAULTS = new Map([['APP_BIND_PORT', '3535'], ['GREPTIME_BIND_PG_PORT', '14003'], ['OTHER_BIND_PORT', '14003']]);
  const run = (extra: Partial<Parameters<typeof planPortValues>[0]> = {}) =>
    planPortValues({ files: [FILE], eligible: ALL, given: new Map(), defaults: DEFAULTS, containers: [], probe: free, ...extra });

  it('decides every eligible variable, and two variables with one default never share a number', async () => {
    const decisions = await run();

    expect(decisions.map(({ variable, port }) => [variable, port])).toEqual([
      ['APP_BIND_PORT', 3535],
      ['GREPTIME_BIND_PG_PORT', 14003],
      ['OTHER_BIND_PORT', 14004],
    ]);
    expect(decisions[2]?.message).toBe('OTHER_BIND_PORT=14004 (14003 is used by another variable of this run)');
    expect(decisions[0]?.message).toBeUndefined();
  });

  it('never decides a variable that already has a value, and reserves that value', async () => {
    const decisions = await run({ given: new Map([['GREPTIME_BIND_PG_PORT', '14003']]) });

    expect(decisions.map(({ variable }) => variable)).toEqual(['APP_BIND_PORT', 'OTHER_BIND_PORT']);
    expect(decisions.find(({ variable }) => variable === 'OTHER_BIND_PORT')?.port).toBe(14004);
  });

  it('treats a blank value as no value', async () => {
    const decisions = await run({ given: new Map([['GREPTIME_BIND_PG_PORT', '']]) });

    expect(decisions.map(({ variable }) => variable)).toContain('GREPTIME_BIND_PG_PORT');
  });

  it('decides only the eligible variables, and not the excluded ones', async () => {
    const decisions = await run({ eligible: new Set(['GREPTIME_BIND_PG_PORT', 'APP_BIND_PORT']), exclude: new Set(['APP_BIND_PORT']) });

    expect(decisions.map(({ variable }) => variable)).toEqual(['GREPTIME_BIND_PG_PORT']);
  });

  it('keeps the ports it is told are taken out of the search', async () => {
    const decisions = await run({ eligible: new Set(['GREPTIME_BIND_PG_PORT']), taken: [14003, 14004] });

    expect(decisions[0]?.port).toBe(14005);
  });

  it('starts from the compose default when the template has none, and skips a variable with neither', async () => {
    const noDefault = ['services:', '  a:', '    ports:', '      - "${A_PORT:-6000}:1"', '  b:', '    ports:', '      - "${B_PORT}:1"'].join('\n');

    const decisions = await planPortValues({
      files: [noDefault],
      eligible: new Set(['A_PORT', 'B_PORT']),
      given: new Map(),
      defaults: new Map(),
      containers: [],
      probe: free,
    });

    expect(decisions.map(({ variable, port }) => [variable, port])).toEqual([['A_PORT', 6000]]);
  });

  it('is probe-only when Docker cannot be asked (containers undefined)', async () => {
    const probe = vi.fn(async (port: number) => port !== 14003);

    const decisions = await run({ eligible: new Set(['GREPTIME_BIND_PG_PORT']), containers: undefined, probe });

    expect(decisions[0]?.port).toBe(14004);
  });

  it('fails clearly when a variable has no free port within the bound', async () => {
    await expect(run({ eligible: new Set(['GREPTIME_BIND_PG_PORT']), probe: async () => false, limit: 3 })).rejects.toThrow(/GREPTIME_BIND_PG_PORT/);
  });
});
