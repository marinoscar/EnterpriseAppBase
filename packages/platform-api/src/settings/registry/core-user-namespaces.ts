// =============================================================================
// User settings namespaces `dataTables` and `navigation` (issue #677)
// =============================================================================
//
// Declaration file: pure data, imports only leaf modules (the contract's zod
// schemas and constants, and Nest's exception type). The platform owns these
// two UI-preference namespaces; the app registers them (first) in its user
// manifest. Moved from the reference app by #733; the merge and cap bodies
// are unchanged.
// =============================================================================

import { BadRequestException } from '@nestjs/common';
import {
  DATA_TABLE_MAX_TABLES,
  dataTablesPatchSchema,
  dataTablesSchema,
  navigationPatchSchema,
  navigationSchema,
  type DataTablesPatchValue,
  type DataTablesValue,
  type NavigationPatchValue,
  type NavigationValue,
} from '@marinoscar/platform-contract/settings';

import type { UserSettingsNamespace } from './user-settings-namespace';

/**
 * The user namespace `dataTables`: per-table view preferences (visible
 * columns, density, page size, sort), keyed by table id. Optional and never
 * defaulted; at most `DATA_TABLE_MAX_TABLES` entries (a 400 past it).
 * Register it (with {@link NAVIGATION_USER_SETTINGS}) first in the app's user
 * manifest: registration order is the composed schemas' key order.
 *
 * @stability stable
 */
export const DATA_TABLES_USER_SETTINGS = {
  /** The namespace key. */
  key: 'dataTables',
  /** What it holds. */
  description: 'Per-table view preferences (visible columns, density, page size, sort), keyed by table id.',
  /** The stored shape. */
  schema: dataTablesSchema,
  // The outer `.nullable()` the composition adds is what lets
  // `{ "dataTables": null }` clear the whole namespace; the inner nullability
  // (in dataTablesPatchSchema) is what lets `{ "dataTables": { "jobs": null } }`
  // delete a single entry.
  /** The PATCH shape. */
  patchSchema: dataTablesPatchSchema,
  /**
   * Merge the `dataTables` namespace using JSON Merge Patch semantics,
   * PER TABLE ID.
   *
   * - patch absent            =\> keep the stored namespace untouched
   * - patch is `null`         =\> clear the whole namespace
   * - `{ jobs: null }`        =\> delete the `jobs` entry, leave others alone
   * - `{ jobs: { pageSize } }` =\> REPLACE the `jobs` entry wholesale. This is
   *   deliberately not a deep merge: a table's preferences are a single
   *   coherent view state, and a client that sends a partial entry is stating
   *   the entry it wants, so any previously stored `density` for `jobs` is
   *   discarded. Entries for other tables are never affected.
   *
   * An empty result collapses to `undefined` so the namespace disappears from
   * storage rather than persisting as `{}`.
   */
  merge(current: DataTablesValue | undefined, patch: DataTablesPatchValue | null | undefined) {
    if (patch === undefined) {
      return current;
    }

    if (patch === null) {
      return undefined;
    }

    const merged: DataTablesValue = { ...(current ?? {}) };

    for (const [tableId, entry] of Object.entries(patch)) {
      if (entry === null) {
        delete merged[tableId];
      } else if (entry !== undefined) {
        merged[tableId] = entry;
      }
    }

    return Object.keys(merged).length > 0 ? merged : undefined;
  },
  /**
   * Enforce the per-user cap on the number of persisted data table entries.
   *
   * This is a storage-exhaustion control (see
   * user-settings-namespaces.schema.ts), and it is enforced HERE rather than in
   * zod for two reasons:
   *
   * 1. `z.record()` cannot express "at most N keys" — there is no key-count
   *    refinement that survives the record type.
   * 2. Even if it could, the cap has to be checked against the MERGED result,
   *    not the request body: a 3-entry patch on top of 39 stored entries is
   *    over the cap while the body alone is not. Doing that check inside the
   *    post-merge `userSettingsSchema.parse()` would surface it as a raw
   *    `ZodError` thrown from the service — which escapes as a 500, not the
   *    400 the client deserves. Hence an explicit BadRequestException.
   */
  assertLimits(dataTables: DataTablesValue | undefined): void {
    if (!dataTables) {
      return;
    }

    const count = Object.keys(dataTables).length;
    if (count > DATA_TABLE_MAX_TABLES) {
      throw new BadRequestException(
        `Too many data table preferences: ${count} exceeds the maximum of ${DATA_TABLE_MAX_TABLES}. Remove entries for tables you no longer use (send them as null) before adding new ones.`,
      );
    }
  },
} satisfies UserSettingsNamespace<'dataTables', DataTablesValue, DataTablesPatchValue>;

/**
 * The user namespace `navigation`: navigation chrome preferences (whether the
 * rail is collapsed). Optional and never defaulted.
 *
 * @stability stable
 */
export const NAVIGATION_USER_SETTINGS = {
  /** The namespace key. */
  key: 'navigation',
  /** What it holds. */
  description: 'Navigation chrome preferences (whether the navigation rail is collapsed).',
  /** The stored shape. */
  schema: navigationSchema,
  /** The PATCH shape. */
  patchSchema: navigationPatchSchema,
  /**
   * Merge the `navigation` namespace field-wise.
   *
   * - patch absent           =\> keep the stored namespace untouched
   * - patch is `null`        =\> clear the whole namespace
   * - field omitted          =\> stored value untouched
   * - field set to a value   =\> replaces the stored value
   * - field set to `null`    =\> deletes the field, so the client falls back to
   *   its built-in default rather than to a hard-coded stored one
   *
   * As with dataTables, an empty result collapses to `undefined`.
   */
  merge(current: NavigationValue | undefined, patch: NavigationPatchValue | null | undefined) {
    if (patch === undefined) {
      return current;
    }

    if (patch === null) {
      return undefined;
    }

    const merged: NavigationValue = { ...(current ?? {}) };

    if (patch.railCollapsed === null) {
      delete merged.railCollapsed;
    } else if (patch.railCollapsed !== undefined) {
      merged.railCollapsed = patch.railCollapsed;
    }

    return Object.keys(merged).length > 0 ? merged : undefined;
  },
} satisfies UserSettingsNamespace<'navigation', NavigationValue, NavigationPatchValue>;

declare module './user-settings-namespace' {
  interface UserSettingsNamespaces {
    /**
     * Per-table view preferences, keyed by table id.
     *
     * Optional on purpose, and derived from the zod schema so the two can never
     * drift. Absent means "the user has expressed no table preferences yet" —
     * NOT "empty preferences".
     */
    dataTables: DataTablesValue;
    /** Navigation chrome preferences. Absent means "use built-in defaults". */
    navigation: NavigationValue;
  }
  interface UserSettingsNamespaceDeclarations {
    /** The `dataTables` declaration. */
    dataTables: typeof DATA_TABLES_USER_SETTINGS;
    /** The `navigation` declaration. */
    navigation: typeof NAVIGATION_USER_SETTINGS;
  }
}
