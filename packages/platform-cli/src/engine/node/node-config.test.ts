import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configDirName, configFileName } from '../identity.js';
import { UsageError } from '../errors.js';
import {
  DEFAULT_POLL_INTERVAL_MS,
  MAX_NODE_CONCURRENCY,
  assertKnownTypes,
  parseEligibleTypes,
  resolveNodeConfig,
  saveNodeConfig,
} from './node-config.js';
import { workerEnv } from './worker-env.js';

// =============================================================================
// Node configuration resolution  (issue #272, epic #254)
// =============================================================================
//
// Everything here runs against a real temporary home directory rather than a
// mocked `fs`, because the two properties most worth asserting — the `0600`
// mode and the degraded write — are properties of the filesystem, not of a
// module boundary. Nothing mutates `process.env`; the context object is the
// seam, per `config.ts`'s own convention.
// =============================================================================

let home: string;

function writeConfig(body: unknown): void {
  const dir = join(home, configDirName());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, configFileName()), JSON.stringify(body), { mode: 0o600 });
}

function readStored(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(home, configDirName(), configFileName()), 'utf8')) as Record<string, unknown>;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'appctl-node-config-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('parseEligibleTypes', () => {
  it('splits, trims, drops blanks and deduplicates while preserving order', () => {
    expect(parseEligibleTypes(' example.checksum , example.echo ,,example.checksum')).toEqual([
      'example.checksum',
      'example.echo',
    ]);
  });

  it('treats an absent value as "all types"', () => {
    expect(parseEligibleTypes(undefined)).toEqual([]);
  });
});

describe('assertKnownTypes', () => {
  it('names the unknown type AND the valid set', () => {
    let thrown: unknown;
    try {
      assertKnownTypes(['video.transcode'], ['example.checksum', 'example.echo']);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UsageError);
    expect((thrown as Error).message).toContain('video.transcode');
    expect((thrown as Error).message).toContain('example.checksum, example.echo');
  });

  it('says so plainly when the server advertises no node-eligible types at all', () => {
    expect(() => assertKnownTypes(['anything'], [])).toThrow(/advertises none/);
  });

  it('accepts a known type', () => {
    expect(() => assertKnownTypes(['example.checksum'], ['example.checksum'])).not.toThrow();
  });
});

describe('resolveNodeConfig', () => {
  it('synthesises a usable config from the environment alone — the container path', () => {
    const resolved = resolveNodeConfig({
      home,
      env: {
        [workerEnv().serverUrl]: 'https://app.example.com',
        [workerEnv().token]: 'nod_abc123',
        [workerEnv().nodeName]: 'worker-1',
        [workerEnv().concurrency]: '4',
      },
    });

    expect(resolved.synthesised).toBe(true);
    expect(resolved.serverUrl).toBe('https://app.example.com');
    expect(resolved.node).toEqual({
      name: 'worker-1',
      concurrency: 4,
      eligibleTypes: [],
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    });
  });

  it('names the missing variable when only one of the pair is set', () => {
    expect(() =>
      resolveNodeConfig({ home, env: { [workerEnv().token]: 'nod_abc123' } }),
    ).toThrow(new RegExp(workerEnv().serverUrl));
  });

  it('overlays the environment over the file PER FIELD, not all-or-nothing', () => {
    writeConfig({
      serverUrl: 'https://app.example.com',
      token: 'nod_stored',
      nodeId: 'node-1',
      node: { name: 'stored-name', concurrency: 2, eligibleTypes: ['example.checksum'], pollIntervalMs: 1000 },
    });

    const resolved = resolveNodeConfig({ home, env: { [workerEnv().concurrency]: '8' } });

    expect(resolved.node.concurrency).toBe(8);
    expect(resolved.node.name).toBe('stored-name');
    expect(resolved.node.eligibleTypes).toEqual(['example.checksum']);
    expect(resolved.node.pollIntervalMs).toBe(1000);
    expect(resolved.nodeId).toBe('node-1');
    expect(resolved.synthesised).toBe(false);
  });

  it('lets the environment supply the node id, so a restart re-attaches with no file', () => {
    const resolved = resolveNodeConfig({
      home,
      env: {
        [workerEnv().serverUrl]: 'https://app.example.com',
        [workerEnv().token]: 'nod_abc123',
        [workerEnv().nodeId]: 'node-from-env',
      },
    });
    expect(resolved.nodeId).toBe('node-from-env');
  });

  it('refuses an out-of-range concurrency, naming the server’s own cap', () => {
    expect(() =>
      resolveNodeConfig({
        home,
        env: {
          [workerEnv().serverUrl]: 'https://app.example.com',
          [workerEnv().token]: 'nod_abc123',
          [workerEnv().concurrency]: String(MAX_NODE_CONCURRENCY + 1),
        },
      }),
    ).toThrow(new RegExp(String(MAX_NODE_CONCURRENCY)));
  });

  it('refuses a non-numeric concurrency by naming the variable', () => {
    expect(() =>
      resolveNodeConfig({
        home,
        env: {
          [workerEnv().serverUrl]: 'https://app.example.com',
          [workerEnv().token]: 'nod_abc123',
          [workerEnv().concurrency]: 'lots',
        },
      }),
    ).toThrow(new RegExp(workerEnv().concurrency));
  });

  it('refuses an unknown eligible type when the caller knows the valid set', () => {
    expect(() =>
      resolveNodeConfig({
        home,
        knownTypes: ['example.checksum'],
        env: {
          [workerEnv().serverUrl]: 'https://app.example.com',
          [workerEnv().token]: 'nod_abc123',
          [workerEnv().types]: 'example.checksum,video.transcode',
        },
      }),
    ).toThrow(/video\.transcode/);
  });

  it('reads the headless flag and resolves the state directory', () => {
    const resolved = resolveNodeConfig({
      home,
      env: {
        [workerEnv().serverUrl]: 'https://app.example.com',
        [workerEnv().token]: 'nod_abc123',
        [workerEnv().headless]: 'true',
        [workerEnv().stateDir]: '/state',
      },
    });
    expect(resolved.headless).toBe(true);
    expect(resolved.stateDir).toBe('/state');
  });
});

describe('saveNodeConfig', () => {
  it('merges into the existing file without destroying the token', () => {
    writeConfig({ serverUrl: 'https://app.example.com', token: 'nod_stored', node: { name: 'stored' } });

    saveNodeConfig({ nodeId: 'node-9', node: { concurrency: 3 } }, { home, env: {} });

    const stored = readStored();
    expect(stored.token).toBe('nod_stored');
    expect(stored.nodeId).toBe('node-9');
    expect(stored.node).toMatchObject({ name: 'stored', concurrency: 3 });
  });

  it('writes 0600', () => {
    writeConfig({ serverUrl: 'https://app.example.com', token: 'nod_stored' });
    saveNodeConfig({ nodeId: 'node-9' }, { home, env: {} });
    const mode = statSync(join(home, configDirName(), configFileName())).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('warns rather than throws when the config cannot be written in env-only mode', () => {
    const warnings: string[] = [];
    // A path whose parent is a FILE: mkdir fails with ENOTDIR, which is the
    // closest reproducible stand-in for a read-only container home.
    const blocked = join(home, 'blocked');
    writeFileSync(blocked, 'not a directory');

    const result = saveNodeConfig(
      { nodeId: 'node-9' },
      { home: blocked, env: {}, degradeOnFailure: true, warn: (message) => warnings.push(message) },
    );

    expect(result).toBeUndefined();
    expect(warnings.join('\n')).toContain(workerEnv().nodeId);
  });

  it('still throws when degradation was not requested', () => {
    const blocked = join(home, 'blocked2');
    writeFileSync(blocked, 'not a directory');
    expect(() => saveNodeConfig({ nodeId: 'node-9' }, { home: blocked, env: {} })).toThrow();
  });
});
