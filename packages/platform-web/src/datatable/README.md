# @marinoscar/platform-web/datatable

The responsive `DataTable` of the web package (issue #897, from the modularity audit #893), in three entries: `/datatable/headless` (the column and prop types, the filter operators, model and URL state, the layout-preference model and hook with their storage port, the CSV export model and the virtualization planners), `/datatable/ui` (the table itself: a virtualized grid on desktop and tablet, a card list on a phone, with the filter bar, view bar, export control, bulk-action bar and row actions) and `/datatable/testing` (the jsdom layout stubs and the shared conformance suite). It depends on the `core` slice only (`packages/platform-slices.json`).

## Purpose and scope

One table for every list in an app, so a page declares its columns and rows and gets the rest:
- **Three layouts from the container's width**, not the viewport's: the desktop grid (MUI X DataGrid, virtualized past a row threshold), the tablet grid with a row expander for the detail columns, and the phone card list with a sort control and compact pagination. A table inside a narrow drawer switches on its own.
- **Server-side everything.** Sorting, pagination and filtering are controlled by the page (`sort`, `pagination`, `filters` with `onFiltersChange`); the table reports changes and never sorts or filters the rows it is given. Quick search, the filter editor and the filter chips can be mirrored to URL parameters (`readDataTableUrlState`, `writeDataTableUrlState`).
- **Per-user layout.** With a `tableId`, the visible columns, density, sort and page size are restored on mount and saved (debounced, fire-and-forget) through a `DataTablePreferencesPort`. The in-session state is authoritative; the stored copy is a backup.
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
| `DataTable` `csvExport` | `DataTableExportConfig` | none | Turns the export control on; `fetchAllRows` lets it export every server row |
| `DataTablePreferencesProvider` `port` | `DataTablePreferencesPort` | the user-settings routes over the host transport | Where layouts are kept |
| `runDataTableConformanceSuite` `themes` | `{ light, dark }` | MUI defaults | The themes the axe passes render under |

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `DataTable` | component | `DataTable<Row>(props: DataTableProps<Row>): ReactElement` | Any list of rows, on every breakpoint | experimental | [example](../../../../apps/web/src/platform/identityAdapters.ts) |
| `useDataTableLayoutPrefs` | hook | `useDataTableLayoutPrefs<Row>(options: UseDataTableLayoutPrefsOptions<Row>): DataTableLayoutPrefs` | Own the visible columns, density, sort and page size of a table you render yourself | experimental | [example](../../../../apps/web/src/__tests__/components/datatable/DataTablePreferencesPort.test.tsx) |
| `DataTablePreferencesProvider` | option | `DataTablePreferencesProvider(props: { port; children }): ReactElement` | Keep layouts somewhere other than the user's settings | experimental | [example](../../../../apps/web/src/__tests__/components/datatable/DataTablePreferencesPort.test.tsx) |
| `createUserSettingsPreferencesPort` | option | `createUserSettingsPreferencesPort(api: PlatformApiClient): DataTablePreferencesPort` | Build the default port yourself, e.g. to wrap it | experimental | [example](../../../../apps/web/src/__tests__/components/datatable/DataTablePreferencesPort.test.tsx) |

## Data

None. The table owns no models. It reads and writes one entry per table of the user's `dataTables` setting (`GET` and `PATCH /api/user-settings`, validated by the settings slice's `DATA_TABLES_USER_SETTINGS`, at most 40 tables of at most 60 column ids each) and nothing else; it uses no browser storage.

## Permissions and settings

No permission of its own: the default port calls the user-settings routes, which require `user_settings:read` and `user_settings:write`. A viewer without them keeps a working table whose preferences are session-only (the failed load or save is logged and dropped). The `dataTables` namespace has no admin default.

## UI

- **Pages.** None. The table is a component.
- **Slots and tokens.** The table reads the host's MUI theme (palette, `divider`, `action.*`, `primary`) and paints two component tints derived from `primary.main`: the selected row and the bulk-action bar. An app that changes its palette re-checks the contrast of those tints (the reference app pins them in `apps/web/src/__tests__/components/datatable/DataTableContrast.test.tsx`).
- **Test ids.** `datatable-*` ids are part of the contract the suites rely on (`datatable-loading-overlay`, `datatable-filter-apply`, `datatable-export-button`, `datatable-card`, and others).

## Infra

None.

## Observability

None. The table logs a `console.warn` when a preference cannot be loaded or saved, never an error: persistence is a best-effort backup of what is on screen.

## Security notes

- The table renders what `render` returns and escapes everything else; a column's `render` is the page's code.
- CSV export neutralises cells that start with a formula character (`=`, `+`, `-`, `@`, tab, carriage return) unless they are plain numbers, so a downloaded file cannot run a spreadsheet formula. The export ceiling is 10,000 rows.
- Stored layouts are untrusted JSON: every entry goes through `sanitizeStoredLayout`, which narrows it defensively (unknown ids ignored, lengths capped) before use.
- The preference `PATCH` carries no `If-Match`: it touches one key of one namespace and the server merges per table, so a version check would only fail on an unrelated concurrent write.

## Conformance suite

`runDataTableConformanceSuite()` from `@marinoscar/platform-web/datatable/testing` runs the table's mechanics against a built-in fixture, or against a page's own columns (`columns`, `rows`, `rowId`, `label`): renderer switching and state preservation across a resize, server-side pagination, sort and filter round trips, selection, loading, empty and error states, column visibility and density, CSV escaping, "no invisible hit targets", "no horizontal document scroll at 360px", axe passes in both renderers and both themes, row and list semantics, live regions, focus management and DataGrid keyboard navigation. Call it at the top of a `describe`; pass `themes` to render under the app's own. Not part of `runPlatformWebConformance()` (it needs a table to render); the reference app runs it in `apps/web/src/__tests__/components/datatable/DataTableConformance.test.tsx` and against the user list's columns.

`installLayoutStubs()` and its helpers (`setContainerWidth`, `resetContainerWidth`, `setInitialContainerWidth`) give jsdom a layout: it measures nothing, so without them the container-width hook and the grid's virtualizer see a 0 by 0 viewport.

## Upgrade notes

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
