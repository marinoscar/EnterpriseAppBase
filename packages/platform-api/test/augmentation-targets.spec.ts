// Every interface an app augments from OUTSIDE the package is declared in the
// module its public subpath resolves to, and merges in any file order
// (issue #865). Compile-only: nothing is emitted.
//
// The defect it pins: an interface declared in a leaf file and only
// re-exported by the slice's entry module. An app's augmentation of the public
// specifier then merges through the re-export alias, and an augmentation of the
// DECLARING file met in the other order (a slice's own `declare module`, as
// storage's of `SystemSettingsNamespaces` was) replaces the merged symbol, so
// one side's keys vanish. The starter (#741) lost its `notes` namespace that way.
//
// For each target the spec
//   1. asserts the entry module declares it (not an alias), and
//   2. compiles a fixture app that augments the public specifier with one key
//      and, in a second file, the DECLARING file (resolved by the checker, so a
//      regression to a leaf declaration is exercised, not assumed) with another,
//      in both orders, requiring both keys.
// A realistic case rides along: the app's `notes` namespace read through
// `SystemSettingsService.getNamespace('notes')` next to the storage slice,
// whose declaration file augments the same interface. The consumer smoke
// (tests/consumer-smoke/api/src/notes.settings.ts) repeats that against the
// packed `.d.ts` files; packages/platform-web/test/augmentation-targets.test.ts
// covers the web package.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import * as ts from 'typescript';

const PACKAGE_ROOT = join(__dirname, '..');
const SRC = join(PACKAGE_ROOT, 'src');

/** An augmentation target: the public subpath an app augments and the interface. */
interface Target {
  slice: string;
  iface: string;
}

const TARGETS: readonly Target[] = [
  { slice: 'settings', iface: 'SystemSettingsNamespaces' },
  { slice: 'settings', iface: 'SystemSettingsNamespaceDeclarations' },
  { slice: 'settings', iface: 'UserSettingsNamespaces' },
  { slice: 'settings', iface: 'UserSettingsNamespaceDeclarations' },
  { slice: 'email', iface: 'EmailTemplateDataMap' },
  { slice: 'identity', iface: 'IdentityPermissionIds' },
  { slice: 'identity', iface: 'IdentityRoleIds' },
  { slice: 'notifications', iface: 'NotificationChannelIds' },
  { slice: 'otel-core', iface: 'AppMetricKeys' },
  { slice: 'telemetry', iface: 'MetricGroupIds' },
  { slice: 'testing', iface: 'PlatformConformanceSuiteOptions' },
];

const entryOf = (slice: string): string => join(SRC, slice, 'index.ts');
const specifierOf = (slice: string): string => `@marinoscar/platform-api/${slice}`;

function compilerOptions(): ts.CompilerOptions {
  const configPath = join(PACKAGE_ROOT, 'tsconfig.json');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, PACKAGE_ROOT, undefined, configPath);
  return {
    ...parsed.options,
    noEmit: true,
    rootDir: undefined,
    incremental: false,
    composite: false,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
    types: ['node'],
    // The public specifiers an installed app imports, onto this package's sources.
    paths: { '@marinoscar/platform-api/*': [join(SRC, '*', 'index.ts')] },
  };
}

/**
 * The fixture's own diagnostics. The package's sources are left out: an
 * augmentation of `IdentityPermissionIds` narrows `PermissionName` for the
 * whole program, so the slices' own `@Auth` literals stop compiling here
 * (the app's real augmentation lists every id; `npm run typecheck` covers them).
 */
function diagnosticsOf(program: ts.Program, fixtureDir: string): string[] {
  const own = (d: ts.Diagnostic) => !d.file || d.file.fileName.startsWith(fixtureDir);
  return ts.getPreEmitDiagnostics(program).filter(own).map((d) => {
    const where = d.file ? `${d.file.fileName.replace(PACKAGE_ROOT, '')}:${d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}` : '';
    return `${where} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
  });
}

/** Where each target is declared, as the checker sees the entry module's export. */
function declarations(): Map<Target, { aliased: boolean; files: string[] }> {
  const entries = [...new Set(TARGETS.map((t) => entryOf(t.slice)))];
  const program = ts.createProgram({ rootNames: entries, options: compilerOptions() });
  const checker = program.getTypeChecker();
  const found = new Map<Target, { aliased: boolean; files: string[] }>();
  for (const target of TARGETS) {
    const source = program.getSourceFile(entryOf(target.slice))!;
    const exported = checker.getExportsOfModule(checker.getSymbolAtLocation(source)!).find((s) => s.name === target.iface);
    if (!exported) throw new Error(`${specifierOf(target.slice)} does not export ${target.iface}`);
    const aliased = (exported.flags & ts.SymbolFlags.Alias) !== 0;
    const resolved = aliased ? checker.getAliasedSymbol(exported) : exported;
    // The declaration itself, not the slices' augmentations of it (each sits inside a `declare module`).
    const inAugmentation = (node: ts.Node): boolean => (node.parent ? ts.isModuleDeclaration(node.parent) || inAugmentation(node.parent) : false);
    const files = (resolved.declarations ?? []).filter((d) => !inAugmentation(d)).map((d) => d.getSourceFile().fileName);
    found.set(target, { aliased, files: [...new Set(files)] });
  }
  return found;
}

const id = (t: Target): string => `${t.slice.replace(/\W/g, '_')}_${t.iface}`;

/** Relative module name from the fixture directory to a source file, without extension. */
function moduleName(fromDir: string, file: string): string {
  const rel = relative(fromDir, file).replace(/\\/g, '/').replace(/\.ts$/, '');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

function writeFixture(declared: Map<Target, { files: string[] }>): string {
  const dir = mkdtempSync(join(tmpdir(), 'platform-api-augment-'));
  const files: Record<string, string> = {};
  const appFiles: string[] = [];
  const sliceFiles: string[] = [];
  for (const target of TARGETS) {
    const appKey = `app_${id(target)}`;
    const sliceKey = `slice_${id(target)}`;
    files[`app.${id(target)}.ts`] = [
      `import type { ${target.iface} } from '${specifierOf(target.slice)}';`,
      `declare module '${specifierOf(target.slice)}' {`,
      `  interface ${target.iface} { ${appKey}: true }`,
      '}',
      'type AssertKeys<T, K extends keyof T> = K;',
      `export type Both = AssertKeys<${target.iface}, '${appKey}' | '${sliceKey}'>;`,
      '',
    ].join('\n');
    // A slice's own augmentation names the file that declares the interface.
    const declaringFile = declared.get(target)!.files[0]!;
    files[`slice.${id(target)}.ts`] = [
      'export {};',
      `declare module '${moduleName(dir, declaringFile)}' {`,
      `  interface ${target.iface} { ${sliceKey}: true }`,
      '}',
      '',
    ].join('\n');
    appFiles.push(`./app.${id(target)}`);
    sliceFiles.push(`./slice.${id(target)}`);
  }
  files['notes.settings.ts'] = `
import type { SystemSettingsService } from '@marinoscar/platform-api/settings';

export interface NotesSettings {
  archiveAfterDays: number;
}

declare module '@marinoscar/platform-api/settings' {
  interface SystemSettingsNamespaces {
    notes: NotesSettings;
  }
}

export async function archiveAfterDays(settings: SystemSettingsService): Promise<number> {
  const notes: NotesSettings = await settings.getNamespace('notes');
  return notes.archiveAfterDays;
}

export async function neverDeclared(settings: SystemSettingsService): Promise<unknown> {
  // @ts-expect-error a key no augmentation declares (unused, this line would fail the program)
  return settings.getNamespace('neverDeclared');
}
`;
  files['storage.reader.ts'] = `
import type { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { STORAGE_SYSTEM_SETTINGS } from '@marinoscar/platform-api/storage';

export const STORAGE_KEY = STORAGE_SYSTEM_SETTINGS.key;

export async function storageBucket(settings: SystemSettingsService): Promise<string> {
  return (await settings.getNamespace('storage')).provider;
}
`;
  const imports = (list: string[]) => list.map((m) => `import '${m}';`).join('\n') + '\n';
  files['app-first.ts'] = imports(['./notes.settings', ...appFiles, './storage.reader', ...sliceFiles]);
  files['slice-first.ts'] = imports(['./storage.reader', ...sliceFiles, './notes.settings', ...appFiles]);
  for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source);
  return dir;
}

describe('augmentation targets (#865)', () => {
  let declared: Map<Target, { aliased: boolean; files: string[] }>;
  let dir: string;

  beforeAll(() => {
    declared = declarations();
    dir = writeFixture(declared);
  }, 120_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it.each(TARGETS.map((t) => [`${specifierOf(t.slice)} ${t.iface}`, t] as const))(
    '%s is declared in the entry module, not re-exported from a leaf',
    (_name, target) => {
      expect(declared.get(target)).toEqual({ aliased: false, files: [entryOf(target.slice)] });
    },
  );

  it.each(['app-first.ts', 'slice-first.ts'])(
    'merges the app augmentation with a slice augmentation of the declaring file (%s)',
    (entry) => {
      // `notes.settings.ts` carries a `@ts-expect-error` on an undeclared key,
      // so a clean program also proves the key set is not `string`.
      const program = ts.createProgram({ rootNames: [join(dir, entry)], options: compilerOptions() });
      expect(diagnosticsOf(program, dir)).toEqual([]);
    },
    120_000,
  );

});
