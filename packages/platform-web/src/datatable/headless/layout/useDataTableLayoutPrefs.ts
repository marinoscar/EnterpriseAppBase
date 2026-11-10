/**
 * DataTable — per-user layout persistence (issue #255, epic #238).
 *
 * Reads and writes ONE entry of the `dataTables` user-settings namespace
 * through a {@link DataTablePreferencesPort}: by default the existing
 * `GET` / `PATCH /api/user-settings` endpoints over the host's transport. There
 * is no new endpoint and no new permission. With no port (no host mounted, no
 * provider) everything stays in-session.
 *
 * ## Write discipline: debounced, fire-and-forget, in-session authoritative
 *
 * Three properties, and all three exist for the same reason — a layout
 * preference is UI state that happens to be backed up, not domain data being
 * submitted:
 *
 * - **In-session state is authoritative; the server copy is a cache.** The
 *   layout the user sees comes from React state and is applied the instant they
 *   click. The network is told afterwards, and is never consulted again for the
 *   life of the mount. Nothing here ever calls `setState` from a response.
 * - **Fire-and-forget.** A rejected write is logged and dropped. A user who
 *   unchecks a column while offline must still get an unchecked column; making
 *   the checkbox depend on a round trip would trade a working control for a
 *   spinner and, on failure, a control that snaps back for no visible reason.
 * - **Debounced.** Flipping four checkboxes is one intent, so it is one
 *   request. The debounce is on the WRITE, never on the state update.
 *
 * ## Entry-replace PATCH semantics
 *
 * `PATCH /api/user-settings` merges `dataTables` per table id but replaces each
 * ENTRY wholesale — a patch of `{ jobs: { pageSize: 100 } }` drops that
 * entry's stored density and column list. So every write here sends the FULL
 * in-session entry rather than a delta. That is cheap precisely because the
 * hook already holds the complete resolved layout in state; it is also the only
 * way "reset this field" stays expressible.
 *
 * "Reset to defaults" is the merge-patch delete, `{ [tableId]: null }`, which
 * removes the entry entirely and frees its slot against the 40-table cap —
 * rather than storing `{}`, which would be a second way to spell "absent".
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DataTableColumn,
  DataTableDensity,
  DataTableLayout,
  DataTablePaginationConfig,
  DataTableSortConfig,
} from '../types.js';
import {
  DATA_TABLE_ENTRY_MAX_BYTES,
  DATA_TABLE_MAX_ID_LENGTH,
  DATA_TABLE_MAX_SAVED_VIEWS,
  DATA_TABLE_PERSIST_DEBOUNCE_MS,
  DATA_TABLE_VIEW_NAME_MAX_LENGTH,
  encodeVisibility,
  isEmptyStoredLayout,
  isValidStoredExtra,
  jsonByteLength,
  resolveStoredSort,
  resolveUserVisibleColumnIds,
  resolveVisibleColumnIds,
  sanitizeStoredLayout,
  type DataTableSavedView,
  type DataTableStoredLayout,
  type DataTableStoredSort,
  type DataTableViewLayout,
} from './layoutModel.js';
import { useDataTablePreferencesPort } from './preferences.js';

/**
 * Options of {@link useDataTableLayoutPrefs}.
 *
 * @stability experimental
 */
export interface UseDataTableLayoutPrefsOptions<Row> {
  /** Persistence key. Omit (or leave undefined) to keep everything in-session. */
  tableId?: string;
  /** The table's columns, to validate stored choices against. */
  columns: DataTableColumn<Row>[];
  /** The resolved layout, so `detail` folding composes with the user's choice. */
  layout: DataTableLayout;
  /** The page's default density — a floor the user's choice overrides. */
  densityProp?: DataTableDensity;
  /** Controlled sort, so a stored sort can be restored into the page's state. */
  sort?: DataTableSortConfig;
  /** Controlled pagination, likewise for a stored page size. */
  pagination?: DataTablePaginationConfig;
}

/**
 * What {@link useDataTableLayoutPrefs} returns.
 *
 * @stability experimental
 */
export interface DataTableLayoutPrefs {
  /** Effective density: the user's choice, else the page's, else `standard`. */
  density: DataTableDensity;
  /** Column ids this layout draws right now (baseline ∩ user choice). */
  visibleColumnIds: ReadonlySet<string>;
  /** The user's choice alone, ignoring layout folding — what the picker shows. */
  userVisibleColumnIds: ReadonlySet<string>;
  /** `true` once a stored entry has been read (or persistence is off). */
  hydrated: boolean;
  /** `true` when anything differs from the contract defaults. */
  customized: boolean;
  /** Chooses the row density. */
  setDensity: (density: DataTableDensity) => void;
  /** Show/hide one column. Pinned (`hideable: false`) columns are ignored. */
  toggleColumn: (columnId: string, visible: boolean) => void;
  /** Drop every stored preference for this table (the saved views stay) and delete the server entry when nothing else is kept. */
  reset: () => void;
  /** The app's own stored JSON (`extra`), or `undefined` while there is none. Read-only. */
  extra: Readonly<Record<string, unknown>> | undefined;
  /**
   * Sets (or, with `undefined`, removes) one key of `extra`. Refused (returns
   * `false`, nothing changes) when the value is not bounded plain JSON or the
   * entry would outgrow its limit.
   */
  setExtra: (key: string, value: unknown) => boolean;
  /** The saved views, in the order they were saved. */
  savedViews: readonly DataTableSavedView[];
  /**
   * Saves the current layout as a named view (`extra` defaults to the stored
   * one; pass the app's own state, such as the filter model, to capture it).
   * Returns the view, or `null` when refused: a blank or over-long name, 20
   * views already, or an `extra` that is not bounded plain JSON.
   */
  saveView: (name: string, extra?: Record<string, unknown>) => DataTableSavedView | null;
  /**
   * Applies a saved view: its columns, density, extra, and (through the
   * page's own callbacks) its sort and page size. Returns the view so the
   * caller can restore what it kept in `layout.extra`, or `null` for an
   * unknown id.
   */
  applyView: (id: string) => DataTableSavedView | null;
  /** Deletes a saved view. */
  deleteView: (id: string) => void;
}

/**
 * Per-user layout preferences of one table: visible columns, density, sort and page size, restored from and persisted through the {@link DataTablePreferencesPort} in force.
 *
 * In-session state is authoritative: a change applies at once, and the write is debounced and fire-and-forget.
 *
 * @param options - the table id, its columns and the page's controlled sort and pagination.
 * @returns the effective preferences and their setters.
 *
 * @extensionPoint hook
 *
 * @stability experimental
 */
export function useDataTableLayoutPrefs<Row>({
  tableId,
  columns,
  layout,
  densityProp,
  sort,
  pagination,
}: UseDataTableLayoutPrefsOptions<Row>): DataTableLayoutPrefs {
  // The one piece of authoritative state. Everything below either derives from
  // it or pushes it at the network.
  const [entry, setEntry] = useState<DataTableStoredLayout>({});
  const [hydrated, setHydrated] = useState(!tableId);

  const entryRef = useRef(entry);
  entryRef.current = entry;

  // Read through a ref, like the controlled configs below: a port that changes
  // identity must not re-run the hydration effect or the write callback.
  const port = useDataTablePreferencesPort();
  const portRef = useRef(port);
  portRef.current = port;

  // Set as soon as the user touches a control, so a slow GET that lands
  // afterwards can never overwrite a choice already on screen.
  const touchedRef = useRef(false);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read through refs: the controlled configs are recreated inline by most
  // pages, and a restore effect that re-ran on every parent render would fight
  // the page for its own state.
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const sortRef = useRef(sort);
  sortRef.current = sort;
  const paginationRef = useRef(pagination);
  paginationRef.current = pagination;

  /**
   * The sort / page size this table is considered to have "started" at.
   *
   * Seeded once, at hydration, from the STORED entry where it has one and from
   * the page's own props otherwise — so mounting a paginated table does not
   * immediately persist its default page size as though the user had chosen it.
   * Only a later divergence from this baseline is a preference worth storing.
   */
  const mirrorRef = useRef<{ sort: DataTableStoredSort | null; pageSize?: number } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // --- Writes ---------------------------------------------------------------

  const write = useCallback(
    (next: DataTableStoredLayout | null) => {
      if (!tableId) return;
      // `null` deletes the entry (JSON Merge Patch); an object replaces it
      // wholesale, which is why `next` is always the COMPLETE entry.
      //
      // NO `If-Match` HEADER, DELIBERATELY.
      //
      // `PATCH /api/user-settings` supports optimistic concurrency: the
      // controller reads `if-match` and the service compares it against the
      // stored `version`, raising a 409 on a mismatch. The settings page's `useUserSettings`
      // opts into that — it holds the whole settings object, shows a form, and a
      // "settings were updated elsewhere" retry is the right answer there.
      //
      // It is the wrong answer here. This write is fire-and-forget UI backup
      // (see the docblock above): it is debounced, its response is never read,
      // and it only ever touches ONE key of ONE namespace. Sending a version we
      // read at mount would make it fail on any race with a concurrent write to
      // an UNRELATED namespace — a theme toggle in another tab bumps `version`,
      // and the user's column choice would then silently fail to persist for no
      // reason connected to columns. The server-side merge is already per-table
      // and per-namespace, so there is no lost update to protect against: two
      // concurrent writers of the SAME table entry is one user racing themselves.
      //
      // Verified against the API: `expectedVersion` is `undefined` when the
      // header is absent, and the version check is skipped entirely in that case
      // (`user-settings.controller.ts` → `user-settings.service.ts`).
      const target = portRef.current;
      if (!target) return;
      const failed = (error: unknown) => {
        // Fire-and-forget by design: the layout the user is looking at came
        // from state and stays there. Losing the backup is a warning, never
        // a rollback.
        console.warn(`Failed to persist DataTable layout for "${tableId}"`, error);
      };
      try {
        void Promise.resolve(target.save(tableId, next)).catch(failed);
      } catch (error: unknown) {
        failed(error);
      }
    },
    [tableId],
  );

  const cancelPending = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedule = useCallback(
    (next: DataTableStoredLayout) => {
      if (!tableId) return;
      cancelPending();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        write(isEmptyStoredLayout(next) ? null : next);
      }, DATA_TABLE_PERSIST_DEBOUNCE_MS);
    },
    [tableId, cancelPending, write],
  );

  /** Apply a change to the in-session entry, then schedule one write for it. */
  const commit = useCallback(
    (mutate: (current: DataTableStoredLayout) => DataTableStoredLayout) => {
      touchedRef.current = true;
      const next = mutate(entryRef.current);
      // A mutation that declined to change anything (a pinned column, say) is
      // not a write — scheduling one would spend a request on nothing.
      if (next === entryRef.current) return;
      entryRef.current = next;
      setEntry(next);
      schedule(next);
    },
    [schedule],
  );

  // A pending write must survive the unmount that a route change causes —
  // otherwise the last change before navigating away is the one that never
  // lands. Flush it (still fire-and-forget) instead of cancelling it.
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        const pending = entryRef.current;
        if (tableId) write(isEmptyStoredLayout(pending) ? null : pending);
      }
    },
    [tableId, write],
  );

  // --- Hydration ------------------------------------------------------------

  useEffect(() => {
    if (!tableId) {
      mirrorRef.current = {
        sort: sortRef.current?.sort ?? null,
        pageSize: paginationRef.current?.pageSize,
      };
      setHydrated(true);
      return;
    }

    let cancelled = false;
    setHydrated(false);

    void (async () => {
      let stored: DataTableStoredLayout = {};
      try {
        const namespace = await portRef.current?.load();
        stored = sanitizeStoredLayout(namespace?.[tableId]);
      } catch (error: unknown) {
        // Same posture as a failed write: a settings outage costs the user
        // their restored layout, never their ability to use the table.
        console.warn(`Failed to load DataTable layout for "${tableId}"`, error);
      }

      if (cancelled || !mountedRef.current) return;

      // A choice made while the GET was in flight wins: in-session state is
      // authoritative, and the server copy is only ever a starting point.
      if (!touchedRef.current) {
        entryRef.current = stored;
        setEntry(stored);

        // `sort` and `pageSize` are controlled by the PAGE, so restoring them
        // means handing them back through the page's own callbacks rather than
        // holding a second copy here. Both are validated against the current
        // columns first: a stored sort on a column that has since been removed
        // or made unsortable would be a query the server rejects.
        const restoredSort = resolveStoredSort(columnsRef.current, stored);
        const sortConfig = sortRef.current;
        if (restoredSort && sortConfig) {
          const active = sortConfig.sort;
          if (
            !active ||
            active.field !== restoredSort.field ||
            active.direction !== restoredSort.direction
          ) {
            sortConfig.onSortChange(restoredSort);
          }
        }

        const paginationConfig = paginationRef.current;
        if (stored.pageSize && paginationConfig && stored.pageSize !== paginationConfig.pageSize) {
          // Page 0: a different page size makes the current offset meaningless.
          paginationConfig.onPaginationChange({ page: 0, pageSize: stored.pageSize });
        }

        // Baseline for the mirror effect below: a stored value where there is
        // one (the restore we just requested will land on it), the page's own
        // value otherwise. Either way, "no change yet" means "no write yet".
        mirrorRef.current = {
          sort: restoredSort ?? sortRef.current?.sort ?? null,
          pageSize: stored.pageSize ?? paginationRef.current?.pageSize,
        };
      } else {
        mirrorRef.current = {
          sort: sortRef.current?.sort ?? null,
          pageSize: paginationRef.current?.pageSize,
        };
      }

      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [tableId]);

  // --- Mirroring the page's sort / pageSize into the entry -------------------

  const activeSort = sort?.sort ?? null;
  const activePageSize = pagination?.pageSize;

  useEffect(() => {
    if (!tableId || !hydrated) return;
    const baseline = mirrorRef.current;
    if (!baseline) return;

    const nextSort = activeSort
      ? { field: activeSort.field, direction: activeSort.direction }
      : undefined;
    const sortChanged =
      (baseline.sort?.field ?? null) !== (nextSort?.field ?? null) ||
      (baseline.sort?.direction ?? null) !== (nextSort?.direction ?? null);
    const pageSizeChanged = activePageSize !== undefined && baseline.pageSize !== activePageSize;

    if (!sortChanged && !pageSizeChanged) return;

    mirrorRef.current = {
      sort: nextSort ?? null,
      pageSize: activePageSize ?? baseline.pageSize,
    };

    const current = entryRef.current;
    const next: DataTableStoredLayout = { ...current };
    if (sortChanged) {
      if (nextSort) next.sort = nextSort;
      else delete next.sort;
    }
    if (pageSizeChanged) next.pageSize = activePageSize;

    entryRef.current = next;
    setEntry(next);
    schedule(next);
  }, [tableId, hydrated, activeSort, activePageSize, schedule]);

  // --- Derived layout -------------------------------------------------------

  const density = entry.density ?? densityProp ?? 'standard';

  const userVisibleColumnIds = useMemo(
    () => resolveUserVisibleColumnIds(columns, entry),
    [columns, entry],
  );

  const visibleColumnIds = useMemo(
    () => resolveVisibleColumnIds(columns, entry, layout),
    [columns, entry, layout],
  );

  const setDensity = useCallback(
    (next: DataTableDensity) => {
      commit((current) => ({ ...current, density: next }));
    },
    [commit],
  );

  const toggleColumn = useCallback(
    (columnId: string, visible: boolean) => {
      commit((current) => {
        const cols = columnsRef.current;
        const column = cols.find((candidate) => candidate.id === columnId);
        // A pinned column has no hidden state to store.
        if (!column || column.hideable === false) return current;

        const chosen = new Set(resolveUserVisibleColumnIds(cols, current));
        if (visible) chosen.add(columnId);
        else chosen.delete(columnId);

        return { ...current, visibleColumns: encodeVisibility(cols, chosen) };
      });
    },
    [commit],
  );

  const reset = useCallback(() => {
    touchedRef.current = true;
    cancelPending();
    // The saved views are the user's own work, not a layout choice: "reset to
    // defaults" keeps them. With none, the entry is deleted outright.
    const views = entryRef.current.savedViews;
    const kept: DataTableStoredLayout = views && views.length > 0 ? { savedViews: views } : {};
    entryRef.current = kept;
    setEntry(kept);
    // Immediate, not debounced: "reset" is a single deliberate gesture with
    // nothing to coalesce, and it is expressed as the merge-patch DELETE so the
    // entry stops existing rather than becoming an empty object.
    write(isEmptyStoredLayout(kept) ? null : kept);
  }, [cancelPending, write]);

  const setExtra = useCallback(
    (key: string, value: unknown): boolean => {
      const current = entryRef.current;
      const nextExtra: Record<string, unknown> = { ...(current.extra ?? {}) };
      if (value === undefined) delete nextExtra[key];
      else nextExtra[key] = value;
      const hasKeys = Object.keys(nextExtra).length > 0;
      if (hasKeys && !isValidStoredExtra(nextExtra)) return false;
      const next: DataTableStoredLayout = { ...current };
      if (hasKeys) next.extra = nextExtra;
      else delete next.extra;
      if (jsonByteLength(next) > DATA_TABLE_ENTRY_MAX_BYTES) return false;
      commit(() => next);
      return true;
    },
    [commit],
  );

  const saveView = useCallback(
    (name: string, extra?: Record<string, unknown>): DataTableSavedView | null => {
      const trimmed = name.trim();
      if (trimmed === '' || trimmed.length > DATA_TABLE_VIEW_NAME_MAX_LENGTH) return null;
      const current = entryRef.current;
      const views = current.savedViews ?? [];
      if (views.length >= DATA_TABLE_MAX_SAVED_VIEWS) return null;
      const captured = extra ?? current.extra;
      if (captured !== undefined && Object.keys(captured).length > 0 && !isValidStoredExtra(captured)) return null;

      const layout: DataTableViewLayout = {};
      if (current.visibleColumns) layout.visibleColumns = [...current.visibleColumns];
      if (current.density) layout.density = current.density;
      const activeSort = sortRef.current?.sort;
      if (activeSort) layout.sort = { field: activeSort.field, direction: activeSort.direction };
      const size = paginationRef.current?.pageSize;
      if (size) layout.pageSize = size;
      if (captured && Object.keys(captured).length > 0) layout.extra = captured;

      const view: DataTableSavedView = { id: uniqueViewId(trimmed, views), name: trimmed, layout };
      const next: DataTableStoredLayout = { ...current, savedViews: [...views, view] };
      if (jsonByteLength(next) > DATA_TABLE_ENTRY_MAX_BYTES) return null;
      commit(() => next);
      return view;
    },
    [commit],
  );

  const applyView = useCallback(
    (id: string): DataTableSavedView | null => {
      const view = entryRef.current.savedViews?.find((candidate) => candidate.id === id);
      if (!view) return null;
      commit((current) => ({ ...view.layout, ...(current.savedViews ? { savedViews: current.savedViews } : {}) }));
      // Sort and page size are the PAGE's state: hand them back through its own
      // callbacks, validated against the current columns like a restored layout.
      const restoredSort = resolveStoredSort(columnsRef.current, view.layout);
      const sortConfig = sortRef.current;
      if (restoredSort && sortConfig) sortConfig.onSortChange(restoredSort);
      const paginationConfig = paginationRef.current;
      if (view.layout.pageSize && paginationConfig && view.layout.pageSize !== paginationConfig.pageSize) {
        paginationConfig.onPaginationChange({ page: 0, pageSize: view.layout.pageSize });
      }
      return view;
    },
    [commit],
  );

  const deleteView = useCallback(
    (id: string) => {
      commit((current) => {
        const views = current.savedViews;
        if (!views?.some((view) => view.id === id)) return current;
        const remaining = views.filter((view) => view.id !== id);
        const next: DataTableStoredLayout = { ...current };
        if (remaining.length > 0) next.savedViews = remaining;
        else delete next.savedViews;
        return next;
      });
    },
    [commit],
  );

  return {
    density,
    visibleColumnIds,
    userVisibleColumnIds,
    hydrated,
    customized: !isEmptyStoredLayout({ ...entry, savedViews: undefined }),
    setDensity,
    toggleColumn,
    reset,
    extra: entry.extra,
    setExtra,
    savedViews: entry.savedViews ?? NO_VIEWS,
    saveView,
    applyView,
    deleteView,
  };
}

const NO_VIEWS: readonly DataTableSavedView[] = Object.freeze([]);

/** A slug of the name that no existing view uses, within the id length bound. */
function uniqueViewId(name: string, views: readonly DataTableSavedView[]): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, DATA_TABLE_MAX_ID_LENGTH - 6) || 'view';
  const taken = new Set(views.map((view) => view.id));
  let candidate = base;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}-${n}`;
  return candidate;
}
