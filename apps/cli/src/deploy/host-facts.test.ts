import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { CommandResult, runCommand } from './executor.js';
import {
  collectHostFacts,
  isRoutableAddress,
  parsePrettyName,
  parseRouteSource,
} from './host-facts.js';

type Runner = typeof runCommand;

function result(stdout: string): CommandResult {
  return {
    argv: [],
    cwd: '/',
    exitCode: 0,
    stdout,
    stderr: '',
    durationMs: 1,
    timedOut: false,
  };
}

/** Answers by the first two words of the argv; anything else fails. */
function runner(answers: Record<string, string | Error>): Runner {
  return ((argv: readonly string[]) => {
    const key = argv.slice(0, 2).join(' ');
    const answer = answers[key];
    if (answer === undefined) return Promise.reject(new Error(`no such command: ${key}`));
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve(result(answer));
  }) as Runner;
}

const WORKING = {
  'docker version': '27.3.1',
  'docker compose': 'v2.29.7',
  'ip -4': '1.1.1.1 via 10.0.0.1 dev eth0 src 203.0.113.5 uid 0 \n    cache \n',
};

function osReleaseFile(content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'appctl-osrel-')), 'os-release');
  writeFileSync(path, content);
  return path;
}

describe('parsePrettyName', () => {
  it('reads a double-quoted PRETTY_NAME', () => {
    expect(
      parsePrettyName('NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\nID=ubuntu\n'),
    ).toBe('Ubuntu 24.04.1 LTS');
  });

  it('reads a single-quoted and a bare one', () => {
    expect(parsePrettyName("PRETTY_NAME='Debian GNU/Linux 12 (bookworm)'")).toBe(
      'Debian GNU/Linux 12 (bookworm)',
    );
    expect(parsePrettyName('PRETTY_NAME=Alpine')).toBe('Alpine');
  });

  it('is not fooled by a key that merely ends in PRETTY_NAME', () => {
    expect(parsePrettyName('UBUNTU_PRETTY_NAME="wrong"\nPRETTY_NAME="right"')).toBe('right');
  });

  it('returns undefined when there is none, or when it is empty', () => {
    expect(parsePrettyName('NAME="Ubuntu"\nID=ubuntu')).toBeUndefined();
    expect(parsePrettyName('PRETTY_NAME=""')).toBeUndefined();
    expect(parsePrettyName('')).toBeUndefined();
  });
});

describe('parseRouteSource', () => {
  it('reads the src address `ip route get` reports', () => {
    expect(
      parseRouteSource('1.1.1.1 via 10.0.0.1 dev eth0 src 203.0.113.5 uid 0 \n    cache'),
    ).toBe('203.0.113.5');
  });

  it('reads it from a host with no gateway hop', () => {
    expect(parseRouteSource('1.1.1.1 dev eth0 src 198.51.100.9 uid 0')).toBe('198.51.100.9');
  });

  it('returns undefined for output that has no src at all', () => {
    expect(parseRouteSource('RTNETLINK answers: Network is unreachable')).toBeUndefined();
    expect(parseRouteSource('')).toBeUndefined();
  });
});

describe('isRoutableAddress', () => {
  it('accepts an ordinary public IPv4 address', () => {
    expect(isRoutableAddress('203.0.113.5')).toBe(true);
    expect(isRoutableAddress('8.8.8.8')).toBe(true);
    expect(isRoutableAddress('172.32.0.1')).toBe(true);
  });

  it('rejects every address a NATed or local interface would carry', () => {
    // Recording one of these in a field called publicIp is worse than
    // recording nothing: it looks like an answer.
    for (const address of [
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.10',
      '127.0.0.1',
      '169.254.10.1',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      expect(isRoutableAddress(address), address).toBe(false);
    }
  });

  it('accepts global-unicast IPv6 and rejects the rest', () => {
    expect(isRoutableAddress('2001:db8::1')).toBe(true);
    expect(isRoutableAddress('3fff::1')).toBe(true);
    expect(isRoutableAddress('fe80::1')).toBe(false);
    expect(isRoutableAddress('fd00::1')).toBe(false);
    expect(isRoutableAddress('::1')).toBe(false);
  });

  it('rejects anything that is not an address', () => {
    expect(isRoutableAddress('')).toBe(false);
    expect(isRoutableAddress('not.an.ip.addr')).toBe(false);
    expect(isRoutableAddress('203.0.113')).toBe(false);
  });
});

describe('collectHostFacts', () => {
  it('records the machine when every probe answers', async () => {
    const facts = await collectHostFacts({
      runCommand: runner(WORKING),
      osReleasePath: osReleaseFile('PRETTY_NAME="Ubuntu 24.04.1 LTS"\n'),
    });

    expect(facts?.os).toBe('Ubuntu 24.04.1 LTS');
    expect(facts?.dockerVersion).toBe('27.3.1');
    expect(facts?.composeVersion).toBe('v2.29.7');
    expect(facts?.publicIp).toBe('203.0.113.5');
    // From node:os, so only their shape is assertable on an arbitrary runner.
    expect(facts?.hostname).toBeTruthy();
    expect(facts?.kernel).toBeTruthy();
    expect(facts?.arch).toBeTruthy();
    expect(facts?.cpus).toBeGreaterThan(0);
    expect(facts?.memoryBytes).toBeGreaterThan(0);
  });

  it('loses one field, never the rest, when a probe fails', async () => {
    const facts = await collectHostFacts({
      runCommand: runner({ ...WORKING, 'docker compose': new Error('not installed') }),
      osReleasePath: osReleaseFile('PRETTY_NAME="Ubuntu 24.04.1 LTS"\n'),
    });

    expect(facts?.composeVersion).toBe('unknown');
    expect(facts?.dockerVersion).toBe('27.3.1');
    expect(facts?.os).toBe('Ubuntu 24.04.1 LTS');
  });

  it('never throws, whatever the runner does', async () => {
    // Rule 1. This runs at the end of a deploy that has already built,
    // migrated and verified; nothing here may turn that into a failure.
    const explode: Runner = (() => {
      throw new Error('docker is on fire');
    }) as Runner;

    const facts = await collectHostFacts({
      runCommand: explode,
      osReleasePath: '/nonexistent/os-release',
    });

    expect(facts?.dockerVersion).toBe('unknown');
    expect(facts?.composeVersion).toBe('unknown');
    expect(facts?.hostname).toBeTruthy();
  });

  it('falls back to the kernel when there is no os-release to read', async () => {
    const facts = await collectHostFacts({
      runCommand: runner(WORKING),
      osReleasePath: '/nonexistent/os-release',
    });

    // Not "unknown": node:os always answers, and "Linux 6.8.0-45-generic" is
    // a genuinely useful record from a host that simply has no os-release.
    expect(facts?.os).not.toBe('unknown');
    expect(facts?.os).toContain(facts?.kernel ?? '#');
  });

  it('leaves publicIp absent rather than recording a NATed address', async () => {
    const facts = await collectHostFacts({
      runCommand: runner({
        ...WORKING,
        'ip -4': '1.1.1.1 via 192.168.1.1 dev eth0 src 192.168.1.42 uid 0',
      }),
      osReleasePath: '/nonexistent/os-release',
    });

    // Only true if this machine has no public address of its own either; the
    // assertion that matters is that the private src was not taken.
    expect(facts?.publicIp).not.toBe('192.168.1.42');
  });

  it('makes no request to anything but the local routing table', async () => {
    const seen: string[][] = [];
    const recording: Runner = ((argv: readonly string[]) => {
      seen.push([...argv]);
      return Promise.resolve(result(''));
    }) as Runner;

    await collectHostFacts({
      runCommand: recording,
      osReleasePath: '/nonexistent/os-release',
    });

    // No IP-echo service. `ip route get` sends nothing - it is a kernel
    // routing lookup - and a deploy tool that quietly called out to a third
    // party would be a surprise an operator should not find with tcpdump.
    expect(seen.map((argv) => argv[0]).sort()).toEqual(['docker', 'docker', 'ip']);
    for (const argv of seen) {
      expect(argv.join(' ')).not.toMatch(/curl|wget|https?:\/\//);
    }
  });
});
