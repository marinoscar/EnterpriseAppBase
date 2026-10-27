// =============================================================================
// The system settings defaults catalog (issue #677, moved by #733)
// =============================================================================
//
// An app's seed cannot import its namespace declarations (the seed runs from
// `prisma/` without `src/`), so it reads a COMMITTED, GENERATED copy of the
// composed defaults. These two functions render that file and check it; the
// app owns the file's path, its generator script and the fix command its
// staleness message names.
// =============================================================================

import { composeDefaultSystemSettings } from './compose';

/**
 * The catalog file's exact contents: the composed defaults of every
 * registered system namespace as 2-space JSON with a trailing newline, key
 * order preserved (it is the stored JSON's key order). Composed from the
 * registry as it is NOW, so a namespace a test adds with
 * `withTemporaryEntries` is included.
 *
 * @returns the file contents.
 *
 * @stability experimental
 */
export function renderSystemSettingsCatalog(): string {
  return `${JSON.stringify(composeDefaultSystemSettings(), null, 2)}\n`;
}

/**
 * Compares a catalog file's contents (`undefined` when the file is missing)
 * with what the registry renders now.
 *
 * @param contents - the committed file, or `undefined`.
 * @param staleMessage - what to return when it is stale (the app's fix command).
 * @returns `null` when current, else `staleMessage`.
 *
 * @stability experimental
 */
export function checkSystemSettingsCatalog(contents: string | undefined, staleMessage: string): string | null {
  return contents === renderSystemSettingsCatalog() ? null : staleMessage;
}
