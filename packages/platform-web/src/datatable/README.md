# @marinoscar/platform-web/datatable

The responsive `DataTable` of the web package (issue #897, from the modularity audit #893), in three entries: `/datatable/headless` (the column and prop types, the filter operators, model and URL state, the layout-preference model and hook with their storage port, the CSV export model and the virtualization planners), `/datatable/ui` (the table itself: a virtualized grid on desktop and tablet, a card list on a phone, with the filter bar, view bar, export control, bulk-action bar and row actions) and `/datatable/testing` (the jsdom layout stubs and the shared conformance suite). It depends on the `core` slice only (`packages/platform-slices.json`).

## Purpose and scope

One table for every list in an app, so a page declares its columns and rows and gets the rest:
- **Three layouts from the container's width**, not the viewport's: the desktop grid (MUI X DataGrid, virtualized past a row threshold), the tablet grid with a row expander for the detail columns, and the phone card list with a sort control and compact pagination. A table inside a narrow drawer switches on its own.
- **Server-side everything.** Sorting, pagination and filtering are controlled by the page (`sort`, `pagination`, `filters` with `onFiltersChange`); the table reports changes and never sorts or filters the rows it is given. Quick search, the filter editor and the filter chips can be mirrored to URL parameters (`readDataTableUrlState`, `writeDataTableUrlState`).
- **Per-user layout.** With a `tableId`, the visible columns, density, sort and page size are restored on mount and saved (debounced, fire-and-forget) through a `DataTablePreferencesPort`. The in-session state is authoritative; the stored copy is a backup.
- **An open filter vocabulary.** The five built-in filter types (`text`, `number`, `date`, `enum`, `boolean`) are registered through `registerDataTableFilterType`, the call an app uses to add its own (`tags`, `user`): operators with their labels and arities, the operand control, a URL coercion and a row-matching rule. A column opts in with `filter: { type, editor?, operators? }`; a column's `editor` and `operators` replace the type's for that column only. `FilterOperator` and `DataTableFilterType` are `Builtin | (string & {})`.
- **Layout the app can extend.** The stored layout keeps a bounded `extra` (the app's own JSON: saved filters, a chart toggle) and up to 20 `savedViews`, validated by the settings API on write and by `sanitizeStoredLayout` on read. `useDataTableLayoutPrefs` exposes `saveView`, `applyView`, `deleteView` and `setExtra`.
- **Slots.** `slots={{ Toolbar, BulkBar }}`: extra controls above the table, and a replacement for the bulk-action bar. With none, the markup is unchanged.
- **CSV export** of the rows on screen or of every row the server holds (`csvExport`), with formula neutralisation and a row ceiling.
- **Accessibility.** 44px touch targets, a row and list semantics contract, live-region announcements and the DataGrid keyboard model; `/testing` carries the suite that enforces them.

Not here: any data fetching (the page owns it), the `user-settings` API (`@marinoscar/platform-api/settings` owns the `dataTables` namespace and its validation), and a colour system (the table reads the host's MUI theme; the app pins its own palette's contrast).

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { DataTable } from '@marinoscar/platform-web/datatable/ui';
import type { DataTableColumn } from '@marinoscar/platform-web/datatable/headless';
```

`/ui` needs the optional peer `@mui/x-data-grid` (the package's other peers, `react`, `@mui/material` and `@mui/icons-material`, apply). `/testing` is test-only and needs the optional peers `vitest`, `@testing-library/react`, `@testing-library/user-event` and `vitest-axe`, plus `@testing-library/jest-dom` registered in the test setup.

## Quick start

The reference app hands the table to every packaged slice through that slice's adapters ([`apps/web/src/platform/identityAdapters.ts`](../../../../apps/web/src/platform/identityAdapters.ts)):

```tsx
import { DataTable } from '@marinoscar/platform-web/datatable/ui';

export const appIdentityAdapters = { DataTable /* , ... */ };
```

A page uses it directly the same way:

```tsx
<DataTable<Job>
  tableId="jobs"
  ariaLabel="Jobs"
  columns={columns}
  rows={jobs}
  rowId={(job) => job.id}
  sort={{ sort, onSortChange: setSort }}
  pagination={{ page, pageSize, total, onPaginationChange: setPaging }}
/>
```

With a `PlatformHostProvider` above it the layout is kept in the user's settings. To keep it elsewhere, supply a port (see [`apps/web/src/__tests__/components/datatable/DataTablePreferencesPort.test.tsx`](../../../../apps/web/src/__tests__/components/datatable/DataTablePreferencesPort.test.tsx)):

```tsx
<DataTablePreferencesProvider port={{ load, save }}>
  <Page />
</DataTablePreferencesProvider>
```

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `DataTable` `columns`, `rows`, `rowId` | see `DataTableProps` | required | What to draw |
| `DataTable` `ariaLabel` | `string` | none | The grid's accessible name; strongly recommended |
| `DataTable` `tableId` | `string` | none | Keys the stored layout; omitted keeps preferences in-session only |
| `DataTable` `renderer` | `'auto' \| 'desktop' \| 'tablet' \| 'mobile'` | `'auto'` | Forces a layout instead of measuring the container |
| `DataTable` `mobileBreakpoint`, `tabletBreakpoint` | `number` | `600`, `1200` | Container widths (px) at which the layout changes |
| `DataTable` `slots` | `DataTableSlots<Row>` | none | `Toolbar` (extra controls above the table; receives the table state, `prefs` and the page's `onFiltersChange`) and `BulkBar` (replaces the bulk-action bar while rows are selected) |
| `DataTableColumn` `filter` | `{ type; editor?; operators? }` | none | The column's filter in one declaration; makes it filterable (unless `filterable: false`) and wins over `filterType` |
| `DataTable` `csvExport` | `DataTableExportConfig` | none | Turns the export control on; `fetchAllRows` lets it export every server row |
| `DataTablePreferencesProvider` `port` | `DataTablePreferencesPort` | the user-settings routes over the host transport | Where layouts are kept |
| `runDataTableConformanceSuite` `themes` | `{ light, dark }` | MUI defaults | The themes the axe passes render under |

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `DataTable` | component | `DataTable<Row>(props: DataTableProps<Row>): ReactElement` | Any list of rows, on every breakpoint | experimental | [example](../../../../apps/web/src/platform/identityAdapters.ts) |
| `useDataTableLayoutPrefs` | hook | `useDataTableLayoutPrefs<Row>(options: UseDataTableLayoutPrefsOptions<Row>): DataTableLayoutPrefs` | Own the visible columns, density, sort and page size of a table you render yourself | experimental | [example](../../../../apps/web/src/__tests__/components/datatable/DataTablePreferencesPort.test.tsx) |
| `registerDataTableFilterType` | registry | `registerDataTableFilterType(def: DataTableFilterTypeDef): () => void` | Add a filter type (`tags`, `user`): its operators, operand editor, URL coercion and row matching; returns the unregister function | experimental | [example](../../../../apps/web/src/platform-extensions/datatable/TagsFilterType.example.tsx) |
| `DataTableColumn.filter` | option | `filter?: { type: string; editor?: ComponentType<FilterValueEditorProps>; operators?: FilterOperatorDef[] }` | Declare a column's filter, or give one column its own operand control or operators | experimental | [example](../../../../apps/web/src/platform-extensions/datatable/TagsFilterType.example.tsx) |
| `matchesFilters` | hook | `matchesFilters<Row>(row: Row, columns: DataTableColumn<Row>[], model: DataTableFilterModel): boolean` | Filter rows on the page (a mock endpoint, a test) with the same per-type rules; the table itself never filters | experimental | [example](../../../../apps/web/src/__tests__/examples/datatable/tags-filter-type.test.tsx) |
| `DataTableSlots` | slot | `{ Toolbar?: PageSlot<DataTableToolbarSlotProps<Row>>; BulkBar?: PageSlot<DataTableBulkBarSlotProps> }` | Add controls above a table (saved views), or replace its bulk-action bar | experimental | [example](../../../../apps/web/src/platform-extensions/datatable/SavedViewsToolbar.example.tsx) |
| `DataTableStoredLayout.extra` | option | `extra?: Record<string, unknown>` | Keep the app's own bounded JSON beside the layout (8 KiB, 32 keys, 8 levels), through `prefs.setExtra` | experimental | [example](../../../../apps/web/src/__tests__/examples/datatable/saved-views-toolbar.test.tsx) |
| `DataTableStoredLayout.savedViews` | option | `savedViews?: DataTableSavedView[]` | Let a user keep up to 20 named layouts, through `prefs.saveView`, `applyView` and `deleteView` | experimental | [example](../../../../apps/web/src/platform-extensions/datatable/SavedViewsToolbar.example.tsx) |
| `DataTablePreferencesProvider` | option | `DataTablePreferencesProvider(props: { port; children }): ReactElement` | Keep layouts somewhere other than the user's settings | experimental | [example](../../../../apps/web/src/__tests__/components/datatable/DataTablePreferencesPort.test.tsx) |
| `createUserSettingsPreferencesPort` | option | `createUserSettingsPreferencesPort(api: PlatformApiClient): DataTablePreferencesPort` | Build the default port yourself, e.g. to wrap it | experimental | [example](../../../../apps/web/src/__tests__/components/datatable/DataTablePreferencesPort.test.tsx) |

## Data

None. The table owns no models. It reads and writes one entry per table of the user's `dataTables` setting (`GET` and `PATCH /api/user-settings`, validated by the settings slice's `DATA_TABLES_USER_SETTINGS`, at most 40 tables of at most 60 column ids each) and nothing else; it uses no browser storage. An entry holds the visible columns, density, sort and page size, plus the app-facing `extra` (plain JSON, at most 8 KiB, 32 keys and 8 levels) and `savedViews` (at most 20, each a name and a layout with its own `extra`), under a 32 KiB cap on the whole entry. The API refuses anything larger (a `400`); the table mirrors the bounds (`DATA_TABLE_EXTRA_MAX_BYTES`, `DATA_TABLE_MAX_SAVED_VIEWS`, `DATA_TABLE_ENTRY_MAX_BYTES`) so it never sends a value the API would refuse.

## Permissions and settings

No permission of its own: the default port calls the user-settings routes, which require `user_settings:read` and `user_settings:write`. A viewer without them keeps a working table whose preferences are session-only (the failed load or save is logged and dropped). The `dataTables` namespace has no admin default.

## UI

- **Pages.** None. The table is a component.
- **Slots.** `slots.Toolbar` draws first inside the table's wrapper, above the view bar: it receives `{ layout, rowCount, total, selectedIds, filters, onFiltersChange, prefs, columns }` (read-only state, the table's own layout preferences and the page's filter callback, so applying a saved view can restore its filters). `slots.BulkBar` replaces the bulk-action bar on both renderers while rows are selected and receives `{ ids, actions, onClear, total }`; it is not drawn for an empty selection.
- **Tokens.** The table reads the host's MUI theme (palette, `divider`, `action.*`, `primary`) and paints two component tints derived from `primary.main`: the selected row and the bulk-action bar. An app that changes its palette re-checks the contrast of those tints (the reference app pins them in `apps/web/src/__tests__/components/datatable/DataTableContrast.test.tsx`).
- **Test ids.** `datatable-*` ids are part of the contract the suites rely on (`datatable-loading-overlay`, `datatable-filter-apply`, `datatable-export-button`, `datatable-card`, and others).

## Infra

None.

## Observability

None. The table logs a `console.warn` when a preference cannot be loaded or saved, never an error: persistence is a best-effort backup of what is on screen.

## Security notes

- The table renders what `render` returns and escapes everything else; a column's `render` is the page's code.
- CSV export neutralises cells that start with a formula character (`=`, `+`, `-`, `@`, tab, carriage return) unless they are plain numbers, so a downloaded file cannot run a spreadsheet formula. The export ceiling is 10,000 rows.
- Stored layouts are untrusted JSON: every entry goes through `sanitizeStoredLayout`, which narrows it defensively (unknown ids ignored, lengths capped; an `extra` that is not bounded plain JSON, a saved view with a bad id, a blank or long name or a repeated id, and views past 20 are dropped; an entry over its byte bound loses its app-owned parts) before use. The same bounds are enforced by the API on write, so the stored copy is never trusted on either side.
- A saved view's `extra` is the app's own data. The table never reads it and never evaluates it; the app that restores a filter model from it validates what it needs (the example takes only an array).
- A filter type's `matches` and `Editor` are the app's code, like a column's `render`. A type that is not registered makes its column unfilterable instead of throwing at render.
- The preference `PATCH` carries no `If-Match`: it touches one key of one namespace and the server merges per table, so a version check would only fail on an unrelated concurrent write.

## Conformance suite

`runDataTableConformanceSuite()` from `@marinoscar/platform-web/datatable/testing` runs the table's mechanics against a built-in fixture, or against a page's own columns (`columns`, `rows`, `rowId`, `label`): renderer switching and state preservation across a resize, server-side pagination, sort and filter round trips, selection, loading, empty and error states, column visibility and density, CSV escaping, "no invisible hit targets", "no horizontal document scroll at 360px", axe passes in both renderers and both themes, row and list semantics, live regions, focus management and DataGrid keyboard navigation. Call it at the top of a `describe`; pass `themes` to render under the app's own. Not part of `runPlatformWebConformance()` (it needs a table to render); the reference app runs it in `apps/web/src/__tests__/components/datatable/DataTableConformance.test.tsx` and against the user list's columns.

`installLayoutStubs()` and its helpers (`setContainerWidth`, `resetContainerWidth`, `setInitialContainerWidth`) give jsdom a layout: it measures nothing, so without them the container-width hook and the grid's virtualizer see a 0 by 0 viewport.

## Upgrade notes

Extended in PP-14.20: `FilterOperator` and `DataTableFilterType` are `Builtin | (string & {})` (the built-in unions are `BuiltinFilterOperator` and `BuiltinDataTableFilterType`), `OPERATORS_BY_FILTER_TYPE` is keyed by the built-ins, an unregistered filter type makes a column unfilterable, `DataTableStoredLayout` gains `extra` and `savedViews`, and `DataTableLayoutPrefs` gains `extra`, `setExtra`, `savedViews`, `saveView`, `applyView` and `deleteView`. `reset` keeps the saved views. The four slices' (jobs, nodes, identity, db-backup) table filter-model operator unions (`JobsTableFilterModelOperator` and its siblings) gain `(string & {})` to stay assignable both ways. The markup of a table that uses none of the new seams is unchanged (pinned by a recorded snapshot).

New in #899: an `index.ts` at the slice root (`DataTable`, `DataTableColumn`, `DataTableRowAction`), the entry point sibling slices import (the `ai` slice draws its lists with it); not a package subpath.

New in #897: the table moved from the reference app's `components/datatable`. Its two app dependencies became host bindings: the stored-layout type is `DataTableStoredLayout` (the app's `DataTableSettings` is an alias of it) and the user-settings calls go through `DataTablePreferencesPort`, defaulting to the host's transport. An app that imported `components/datatable` imports the three subpaths instead, and its tests import the stubs and the suite from `/testing`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| A table with a `tableId` forgets its layout on reload | No `PlatformHostProvider` above it and no `DataTablePreferencesProvider`, so there is no port | Mount the host provider (the default port uses its transport) or supply a port |
| A test sees no rows, or a 0 px layout | jsdom performs no layout | Call `installLayoutStubs()` in a `beforeAll`, and `setContainerWidth()` per case |
| `toBeInTheDocument is not a function` in the conformance suite | jest-dom is not registered in the test setup | `import '@testing-library/jest-dom/vitest'` in the setup file |
| The axe passes fail only in your app | The app's palette fails a contrast the default theme passes | Pass your themes as `themes` and fix the palette token it names |

## Links

- [Package README](../../README.md)
- [Settings slice README](../settings/README.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)
