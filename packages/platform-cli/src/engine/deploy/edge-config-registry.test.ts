import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { UsageError } from '../errors.js';
import {
  EDGE_CONFIG_FILES,
  checkoutEdgeHashes,
  edgeConfigFiles,
  freezeEdgeConfigRegistry,
  reconcileEdgeConfig,
  registerEdgeConfigFile,
  resetEdgeConfigRegistryForTests,
} from './edge-config.js';

afterEach(() => resetEdgeConfigRegistryForTests());

const extra = { checkout: 'infra/nginx/ssl-extra.conf', container: '/etc/nginx/ssl-extra.conf' };

describe('registerEdgeConfigFile', () => {
  it('leaves the platform list untouched until an app registers a file', () => {
    expect(edgeConfigFiles()).toBe(EDGE_CONFIG_FILES);
    registerEdgeConfigFile(extra);
    expect(edgeConfigFiles()).toEqual([...EDGE_CONFIG_FILES, extra]);
  });

  it('puts the app file in the same comparison: hashed in the checkout, recreated on drift', async () => {
    registerEdgeConfigFile(extra);
    const root = mkdtempSync(join(tmpdir(), 'appctl-edge-reg-'));
    mkdirSync(join(root, 'infra', 'nginx'), { recursive: true });
    writeFileSync(join(root, 'infra', 'nginx', 'nginx.conf'), 'a');
    writeFileSync(join(root, 'infra', 'nginx', 'csp.conf'), 'b');
    writeFileSync(join(root, 'infra', 'nginx', 'ssl-extra.conf'), 'c');
    const expected = checkoutEdgeHashes(root);
    expect([...expected.keys()]).toEqual(['/etc/nginx/nginx.conf', '/etc/nginx/csp.conf', '/etc/nginx/ssl-extra.conf']);

    let recreated = 0;
    const lines: string[] = [];
    // The container still reads the OLD inode of the app's file only.
    const outcome = await reconcileEdgeConfig({
      checkoutPath: root,
      readRunning: async () => ({
        hashes: new Map([...expected].map(([file, hash]) => [file, recreated === 0 && file === extra.container ? 'f'.repeat(64) : hash])),
      }),
      recreate: async () => void (recreated += 1),
      manualCommand: 'compose up',
      line: (text) => lines.push(text),
    });
    expect(outcome).toBe('recreated');
    expect(recreated).toBe(1);
    expect(lines.join('\n')).toContain('/etc/nginx/ssl-extra.conf');
  });

  it.each([
    [{ checkout: 'infra/x.conf', container: 'etc/nginx/x.conf' }, /container path/],
    [{ checkout: 'infra/x.conf', container: '/etc/nginx/x conf' }, /container path/],
    [{ checkout: 'infra/x.conf', container: '/etc/nginx/x;rm' }, /container path/],
    [{ checkout: '../x.conf', container: '/etc/nginx/x.conf' }, /checkout path/],
    [{ checkout: '/abs/x.conf', container: '/etc/nginx/x.conf' }, /checkout path/],
    [{ checkout: 'infra/../x.conf', container: '/etc/nginx/x.conf' }, /checkout path/],
    [{ checkout: 'infra/nginx/nginx.conf', container: '/etc/nginx/nginx.conf' }, /already checked by the platform/],
  ])('refuses %j', (file, message) => {
    expect(() => registerEdgeConfigFile(file)).toThrow(UsageError);
    expect(() => registerEdgeConfigFile(file)).toThrow(message);
  });

  it('refuses a duplicate and a late registration', () => {
    registerEdgeConfigFile(extra);
    expect(() => registerEdgeConfigFile(extra)).toThrow(/already registered/);
    freezeEdgeConfigRegistry('createCli built the CLI');
    expect(() => registerEdgeConfigFile({ ...extra, container: '/etc/nginx/other.conf' })).toThrow(/after createCli built the CLI/);
  });
});
