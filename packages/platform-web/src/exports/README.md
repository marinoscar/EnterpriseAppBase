# @marinoscar/platform-web/exports

The data export UI (issue #744, PP-9.2), on `@marinoscar/platform-api/exports`'s routes and `@marinoscar/platform-contract/exports`' shapes. `/headless` holds the client and the hooks: the sources the caller may use, their recent exports (polled while one is in progress), requesting one, and one export polled until it settles. `/ui` holds `ExportDialog`, `ExportsList`, `DataExportPage` and the "Download your data" settings card descriptor. It depends on the `core` slice only (`packages/platform-slices.json`).

## Purpose and scope

"Download your data" for every signed-in user, and the organization export for an organization's administrators, on one page:
- **The dialog** draws each source's request fields from `GET /api/exports/sources` (a date picker, a checkbox, a select or a text box), so the web app never carries a second copy of what a source accepts. A source with a richer form supplies its own through `slots.form`.
- **The list** states each status in words and downloads from a FRESH signed URL: `GET /api/exports/:id` is called at click time, because the URL lives five minutes.

Not here: the sources, writers and jobs (`@marinoscar/platform-api/exports`), the wire shapes (`@marinoscar/platform-contract/exports`), and the app's registry entry and route (the app owns its registries).

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { useExports, useCreateExport } from '@marinoscar/platform-web/exports/headless';
import { DataExportPage, ExportDialog, dataExportSettingsPage } from '@marinoscar/platform-web/exports/ui';
```

None beyond the package's peers (`react`, `@mui/material`, `@mui/icons-material`).

## Quick start

The reference app appends the card and routes the page ([`apps/web/src/config/userSettingsSections.tsx`](../../../../apps/web/src/config/userSettingsSections.tsx), [`apps/web/src/App.tsx`](../../../../apps/web/src/App.tsx)):

```tsx
{ label: 'Your data', cards: [{ ...dataExportSettingsPage.card, Icon: dataExportSettingsPage.Icon }] },

<Route path="/settings/data-export" element={<DataExportPage />} />
```

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `DataExportPage` `slots` | `DataExportPageSlots` | none | The page-slot contract (`Header`, `BeforeContent`, `Sections`, `AfterContent`), the list's `Columns` and `RowActions` (forwarded to `ExportsList`) and `form` (see UI) |
| `DataExportPage` `slots.form` | `Record<sourceId, ComponentType<ExportFormSlotProps>>` | none | A source's own request form instead of the generated fields |
| `ExportDialog` `sources` | `ExportSourceDescriptor[]` | required | The sources to offer (`useExportSources().sources`) |
| `ExportsList` `slots` | `ExportsListSlots` | none | `Columns` and `RowActions` (see UI) |
| `ExportsList` `onDownload` | `(url, view) => void` | navigate to the URL | How a fresh signed URL is opened |
| `useExports` / `useExport` `intervalMs` | `number` | `3000` | The poll interval while an export is in progress (paused while the tab is hidden) |

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `createExportsClient` | hook | `createExportsClient(api: PlatformApiClient): ExportsClient` | Call the export routes outside the hooks | experimental | [example](../../../../apps/web/src/__tests__/platform/exports.test.tsx) |
| `useExportSources` | hook | `useExportSources(): ExportSourcesState` | The sources and formats the caller may use | experimental | [example](../../../../apps/web/src/__tests__/platform/exports.test.tsx) |
| `useExports` | hook | `useExports(options?: { intervalMs? }): ExportsState` | The caller's recent exports, polled while one is in progress | experimental | [example](../../../../apps/web/src/__tests__/platform/exports.test.tsx) |
| `useCreateExport` | hook | `useCreateExport(): CreateExportState` | Request an export; a `429` in words | experimental | [example](../../../../apps/web/src/__tests__/platform/exports.test.tsx) |
| `useExport` | hook | `useExport(id: string \| null, options?: { intervalMs? }): ExportState` | One export, polled until it settles | experimental | [example](../../../../apps/web/src/__tests__/platform/exports.test.tsx) |
| `ExportDialog` | component | `ExportDialog(props: { open; onClose; sources; initialSourceId?; onCreated?; slots?: { form? } }): ReactElement` | Request an export from any page; a source's own form in `slots.form` | experimental | [example](../../../../apps/web/src/platform-extensions/exports/InboxRangeForm.example.tsx) |
| `ExportsList` | component | `ExportsList(props: { exports; sources?; onDownload?; slots?: ExportsListSlots }): ReactElement` | List exports with status in words and a fresh download | experimental | [example](../../../../apps/web/src/__tests__/platform/exports.test.tsx) |
| `ExportsListSlots` | slot | `{ Columns?: (base: ExportsListColumn[]) => ExportsListColumn[]; RowActions?: PageSlot<{ row: ExportView }> }` | Add or remove a column, or add a per-export action after Download, without a fork | experimental | [example](../../../../apps/web/src/platform-extensions/exports/ExportsListSlots.example.tsx) |
| `DataExportPage` | component | `DataExportPage(props?: { slots?: DataExportPageSlots }): ReactElement` | Route `/settings/data-export` | experimental | [example](../../../../apps/web/src/App.tsx) |
| `DataExportPageSlots` | slot | `PageSlotsBase & ExportsListSlots & { form?: Record<sourceId, ComponentType<ExportFormSlotProps>> }` | Add a notice, a section, a replaced header, list columns or per-export actions to the page without a fork | experimental | [example](../../../../apps/web/src/platform-extensions/exports/DataExportPageSlots.example.tsx) |
| `dataExportSettingsPage` | component | `PlatformSettingsPage<never>` | The user card and route (no permission) | experimental | [example](../../../../apps/web/src/config/userSettingsSections.tsx) |

## Data

None. The UI reads `/api/exports` only; it stores nothing (no browser storage).

## Permissions and settings

The card declares no `permission`, because the API grants the `user-data` source to every role through `user_settings:read`. The page shows only the sources `GET /api/exports/sources` returns for the caller, which is the API's decision: an organization's administrators also see `org-data`. It reads no setting.

## UI

- **Page.** `DataExportPage` at `/settings/data-export`, under a "Your data" group appended to the user settings registry. A Danger Zone group (#743), when present, stays last.
- **List slots.** `ExportsList` takes `slots` named as the packaged-page table contract names them. `Columns(base)` returns the columns to draw; the base columns are `export` (the title), `created`, `size` and `error` (the line under it, joined by middots) and `status` (the chip, in the right-hand group). A column is placed by `priority` (`primary`, `secondary`, `detail` on its own line) or `placement: 'trailing'`; `render(export)` returns text or a node, and a column that returns nothing for a row draws nothing there. `RowActions` draws after Download. With no slot the markup is exactly the list's own. `DataExportPage` forwards `slots.Columns` and `slots.RowActions` to the list it draws, so the page needs no copy to use them.
- **Page slots.** `DataExportPage` takes the packaged-page slot contract (`PageSlotsBase`, [Page slots](../core/README.md#page-slots)): `Header` (gets `{ title, description, actions: null }`; print `title` as the `h1`), `BeforeContent` (a notice under the header), `Sections` (drawn at both ends of the body: `position: 'top'` under the header, `'bottom'` after the recent exports; return `null` for the one you do not want) and `AfterContent`. All sit inside the page's container. The request dialog is not a slot target here: its `form` slot is `slots.form`. With no slot the markup is exactly the page's own (`test/exports/DataExportPage.builtin-dom.test.tsx` pins it).
- **Status in words.** Queued, Preparing, Ready to download, Expired, Failed. Colour is never the only signal.
- **Accessibility.** Buttons are at least 44 px high, the dialog is labelled, and the download buttons name what they download.

## Infra

None.

## Observability

None client-side. The API counts exports (`app.exports`) and audits each file.

## Security notes

- The download URL is never stored in state beyond the click that fetched it, and never logged. The list carries `download: null`; only a single-export read mints one.
- The dialog sends exactly the source's declared fields (an undefined value is dropped). The API's strict schemas refuse anything else.

## Conformance suite

None of its own. `apps/web/src/__tests__/config/platformPages.test.ts` checks that the card is registered once from the descriptor, ungated, with one ungated route, and `userSettingsSections.test.ts` pins its group.

## Upgrade notes

PP-14.24b (#974): `DataExportPage` takes the page-slot contract and forwards the list's `Columns` and `RowActions`; its `slots` type is now the exported `DataExportPageSlots` (a superset of the old `{ form? }`), so existing code keeps compiling and rendering the same markup. The page was the last entry on `test/page-slots.exempt.json`.

New in #744. EvoPath's health export page maps to `DataExportPage` with its `health` source. Its range and dataset pickers come from the source's request schema, or from its own form through `slots.form`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "New export" is disabled | The caller may use no source, or the sources failed to load | Check `GET /api/exports/sources` for the caller |
| A field the source accepts is missing from the dialog | Its schema type is one `requestFieldsOf` does not draw (a number, a nested object) | Declare `fields` on the source, or pass `slots.form` |
| Download says the export is no longer available | It expired (or was purged) between the list and the click | Start a new export |

## Links

- [Package README](../../README.md)
- [Data export spec](../../../../docs/specs/data-export.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)
