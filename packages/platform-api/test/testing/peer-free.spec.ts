import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as ts from 'typescript';

const PACKAGE_ROOT = join(__dirname, '..', '..');
const TESTING_SRC = join(PACKAGE_ROOT, 'src', 'testing');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? tsFiles(full) : entry.endsWith('.ts') ? [full] : [];
  });
}

/** Every module specifier of a source, comments stripped so TSDoc examples never count. */
function specifiersOf(file: string): string[] {
  const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const patterns = [
    /\bimport\s+(?:type\s+)?[^'";]*?from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?[^'";]*?from\s*['"]([^'"]+)['"]/g,
    /(?<![.\w$])require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  return patterns.flatMap((re) => [...source.matchAll(re)].map((m) => m[1]));
}

const RUNNER = /^(@jest\/|jest($|-)|ts-jest|vitest|@vitest\/)/;

describe('src/testing is peer-free (no Jest, no Vitest)', () => {
  it('imports neither jest nor vitest, in any file', () => {
    const files = tsFiles(TESTING_SRC);
    expect(files.length).toBeGreaterThanOrEqual(5);

    const offenders = files.flatMap((file) =>
      specifiersOf(file)
        .filter((specifier) => RUNNER.test(specifier))
        .map((specifier) => `${file}: ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });

  it('the scanner itself detects imports (guards against a regex that matches nothing)', () => {
    const all = tsFiles(TESTING_SRC).flatMap(specifiersOf);

    expect(all).toEqual(expect.arrayContaining(['node:fs', '../core/index']));
  });

  it('loads in a plain node process without putting jest or vitest into require.cache', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'platform-api-peerfree-'));
    try {
      // Compile the slice with the build's own options, then load the result
      // outside any test runner: the child process has no Jest globals and
      // would throw on first use of one.
      const configPath = join(PACKAGE_ROOT, 'tsconfig.build.json');
      const read = ts.readConfigFile(configPath, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, PACKAGE_ROOT, undefined, configPath);
      const program = ts.createProgram({
        rootNames: parsed.fileNames,
        options: { ...parsed.options, outDir, rootDir: join(PACKAGE_ROOT, 'src'), declaration: false, declarationMap: false, sourceMap: false, noEmit: false },
      });
      const emitted = program.emit();
      expect(emitted.emitSkipped).toBe(false);

      const script = `
        const api = require(${JSON.stringify(join(outDir, 'testing', 'index.js'))});
        const loaded = Object.keys(require.cache).filter((id) => /[\\\\/]node_modules[\\\\/](jest|vitest|@jest|@vitest|ts-jest)[\\\\/]/.test(id));
        process.stdout.write(JSON.stringify({ exports: Object.keys(api).sort(), loaded }));
      `;
      const child = spawnSync(process.execPath, ['-e', script], {
        encoding: 'utf8',
        env: { ...process.env, NODE_PATH: join(PACKAGE_ROOT, '..', '..', 'node_modules'), JEST_WORKER_ID: '', NODE_OPTIONS: '' },
      });

      expect(child.stderr).toBe('');
      const result = JSON.parse(child.stdout) as { exports: string[]; loaded: string[] };
      expect(result.exports).toEqual(expect.arrayContaining(['runPlatformConformance', 'cronEnqueueOnlySuite', 'conformanceSuites']));
      expect(result.loaded).toEqual([]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
