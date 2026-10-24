import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SyncError } from '../sync/index.js';

/** Reads a file's bytes; `undefined` when the path does not exist. */
export function readBytes(file: string): Uint8Array | undefined {
  try {
    return readFileSync(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined;
    throw error;
  }
}

/** Directory names (files such as `migration_lock.toml` excluded) of an app's `prisma/migrations`. */
export function listMigrationDirs(migrationsDir: string): string[] {
  if (!existsSync(migrationsDir)) return [];
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Creates `<migrationsDir>/<localDir>/migration.sql` with exactly `bytes`; refuses an existing directory. */
export function writeLocalMigration(migrationsDir: string, localDir: string, bytes: Uint8Array): void {
  mkdirSync(migrationsDir, { recursive: true });
  const dir = join(migrationsDir, localDir);
  try {
    mkdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new SyncError('LOCAL_DIR_EXISTS', `prisma/migrations/${localDir} already exists; sync never rewrites an existing directory`);
    }
    throw error;
  }
  writeFileSync(join(dir, 'migration.sql'), bytes);
}
