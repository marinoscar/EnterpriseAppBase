/// <reference types="node" />
// Every interface an app augments from OUTSIDE the package is declared in the
// module its public subpath resolves to, and merges in any file order
// (issue #865; the API package's twin is
// packages/platform-api/test/augmentation-targets.spec.ts, which explains the
// defect). Compile-only: the fixture app augments the public specifier with one
// key and, in a second file, the DECLARING file (resolved by the checker) with
// another, in both orders, and must see both.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import * as ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PACKAGE_ROOT = join(__dirname, '..');
const SRC = join(PACKAGE_ROOT, 'src');

interface Target {
  subpath: string;
  iface: string;
}

const TARGETS: readonly Target[] = [{ subpath: 'settings/headless', iface: 'SettingsFeatureRegistry' }];

const entryOf = (t: Target): string => join(SRC, t.subpath, 'index.ts');
const specifierOf = (t: Target): string => `@marinoscar/platform-web/${t.subpath}`;
const id = (t: Target): string => `${t.subpath.replace(/\W/g, '_')}_${t.iface}`;

function compilerOptions(): ts.CompilerOptions {
  const configPath = join(PACKAGE_ROOT, 'tsconfig.json');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, PACKAGE_ROOT, undefined, configPath);
  return {
    ...parsed.options,
    noEmit: true,
    incremental: false,
    composite: false,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
    paths: { '@marinoscar/platform-web/*': [join(SRC, '*', 'index.ts')] },
  };
}

function declaringFiles(): Map<Target, { aliased: boolean; files: string[] }> {
  const program = ts.createProgram({ rootNames: TARGETS.map(entryOf), options: compilerOptions() });
  const checker = program.getTypeChecker();
  const found = new Map<Target, { aliased: boolean; files: string[] }>();
  for (const target of TARGETS) {
    const source = program.getSourceFile(entryOf(target))!;
    const exported = checker.getExportsOfModule(checker.getSymbolAtLocation(source)!).find((s) => s.name === target.iface);
    if (!exported) throw new Error(`${specifierOf(target)} does not export ${target.iface}`);
    const aliased = (exported.flags & ts.SymbolFlags.Alias) !== 0;
    const resolved = aliased ? checker.getAliasedSymbol(exported) : exported;
    const inAugmentation = (node: ts.Node): boolean => (node.parent ? ts.isModuleDeclaration(node.parent) || inAugmentation(node.parent) : false);
    const files = (resolved.declarations ?? []).filter((d) => !inAugmentation(d)).map((d) => d.getSourceFile().fileName);
    found.set(target, { aliased, files: [...new Set(files)] });
  }
  return found;
}

function writeFixture(declared: Map<Target, { files: string[] }>): string {
  const dir = mkdtempSync(join(tmpdir(), 'platform-web-augment-'));
  const appFiles: string[] = [];
  const sliceFiles: string[] = [];
  for (const target of TARGETS) {
    const appKey = `app_${id(target)}`;
    const sliceKey = `slice_${id(target)}`;
    writeFileSync(
      join(dir, `app.${id(target)}.ts`),
      [
        `import type { ${target.iface} } from '${specifierOf(target)}';`,
        `declare module '${specifierOf(target)}' {`,
        `  interface ${target.iface} { ${appKey}: true }`,
        '}',
        'type AssertKeys<T, K extends keyof T> = K;',
        `export type Both = AssertKeys<${target.iface}, '${appKey}' | '${sliceKey}'>;`,
        '',
      ].join('\n'),
    );
    const rel = relative(dir, declared.get(target)!.files[0]!).replace(/\\/g, '/').replace(/\.ts$/, '.js');
    writeFileSync(
      join(dir, `slice.${id(target)}.ts`),
      ['export {};', `declare module '${rel.startsWith('.') ? rel : `./${rel}`}' {`, `  interface ${target.iface} { ${sliceKey}: true }`, '}', ''].join('\n'),
    );
    appFiles.push(`./app.${id(target)}.js`);
    sliceFiles.push(`./slice.${id(target)}.js`);
  }
  const imports = (list: string[]) => list.map((m) => `import '${m}';`).join('\n') + '\n';
  writeFileSync(join(dir, 'app-first.ts'), imports([...appFiles, ...sliceFiles]));
  writeFileSync(join(dir, 'slice-first.ts'), imports([...sliceFiles, ...appFiles]));
  return dir;
}

describe('augmentation targets (#865)', () => {
  let declared: Map<Target, { aliased: boolean; files: string[] }>;
  let dir: string;

  beforeAll(() => {
    declared = declaringFiles();
    dir = writeFixture(declared);
  }, 120_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it.each(TARGETS.map((t) => [`${specifierOf(t)} ${t.iface}`, t] as const))(
    '%s is declared in the entry module, not re-exported from a leaf',
    (_name, target) => {
      expect(declared.get(target)).toEqual({ aliased: false, files: [entryOf(target)] });
    },
  );

  it.each(['app-first.ts', 'slice-first.ts'])(
    'merges the app augmentation with an augmentation of the declaring file (%s)',
    (entry) => {
      const program = ts.createProgram({ rootNames: [join(dir, entry)], options: compilerOptions() });
      const own = ts.getPreEmitDiagnostics(program).filter((d) => !d.file || d.file.fileName.startsWith(dir));
      expect(own.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
    },
    120_000,
  );
});
