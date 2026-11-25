import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Proves the two platform boundary rules in the root eslint.config.mjs:
 *
 *   Rule A: no deep imports (src/, dist/, a slice's internal/, a relative
 *           path that leaves the package, an app, @app/shared).
 *   Rule B: slice direction from packages/platform-slices.json, through the
 *           target slice's index.ts only.
 *
 * The rules run over a throwaway fixture workspace with a fixture graph, so
 * the test does not depend on which slices exist in the real packages yet.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..');
const RUNNER = join(__dirname, 'support', 'run-eslint.mjs');

const FIXTURE_GRAPH = {
  'platform-api': { core: [], testing: ['core'], jobs: ['core'] },
  'platform-web': { ui: [] },
};

const FIXTURE_FILES: Record<string, string> = {
  'packages/platform-api/tsconfig.json': '{ "compilerOptions": { "module": "NodeNext", "moduleResolution": "NodeNext" } }',
  'packages/platform-api/src/index.ts': "export * from './core/index.js';\n",
  'packages/platform-api/src/core/index.ts': "export { helper } from './internal/helper.js';\n",
  'packages/platform-api/src/core/internal/helper.ts': 'export const helper = 1;\n',
  'packages/platform-api/src/testing/index.ts': 'export const harness = 1;\n',
  'packages/platform-api/src/jobs/index.ts': 'export const jobs = 1;\n',
  'packages/platform-web/tsconfig.json': '{ "compilerOptions": { "module": "NodeNext", "moduleResolution": "NodeNext" } }',
  'packages/platform-web/src/ui/index.ts': 'export const ui = 1;\n',
  'packages/platform-contract/tsconfig.json': '{ "compilerOptions": { "module": "NodeNext", "moduleResolution": "NodeNext" } }',
  'packages/platform-contract/src/doctor/constants.ts': "export const STATUSES = ['pass'] as const;\n",
};

type LintCase = { name: string; filePath: string; code: string };
type LintResult = { filePath: string; messages: { ruleId: string | null; message: string }[] };

const CASES: LintCase[] = [
  // Allowed
  { name: 'declared edge through index', filePath: 'packages/platform-api/src/testing/a.ts', code: "import { helper } from '../core/index.js';\nexport const a = helper;\n" },
  { name: 'own internal/', filePath: 'packages/platform-api/src/core/a.ts', code: "import { helper } from './internal/helper.js';\nexport const a = helper;\n" },
  { name: 'barrel re-exports a slice index', filePath: 'packages/platform-api/src/index.ts', code: "export * from './core/index.js';\n" },
  { name: 'another package by name', filePath: 'packages/platform-api/src/core/a.ts', code: "import { PLATFORM_PACKAGE } from '@marinoscar/platform-contract';\nimport { z } from 'zod';\nexport const a = [PLATFORM_PACKAGE, z];\n" },
  { name: 'public subpath of another package', filePath: 'packages/platform-api/src/core/a.ts', code: "import { x } from '@marinoscar/platform-contract/doctor';\nexport const a = x;\n" },
  // Rule A
  { name: 'deep src/ import', filePath: 'packages/platform-api/src/core/a.ts', code: "import { ui } from '@marinoscar/platform-web/src/ui/index.js';\nexport const a = ui;\n" },
  { name: 'deep dist/ import', filePath: 'packages/platform-api/src/core/a.ts', code: "import { ui } from '@marinoscar/platform-web/dist/index.js';\nexport const a = ui;\n" },
  { name: 'internal/ of a published subpath', filePath: 'packages/platform-api/src/core/a.ts', code: "import { x } from '@marinoscar/platform-web/doctor/internal/x';\nexport const a = x;\n" },
  { name: '@app/shared', filePath: 'packages/platform-api/src/core/a.ts', code: "import { APP_NAME } from '@app/shared';\nexport const a = APP_NAME;\n" },
  { name: 'relative path into another package', filePath: 'packages/platform-api/src/core/a.ts', code: "import { ui } from '../../../platform-web/src/ui/index.js';\nexport const a = ui;\n" },
  { name: 'relative path into an app', filePath: 'packages/platform-api/src/core/a.ts', code: "import { x } from '../../../../apps/api/src/main.js';\nexport const a = x;\n" },
  // Rule B
  { name: 'undeclared cross-slice import', filePath: 'packages/platform-api/src/core/a.ts', code: "import { harness } from '../testing/index.js';\nexport const a = harness;\n" },
  { name: 'undeclared sibling slice', filePath: 'packages/platform-api/src/jobs/a.ts', code: "import { harness } from '../testing/index.js';\nexport const a = harness;\n" },
  { name: "another slice's internal/", filePath: 'packages/platform-api/src/testing/a.ts', code: "import { helper } from '../core/internal/helper.js';\nexport const a = helper;\n" },
  { name: 'barrel reaching into a slice', filePath: 'packages/platform-api/src/index.ts', code: "export * from './core/internal/helper.js';\n" },
  { name: 'slice importing the package barrel', filePath: 'packages/platform-api/src/core/a.ts', code: "import { helper } from '../index.js';\nexport const a = helper;\n" },
  // Contract import rules (#701)
  { name: 'contract: zod and its own slice', filePath: 'packages/platform-contract/src/doctor/schemas.ts', code: "import { z } from 'zod';\nimport { STATUSES } from './constants.js';\nexport const s = z.enum(STATUSES);\n" },
  { name: 'contract: @nestjs/common', filePath: 'packages/platform-contract/src/doctor/schemas.ts', code: "import { Injectable } from '@nestjs/common';\nexport const a = Injectable;\n" },
  { name: 'contract: nestjs-zod', filePath: 'packages/platform-contract/src/doctor/schemas.ts', code: "import { createZodDto } from 'nestjs-zod';\nexport const a = createZodDto;\n" },
  { name: 'contract: react', filePath: 'packages/platform-contract/src/doctor/schemas.ts', code: "import { useState } from 'react';\nexport const a = useState;\n" },
  { name: 'contract: @mui/material', filePath: 'packages/platform-contract/src/doctor/schemas.ts', code: "import { Box } from '@mui/material';\nexport const a = Box;\n" },
  { name: 'contract: node: built-in', filePath: 'packages/platform-contract/src/doctor/schemas.ts', code: "import { readFileSync } from 'node:fs';\nexport const a = readFileSync;\n" },
  { name: 'contract: bare built-in', filePath: 'packages/platform-contract/src/doctor/schemas.ts', code: "import { join } from 'path';\nexport const a = join;\n" },
  { name: 'contract: another platform package', filePath: 'packages/platform-contract/src/doctor/schemas.ts', code: "import { DoctorModule } from '@marinoscar/platform-api/doctor';\nexport const a = DoctorModule;\n" },
  { name: 'contract: still no deep import', filePath: 'packages/platform-contract/src/doctor/schemas.ts', code: "import { x } from '@app/shared';\nexport const a = x;\n" },
];

describe('platform boundary lint (eslint.config.mjs)', () => {
  let results: Map<string, LintResult>;
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'platform-boundaries-'));
    for (const [path, content] of Object.entries(FIXTURE_FILES)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    const child = spawnSync(process.execPath, [RUNNER], {
      cwd: root,
      encoding: 'utf8',
      input: JSON.stringify({
        eslint: require.resolve('eslint', { paths: [REPO_ROOT] }),
        config: join(REPO_ROOT, 'eslint.config.mjs'),
        rootPath: root,
        graph: FIXTURE_GRAPH,
        cases: CASES.map(({ filePath, code }) => ({ filePath, code })),
      }),
    });
    if (child.status !== 0) throw new Error(`ESLint runner failed:\n${child.stderr}`);
    const parsed = JSON.parse(child.stdout) as LintResult[];
    results = new Map(CASES.map((c, i) => [c.name, parsed[i]!]));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const rules = (name: string) => results.get(name)!.messages.map((m) => m.ruleId);

  it.each([
    'declared edge through index',
    'own internal/',
    'barrel re-exports a slice index',
    'another package by name',
    'public subpath of another package',
  ])('accepts an allowed import: %s', (name) => {
    expect(results.get(name)!.messages).toEqual([]);
  });

  describe('rule A: no deep imports', () => {
    it.each([
      ['deep src/ import', /never its src\//],
      ['deep dist/ import', /never its dist\//],
      ['internal/ of a published subpath', /internal\/ folder is private/],
      ['@app/shared', /app identity package/],
    ])('rejects %s', (name, message) => {
      const messages = results.get(name)!.messages;
      expect(messages.map((m) => m.ruleId)).toContain('no-restricted-imports');
      expect(messages.map((m) => m.message).join('\n')).toMatch(message);
    });

    it.each(['relative path into another package', 'relative path into an app'])('rejects a %s', (name) => {
      expect(rules(name)).toContain('platform/no-relative-escape');
    });
  });

  describe('rule B: slice direction', () => {
    it.each([
      'undeclared cross-slice import',
      'undeclared sibling slice',
      "another slice's internal/",
      'barrel reaching into a slice',
      'slice importing the package barrel',
    ])('rejects %s', (name) => {
      expect(rules(name)).toContain('boundaries/dependencies');
    });

    it('names the slice graph in the message', () => {
      const [message] = results.get('undeclared cross-slice import')!.messages;
      expect(message!.message).toMatch(/Slice 'core' of platform-api may not import 'testing'/);
      expect(message!.message).toMatch(/packages\/platform-slices\.json/);
    });
  });

  describe('contract import rules (#701)', () => {
    it('accepts zod and an import inside its own slice', () => {
      expect(results.get('contract: zod and its own slice')!.messages).toEqual([]);
    });

    it.each([
      ['contract: @nestjs/common', /framework-free: Nest/],
      ['contract: nestjs-zod', /framework-free: Nest/],
      ['contract: react', /framework-free: React/],
      ['contract: @mui/material', /framework-free: React/],
      ['contract: node: built-in', /no Node built-in/],
      ['contract: bare built-in', /no Node built-in/],
      ['contract: another platform package', /no other platform package/],
      ['contract: still no deep import', /app identity package/],
    ])('rejects %s', (name, message) => {
      const messages = results.get(name)!.messages;
      expect(messages.map((m) => m.ruleId)).toContain('no-restricted-imports');
      expect(messages.map((m) => m.message).join('\n')).toMatch(message);
    });
  });
});
