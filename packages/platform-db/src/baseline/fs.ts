import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Every directory name under `prisma/migrations` (sorted), whether or not it holds a `migration.sql`. */
export function listDirs(migrationsDir: string): string[] {
  if (!existsSync(migrationsDir)) return [];
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Directory name to `migration.sql` bytes for every directory that has one. */
export function readLocalMigrations(migrationsDir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const dir of listDirs(migrationsDir)) {
    const file = join(migrationsDir, dir, 'migration.sql');
    if (existsSync(file)) out.set(dir, readFileSync(file));
  }
  return out;
}

/** Creates `<migrationsDir>/<localDir>/migration.sql` with exactly `bytes`; refuses an existing directory. */
export function installMigration(migrationsDir: string, localDir: string, bytes: Uint8Array): void {
  mkdirSync(migrationsDir, { recursive: true });
  const dir = join(migrationsDir, localDir);
  mkdirSync(dir); // throws EEXIST: the baseline never writes into an existing directory
  writeFileSync(join(dir, 'migration.sql'), bytes);
}

/** Removes a directory the baseline itself created (a failed resolve); nothing else is ever removed. */
export function removeInstalled(migrationsDir: string, localDir: string): void {
  rmSync(join(migrationsDir, localDir), { recursive: true, force: true });
}
