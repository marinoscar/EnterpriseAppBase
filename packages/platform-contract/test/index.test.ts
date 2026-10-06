import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { PLATFORM_PACKAGE } from '../src/index.js';

const require = createRequire(import.meta.url);
const manifest = require('../package.json') as {
  type: string;
  exports: Record<string, unknown>;
};

describe('@marinoscar/platform-contract', () => {
  it('exports its package name', () => {
    expect(PLATFORM_PACKAGE).toBe('@marinoscar/platform-contract');
  });

  it('declares a dual exports map: ESM under import, CJS under require, each with its own types first', () => {
    expect(manifest.type).toBe('module');
    const root = manifest.exports['.'] as Record<string, Record<string, string>>;
    expect(Object.keys(root)).toEqual(['import', 'require']);
    expect(root.import).toEqual({ types: './dist/esm/index.d.ts', default: './dist/esm/index.js' });
    expect(root.require).toEqual({ types: './dist/cjs/index.d.ts', default: './dist/cjs/index.js' });
  });
});
