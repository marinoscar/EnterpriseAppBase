import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseManifest, type ManifestEntry } from '../../src/lock/index.js';

/** The fixture package + app of `test/fixtures/migrations-basic`. */
export const FIXTURE_ROOT = resolve(__dirname, '..', 'fixtures', 'migrations-basic');

export interface Workspace {
  /** The package directory (manifest, migrations, package.json). */
  packageDir: string;
  /** The app directory (holds `prisma/`). */
  appDir: string;
  /** `prisma/migrations` of the app. */
  migrationsDir: string;
  /** `prisma/platform.lock` of the app. */
  lockFile: string;
}

/** A writable copy of the fixture package and app under the OS temp directory. */
export function makeWorkspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), 'platform-db-fixture-'));
  cpSync(join(FIXTURE_ROOT, 'package'), join(root, 'package'), { recursive: true });
  cpSync(join(FIXTURE_ROOT, 'app'), join(root, 'app'), { recursive: true });
  return {
    packageDir: join(root, 'package'),
    appDir: join(root, 'app'),
    migrationsDir: join(root, 'app', 'prisma', 'migrations'),
    lockFile: join(root, 'app', 'prisma', 'platform.lock'),
  };
}

/** The fixture manifest. */
export function fixtureManifest(): ManifestEntry[] {
  return parseManifest(readFileSync(join(FIXTURE_ROOT, 'package', 'migrations', 'manifest.json'), 'utf8'));
}

/** Rewrites a file, keeping nothing of the old bytes. */
export function overwrite(file: string, content: string | Uint8Array): void {
  writeFileSync(file, content);
}
