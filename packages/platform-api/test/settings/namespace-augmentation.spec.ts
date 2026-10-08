// A compile-only proof (issue #865): an app that augments
// `SystemSettingsNamespaces` from OUTSIDE the package, by its public specifier
// `@marinoscar/platform-api/settings`, gets a typed `getNamespace(key)`, in
// whatever order the checker meets its file and the slices' own augmentations.
//
// The defect it pins: the interface used to be declared in
// `registry/system-settings-namespace.ts` and only re-exported by the slice's
// entry module. An app's augmentation then merged through the re-export alias,
// and a slice's augmentation of the DECLARING file processed after it (any
// installed slice's `.d.ts`: storage, ai, db-backup) replaced the merged
// symbol, so `keyof SystemSettingsNamespaces` lost the app's key. The starter
// (#741) hit it with its `notes` namespace as soon as its adapters imported
// `@marinoscar/platform-api/storage`. Both orders below must compile clean.
//
// Each program is the fixture app plus the package's sources reached from it,
// resolved by the public specifiers (`paths`), type-checked with the package's
// own compiler options. Nothing is emitted. The consumer smoke
// (tests/consumer-smoke/api/src/notes.settings.ts) repeats the check against
// the packed `.d.ts` files.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as ts from 'typescript';

const PACKAGE_ROOT = join(__dirname, '..', '..');

// The fixture app, written to a temporary directory outside the package (so
// neither the package's typecheck nor its build ever sees it). `notes.settings`
// is the app's namespace file, the shape the starter's has.
const FIXTURE_FILES: Record<string, string> = {
  'notes.settings.ts': `
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
`,
  // Any installed slice that augments the interface itself.
  'storage.reader.ts': `
import type { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { STORAGE_SYSTEM_SETTINGS } from '@marinoscar/platform-api/storage';

export const STORAGE_KEY = STORAGE_SYSTEM_SETTINGS.key;

export async function storageBucket(settings: SystemSettingsService): Promise<string> {
  return (await settings.getNamespace('storage')).bucket;
}
`,
  'app-first.ts': `
import './notes.settings';
import './storage.reader';
`,
  'slice-first.ts': `
import './storage.reader';
import './notes.settings';
`,
};

function writeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'platform-api-augment-'));
  for (const [name, source] of Object.entries(FIXTURE_FILES)) writeFileSync(join(dir, name), source);
  return dir;
}

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
    paths: {
      '@marinoscar/platform-api/settings': [join(PACKAGE_ROOT, 'src', 'settings', 'index.ts')],
      '@marinoscar/platform-api/storage': [join(PACKAGE_ROOT, 'src', 'storage', 'index.ts')],
    },
  };
}

function diagnosticsFor(rootNames: string[]): string[] {
  const program = ts.createProgram({ rootNames, options: compilerOptions() });
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => {
      const where = d.file ? `${d.file.fileName.replace(PACKAGE_ROOT, '')}:${d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}` : '';
      return `${where} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
    });
}

describe('SystemSettingsNamespaces augmented from outside the package (#865)', () => {
  let dir: string;

  beforeAll(() => {
    dir = writeFixture();
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // `notes.settings.ts` carries a `@ts-expect-error` on an undeclared key, so a
  // clean program also proves the key set is not `string` (the check is not vacuous).
  it('types getNamespace(key) when the app augmentation is met BEFORE a slice augmentation', () => {
    // The starter's order: its namespace file first, then a module that pulls
    // in a slice augmenting the interface itself.
    expect(diagnosticsFor([join(dir, 'app-first.ts')])).toEqual([]);
  });

  it('types getNamespace(key) when the app augmentation is met AFTER a slice augmentation', () => {
    expect(diagnosticsFor([join(dir, 'slice-first.ts')])).toEqual([]);
  });
});
