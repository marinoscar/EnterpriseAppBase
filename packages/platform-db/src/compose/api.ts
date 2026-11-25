// The filesystem-facing API of the composer: load fragments, write or check
// the generated folder. The pure composition is in ./compose.ts.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { composeFragments, type FragmentInput } from './compose.js';
import { lineDiff } from './diff.js';

/**
 * Where the composer reads and writes.
 *
 * @stability experimental
 */
export interface ComposeOptions {
  /** The package's own fragments (`base.prisma` and one file per slice). Default: the `schema/` folder shipped in this package. */
  platformSchemaDir?: string;
  /**
   * The app's fragment folder (for the reference app `apps/api/prisma/fragments`): its own models and the `extend model` blocks that add back-relations to a platform model.
   * A missing folder means the app has no fragments. Only `*.prisma` files directly inside it are read.
   *
   * @extensionPoint option
   */
  appFragmentsDir: string;
  /** The generated folder Prisma reads (for the reference app `apps/api/prisma/schema`). */
  outDir: string;
}

/**
 * One generated schema file.
 *
 * @stability experimental
 */
export interface ComposedFile {
  /** Where the file belongs: inside `outDir`, named `platform.<slice>.prisma` or `app.<fragment>.prisma`. */
  path: string;
  /** The full text, starting with the do-not-edit header. */
  contents: string;
}

/**
 * The generated schema files and anything worth telling the developer.
 *
 * @stability experimental
 */
export interface ComposeResult {
  /** One entry per generated file. */
  files: ComposedFile[];
  /** Non-fatal observations (for example an app `base.prisma` replacing the package's). */
  warnings: string[];
}

/**
 * Outcome of {@link checkComposedSchema}.
 *
 * @stability experimental
 */
export interface ComposeCheck {
  /** True when every generated file on disk equals a fresh composition and no stale file exists. */
  upToDate: boolean;
  /** A readable listing of what differs; empty when `upToDate`. */
  diff: string;
}

/** The `schema/` folder shipped in this package (`src/compose` and `dist/compose` are both two levels below the package root). */
const PACKAGE_SCHEMA_DIR = resolve(__dirname, '..', '..', 'schema');

function load(dir: string, origin: 'package' | 'app'): FragmentInput[] {
  if (!existsSync(dir)) {
    if (origin === 'package') throw new Error(`platform schema folder not found: ${dir}`);
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.prisma'))
    .map((e) => ({ origin, name: e.name, path: join(dir, e.name), text: readFileSync(join(dir, e.name), 'utf8') }));
}

/**
 * Composes the platform fragments and the app's fragments into the generated
 * schema files. Reads the fragment folders; writes nothing.
 *
 * @param opts - Folders to read and the output folder to name.
 * @returns The files that belong in `outDir` and any warnings.
 * @throws `ComposeError` when a fragment breaks a rule (see the rule table in the database ADR).
 * @stability experimental
 */
export function composeSchema(opts: ComposeOptions): ComposeResult {
  const inputs = [
    ...load(opts.platformSchemaDir ?? PACKAGE_SCHEMA_DIR, 'package'),
    ...load(opts.appFragmentsDir, 'app'),
  ];
  const { files, warnings } = composeFragments(inputs);
  return {
    files: [...files].map(([name, contents]) => ({ path: join(opts.outDir, name), contents })),
    warnings,
  };
}

/**
 * Composes and writes the generated folder: creates it if missing, replaces
 * changed files and deletes `*.prisma` files that no fragment produces any
 * more. Other files in the folder are left alone.
 *
 * @param opts - Folders to read and the folder to write.
 * @returns What was written.
 * @throws `ComposeError` when a fragment breaks a rule; nothing is written then.
 * @stability experimental
 */
export function writeComposedSchema(opts: ComposeOptions): ComposeResult {
  const result = composeSchema(opts);
  mkdirSync(opts.outDir, { recursive: true });
  const keep = new Set(result.files.map((f) => f.path));
  for (const name of readdirSync(opts.outDir)) {
    const path = join(opts.outDir, name);
    if (name.endsWith('.prisma') && !keep.has(path)) rmSync(path);
  }
  for (const f of result.files) {
    if (!existsSync(f.path) || readFileSync(f.path, 'utf8') !== f.contents) writeFileSync(f.path, f.contents);
  }
  return result;
}

/**
 * Compares the generated folder with a fresh composition without writing
 * anything (the `--check` mode CI runs, like `openapi:dump` plus a diff).
 * Line endings are ignored so a Windows checkout with CRLF still passes.
 *
 * @param opts - Folders to read and the generated folder to compare.
 * @returns Whether the folder is current, and what differs when it is not.
 * @throws `ComposeError` when a fragment breaks a rule.
 * @stability experimental
 */
export function checkComposedSchema(opts: ComposeOptions): ComposeCheck {
  const { files } = composeSchema(opts);
  const parts: string[] = [];
  const expected = new Set(files.map((f) => f.path));
  for (const f of files) {
    if (!existsSync(f.path)) {
      parts.push(`missing: ${f.path}`);
      continue;
    }
    const onDisk = readFileSync(f.path, 'utf8').replace(/\r\n/g, '\n');
    if (onDisk !== f.contents) parts.push(`changed: ${f.path}\n${lineDiff(onDisk, f.contents)}`);
  }
  if (existsSync(opts.outDir)) {
    for (const name of readdirSync(opts.outDir).sort()) {
      const path = join(opts.outDir, name);
      if (name.endsWith('.prisma') && !expected.has(path)) parts.push(`stale (no fragment produces it): ${path}`);
    }
  }
  return { upToDate: parts.length === 0, diff: parts.join('\n') };
}
