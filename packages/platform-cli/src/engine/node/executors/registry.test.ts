import { afterEach, describe, expect, it } from 'vitest';

import type { NodeApi } from '../node-api.js';
import { NodeEngine } from '../node-engine.js';

import { defaultExecutors } from './example-checksum.js';
import { resolveInputMode, type JobExecutor } from './index.js';
import {
  builtinExecutorTypes,
  defaultExecutorRegistry,
  listRegisteredNodeExecutors,
  registerNodeExecutor,
  resetNodeExecutorRegistryForTests,
} from './registry.js';

// =============================================================================
// The node executor registry  (PP-8.9, #715)
// =============================================================================

afterEach(() => resetNodeExecutorRegistryForTests());

const echo: JobExecutor = { type: 'app.echo', requiresInput: false, execute: async (context) => context.params };

describe('the built-in executors', () => {
  it('are still example.checksum and db.backup.run, registered by default', () => {
    expect(builtinExecutorTypes()).toEqual(['example.checksum', 'db.backup.run']);
    expect(defaultExecutorRegistry().types()).toEqual(['db.backup.run', 'example.checksum']);
    expect(defaultExecutorRegistry().has('db.backup.run')).toBe(true);
  });
});

describe('registerNodeExecutor', () => {
  it('adds an app type to the default registry, and so to what an engine claims', () => {
    registerNodeExecutor(echo);
    expect(defaultExecutorRegistry().types()).toEqual(['app.echo', 'db.backup.run', 'example.checksum']);
    expect(defaultExecutorRegistry().require('app.echo')).toBe(echo);
    expect(listRegisteredNodeExecutors()).toEqual([echo]);

    const engine = new NodeEngine({ api: {} as NodeApi, nodeId: 'node-1', concurrency: 1 });
    expect(engine.claimableTypes()).toContain('app.echo');
  });

  it('gives every engine a registry of its own', () => {
    registerNodeExecutor(echo);
    expect(defaultExecutorRegistry()).not.toBe(defaultExecutorRegistry());
    expect(defaultExecutors()).toHaveLength(2);
  });

  it('refuses a built-in type, a duplicate and an empty type', () => {
    expect(() => registerNodeExecutor({ ...echo, type: 'db.backup.run' })).toThrow(/duplicates a built-in executor/);
    registerNodeExecutor(echo);
    expect(() => registerNodeExecutor({ ...echo })).toThrow(/already registered/);
    expect(() => registerNodeExecutor({ ...echo, type: ' ' })).toThrow(/non-empty job type/);
    expect(() => registerNodeExecutor({ type: 'app.bad' } as JobExecutor)).toThrow(/execute\(\)/);
  });

  it("accepts input: 'none' | 'download' | 'url' and resolves the legacy requiresInput", () => {
    for (const input of ['none', 'download', 'url'] as const) {
      registerNodeExecutor({ type: `app.${input}`, input, execute: async () => ({}) });
    }
    expect(resolveInputMode({ requiresInput: true })).toBe('download');
    expect(resolveInputMode({ requiresInput: false })).toBe('none');
    expect(resolveInputMode({ input: 'url' })).toBe('url');
  });

  it('refuses both requiresInput and input, an unknown mode and neither', () => {
    expect(() => registerNodeExecutor({ ...echo, type: 'app.both', input: 'url' })).toThrow(/both requiresInput and input/);
    expect(() => registerNodeExecutor({ type: 'app.odd', input: 'stream', execute: async () => ({}) } as never)).toThrow(/unknown input mode/);
    expect(() => registerNodeExecutor({ type: 'app.none', execute: async () => ({}) })).toThrow(/input mode/);
  });
});
