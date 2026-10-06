// =============================================================================
// The generated system settings defaults catalog (issue #677)
// =============================================================================
//
// `prisma/seed.ts` runs under `ts-node --transpile-only` from `apps/api/prisma`,
// and the production image carries `prisma/` but not `src/`. So the seed cannot
// import `DEFAULT_SYSTEM_SETTINGS`; it reads a COMMITTED, GENERATED copy,
// `prisma/catalog/system-settings-defaults.json`, rendered by this function
// (`npm run catalog:settings --workspace=api`). The staleness check
// (`--check`, and `test/settings/settings-catalog.spec.ts`) renders it again
// and compares, so a namespace whose defaults change without regenerating the
// file fails CI with the fix command in the message.
// =============================================================================

import './system-settings.manifest';
import { composeDefaultSystemSettings } from './compose';

/** The catalog's path, relative to `apps/api`. */
export const SYSTEM_SETTINGS_CATALOG_RELATIVE_PATH = 'prisma/catalog/system-settings-defaults.json';

/** The fix a stale catalog asks for. Tests and the `--check` mode print it verbatim. */
export const SETTINGS_CATALOG_STALE_MESSAGE =
  `${SYSTEM_SETTINGS_CATALOG_RELATIVE_PATH} is stale: run npm run catalog:settings --workspace=api`;

/**
 * The catalog file's exact contents: `DEFAULT_SYSTEM_SETTINGS` as 2-space JSON
 * with a trailing newline, key order preserved (it is the stored JSON's key
 * order). Nothing else is in the file, so the seed writes exactly this value.
 */
export function renderSystemSettingsCatalog(): string {
  // Composed from the registry as it is NOW (not the module-load snapshot), so
  // the staleness check sees a namespace a test adds with `withTemporaryEntries`.
  return `${JSON.stringify(composeDefaultSystemSettings(), null, 2)}\n`;
}

/**
 * Compare a catalog file's contents (`undefined` when the file is missing)
 * with what the registry renders now.
 *
 * @returns `null` when current, else the message to print ({@link SETTINGS_CATALOG_STALE_MESSAGE}).
 */
export function checkSystemSettingsCatalog(contents: string | undefined): string | null {
  return contents === renderSystemSettingsCatalog() ? null : SETTINGS_CATALOG_STALE_MESSAGE;
}
