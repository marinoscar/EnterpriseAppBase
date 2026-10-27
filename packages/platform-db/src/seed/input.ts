// Building a PlatformSeedInput from the registries' plain-data snapshots
// (issue #712). The snapshots are the committed JSON catalogs an app renders
// from its permission and settings registries (`prisma/catalog/`), because the
// seed runs in a production image that carries `prisma/` but not `src/`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PlatformSeedInput, SeedNamedEntry } from './types.js';

/**
 * The permission registries as plain data: the shape of
 * `prisma/catalog/permissions.json`.
 *
 * @stability experimental
 */
export interface PermissionCatalogSnapshot {
  /** Every role, in registration order. */
  roles: ReadonlyArray<SeedNamedEntry>;
  /** Every permission, in registration order. */
  permissions: ReadonlyArray<SeedNamedEntry>;
  /** Default grants: role name to permission names. */
  rolePermissions: Readonly<Record<string, readonly string[]>>;
}

/**
 * The registries' plain-data snapshots, as {@link platformSeedInputFrom} takes them.
 *
 * @stability experimental
 */
export interface SeedRegistrySnapshot {
  /** The roles, permissions and default grants. */
  permissions: PermissionCatalogSnapshot;
  /** The `global` system settings value: every namespace's defaults, in registration order. */
  settings: Readonly<Record<string, unknown>>;
}

/**
 * Build the seed input from the registries' snapshots and the process
 * environment.
 *
 * Pure: it reads nothing but its arguments. The initial administrator is the
 * `INITIAL_ADMIN_EMAIL` entry of `env`; an unset or empty value means none.
 *
 * @param snapshot - The permission and settings snapshots (see {@link readSeedSnapshot}).
 * @param env - The environment to read `INITIAL_ADMIN_EMAIL` from, normally `process.env`.
 * @returns The input for `seedPlatform`.
 *
 * @stability experimental
 */
export function platformSeedInputFrom(snapshot: SeedRegistrySnapshot, env: NodeJS.ProcessEnv): PlatformSeedInput {
  const input: PlatformSeedInput = {
    roles: snapshot.permissions.roles,
    permissions: snapshot.permissions.permissions,
    roleGrants: snapshot.permissions.rolePermissions,
    systemSettingsDefaults: snapshot.settings,
  };
  const initialAdminEmail = env.INITIAL_ADMIN_EMAIL;
  return initialAdminEmail ? { ...input, initialAdminEmail } : input;
}

/** True for a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read and parse one catalog file, naming it in every failure. */
function readJson(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`Seed catalog ${path} cannot be read (${(error as Error).message}). Regenerate it with the app's catalog scripts.`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Seed catalog ${path} is not valid JSON (${(error as Error).message}). Regenerate it with the app's catalog scripts.`);
  }
}

/**
 * Read the two committed catalogs of an app's `prisma/catalog/` folder:
 * `permissions.json` and `system-settings-defaults.json`.
 *
 * @param catalogDir - The folder holding both files (the reference app passes `join(__dirname, 'catalog')` from `prisma/`).
 * @returns The snapshots for {@link platformSeedInputFrom}.
 * @throws When a file is missing, is not JSON, or lacks the expected shape; the message names the file.
 *
 * @stability experimental
 */
export function readSeedSnapshot(catalogDir: string): SeedRegistrySnapshot {
  const permissionsPath = join(catalogDir, 'permissions.json');
  const permissions = readJson(permissionsPath);
  if (!isRecord(permissions) || !Array.isArray(permissions.roles) || !Array.isArray(permissions.permissions) || !isRecord(permissions.rolePermissions)) {
    throw new Error(`Seed catalog ${permissionsPath} must hold "roles", "permissions" (arrays) and "rolePermissions" (an object).`);
  }
  const settingsPath = join(catalogDir, 'system-settings-defaults.json');
  const settings = readJson(settingsPath);
  if (!isRecord(settings)) {
    throw new Error(`Seed catalog ${settingsPath} must hold one object of settings namespaces.`);
  }
  return { permissions: permissions as unknown as PermissionCatalogSnapshot, settings };
}
