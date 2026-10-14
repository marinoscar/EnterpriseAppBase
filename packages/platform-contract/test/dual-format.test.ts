// Dual-format sanity of the slice subpaths (issue #701): the CommonJS half
// (what the API `require()`s) and the ESM half (what the web app and the CLI
// `import`) of `@marinoscar/platform-contract/doctor` expose the same names
// and the same values. Reads the BUILT package through its exports map, so
// `npm run build` must run first (CI's packages job builds before it tests).
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const manifest = require('../package.json') as { exports: Record<string, unknown> };

const SUBPATHS = Object.keys(manifest.exports).filter((key) => key !== '.' && key !== './package.json');

describe('dual CJS/ESM build', () => {
  it('exports the doctor slice', () => {
    expect(SUBPATHS).toContain('./doctor');
  });

  it.each(SUBPATHS)('declares %s with an import and a require condition, each with its own types first', (subpath) => {
    const slice = subpath.slice(2);
    const entry = manifest.exports[subpath] as Record<string, Record<string, string>>;
    expect(Object.keys(entry)).toEqual(['import', 'require']);
    expect(entry.import).toEqual({ types: `./dist/esm/${slice}/index.d.ts`, default: `./dist/esm/${slice}/index.js` });
    expect(entry.require).toEqual({ types: `./dist/cjs/${slice}/index.d.ts`, default: `./dist/cjs/${slice}/index.js` });
  });

  it.each(SUBPATHS)('require() and import() of %s expose the same keys', async (subpath) => {
    const specifier = `@marinoscar/platform-contract/${subpath.slice(2)}`;
    const cjs = require(specifier) as Record<string, unknown>;
    const esm = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;
    const esmKeys = Object.keys(esm).filter((key) => key !== 'default' && key !== 'module.exports').sort();
    expect(Object.keys(cjs).filter((key) => key !== '__esModule').sort()).toEqual(esmKeys);
  });

  it('serves the same constants from both halves', async () => {
    const cjs = require('@marinoscar/platform-contract/doctor') as typeof import('../src/doctor/index.js');
    const esm = await import('@marinoscar/platform-contract/doctor');
    expect(cjs.DOCTOR_STATUSES).toEqual(esm.DOCTOR_STATUSES);
    expect(cjs.DOCTOR_STATUS_RANK).toEqual(esm.DOCTOR_STATUS_RANK);
    expect(cjs.doctorQuerySchema.parse({ refresh: 'true' })).toEqual(esm.doctorQuerySchema.parse({ refresh: 'true' }));
  });
});
