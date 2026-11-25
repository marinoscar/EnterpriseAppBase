# @marinoscar/platform-web/db-backup

The database backup and restore page (issue #740, PP-8.7): the `/admin/settings/db-backup` page with its policy panel, run history and restore/rollback dialog (`/ui`), the client and hooks it renders through (`/headless`), and its admin card as data. React and MUI. It depends on `core` of this package only (`packages/platform-slices.json`; the table contract, the polling hook and the formatters are the jobs slice's, restated); its wire shapes are [`@marinoscar/platform-contract/db-backup`](../../../platform-contract/src/db-backup/README.md) and its API is [`@marinoscar/platform-api/db-backup`](../../../platform-api/src/db-backup/README.md).

## Purpose and scope

An administrator schedules backups, reviews what has been taken (progress, size, checksum, provenance), downloads an archive, cancels or deletes a run, and restores or rolls back the database. Every decision is the API's: the page renders the pre-flight's gates (all of them, passes included, `rls_bypass` among them and any gate an app registered, named by its own title), the `guided` command block and the `blocked` override exactly as the API returns them, and requires the typed `RESTORE` / `ROLLBACK` confirmation.

Not here: the engine and the routes (the API slice), the settings hub (`@marinoscar/platform-web/settings`).

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { useDbBackupConfig, createDbBackupApi } from '@marinoscar/platform-web/db-backup/headless';
import DbBackupPage, { dbBackupAdminSections } from '@marinoscar/platform-web/db-backup/ui';
```

The package's peers: `react`, `@mui/material`, `@mui/icons-material`, `react-router-dom`.

## Quick start

The reference app routes the page lazily ([`App.tsx`](../../../../apps/web/src/App.tsx)) and spreads the card into its Operations section ([`adminSections.tsx`](../../../../apps/web/src/config/adminSections.tsx)):

```tsx
const DbBackupPage = lazy(() => import('@marinoscar/platform-web/db-backup/ui'));
// ...
{ label: 'Operations', cards: [...jobsAdminSections.operations, ...dbBackupAdminSections.operations, broadcastsCard] }
```

The page needs `PlatformHostProvider` (the transport and the viewer's permissions) and, for the responsive table, `DbBackupWebAdaptersProvider` with a `DataTable` (a plain table otherwise; the reference app's [`dbBackupAdapters.ts`](../../../../apps/web/src/platform/dbBackupAdapters.ts)).

## Configuration

`DbBackupPage` takes one optional prop, `slots`: the page-slot contract of the web core ([Page slots](../core/README.md#page-slots)) plus `RunRowActions`. With no slot the markup is the one recorded before the slots existed (`test/db-backup/DbBackupPage.builtin-dom.test.tsx`).

| Slot | Receives | Drawn |
|---|---|---|
| `Header` | `{ title, description, readOnly, actions }` (`actions` is `null`: "Back up now" stays in the body) | Replaces the `h1` and subtitle. `readOnly` means the viewer lacks `db_backup:write`. |
| `BeforeContent` | none | Under the header. |
| `Sections` | `DbBackupSectionsProps`: `position` (`'top'` or `'bottom'`), the policy, the runs on screen, `canWrite`, `canRestore` and a `refresh` | At both ends: `'top'` under the header and `BeforeContent`, `'bottom'` after the run history. Return `null` for the end you do not use. |
| `AfterContent` | none | After the run history and the bottom `Sections`, before the restore dialog. |
| `RunRowActions` | `DbBackupRunActionsProps`: the `run`, `canWrite`, `canRestore` and a `refresh` | An extra `More actions` column of the run history. Download, cancel, delete, restore and rollback are untouched; the API still enforces their permissions. |

`DbBackupWebAdaptersProvider` takes the app's `DataTable` and, optionally, its own `DbBackupApi`. The hooks take an optional `{ api }` (default: the adapters' `api`, else `createDbBackupApi` over the platform host's transport).

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `DbBackupPage` | component | `DbBackupPage(props?: DbBackupPageProps): ReactElement` | Route `/admin/settings/db-backup` | experimental | [example](../../../../apps/web/src/App.tsx) |
| `DbBackupPageProps` | slot | `{ slots?: DbBackupPageSlots }` | Pass the page its slots | experimental | [example](../../../../apps/web/src/platform-extensions/db-backup/RestoreDrillSection.example.tsx) |
| `DbBackupPageSlots` | slot | `PageSlotsBase & { Sections?: PageSlot<DbBackupSectionsProps>; RunRowActions?: PageSlot<DbBackupRunActionsProps> }` | Add a banner, a section (a mirror status, a restore drill checklist) at either end, or an action per backup run; replace the header | experimental | [example](../../../../apps/web/src/platform-extensions/db-backup/CopyArchiveKeyAction.example.tsx) |
| `DbBackupSectionsProps` | slot | `{ position: 'top' \| 'bottom'; config: DbBackupConfig \| null; runs: readonly DbBackupRun[]; canWrite: boolean; canRestore: boolean; refresh(): void }` | What a `Sections` component draws from; read-only | experimental | [example](../../../../apps/web/src/__tests__/examples/db-backup/restore-drill-section.test.tsx) |
| `DbBackupWebAdaptersProvider` | component | `DbBackupWebAdaptersProvider(props: { adapters: DbBackupWebAdapters; children: ReactNode }): ReactElement` | Hand the page the app's table (and optionally its client) | experimental | [example](../../../../apps/web/src/App.tsx) |
| `DbBackupWebAdapters` | option | `{ DataTable?: DbBackupDataTableComponent; api?: DbBackupApi }` | The app's table and client for the page | experimental | [example](../../../../apps/web/src/platform/dbBackupAdapters.ts) |
| `dbBackupAdminSections` | component | `{ operations: readonly DbBackupSettingsCard[] }` | Spread the `Database Backup` card into the admin hub at its position | experimental | [example](../../../../apps/web/src/config/adminSections.tsx) |

Supporting exports (experimental): `createDbBackupApi`, `useDbBackupApi`, `useDbBackupConfig`, `useDbBackupRuns`, `useDbBackupActions`, `DB_BACKUP_POLL_INTERVAL_MS`, the predicates (`isBackupRunActive`, `isBackupDownloadable`, `isBackupRestorable`, `isBackupDeletable`, `isBackupCancelable`, `isRestoreInFlight`, `isRollbackAvailable`, `parseByteCount`), the value lists (the contract's), the wire types, `DbBackupConfigPanel`, `DbBackupRestoreDialog`, `DbBackupRunActionsProps` (what `RunRowActions` receives), `DB_BACKUP_PAGE_TITLE` and `DB_BACKUP_PAGE_DESCRIPTION`.

## Data

None stored. The run list polls every `DB_BACKUP_POLL_INTERVAL_MS` (10 s) while the tab is in front (a copy of the jobs slice's `useVisiblePolling`); byte counts stay decimal strings and are parsed for formatting only.

## Permissions and settings

The card and the route: `db_backup:read`. Inside the page, writes need `db_backup:write` and restore/rollback `db_backup:restore` AND `restore.available` (off when `DEPLOYMENT_MODE=saas`); missing ones DISABLE the controls with the reason, they are never hidden.

## UI

`/ui`: the page (default and named export) with its slots, `DbBackupConfigPanel`, `DbBackupRestoreDialog` and `dbBackupAdminSections`. The page title and the card share `DB_BACKUP_PAGE_TITLE`.

The policy panel's **Timezone** is the deployment's schedule zone (`databaseBackup.timezone`, the zone the cron fires in), not the viewer's profile zone. It is a free-text picker (MUI `Autocomplete` with `freeSolo`) suggesting the runtime's own IANA list (`Intl.supportedValuesOf('timeZone')`, `UTC` first): never a hand-kept list, and a zone it does not list is still sent, because the API validates by performing the projection and its `400` is shown verbatim. It is not the timezone slice's `TimeZoneField`: `db-backup` may depend on `core` only (`packages/platform-slices.json`), and that field's `null` means "follow this device", which a deployment setting has no use for. **Next scheduled backup** is the server's own `nextRunAt`, rendered in the viewer's display zone.

## Infra

None.

## Observability

None. The page emits nothing beyond the API calls it makes.

## Security notes

The page never decides a restore: the confirmation literal is the contract's, the override is offered only when the API's `block.overrideParameter` names it, and the guided commands are shown as the API sends them. A saas deployment shows the restore actions disabled with "deployment_mode_saas" explained, so an administrator learns why rather than finding the button missing.

## Conformance suite

None of its own. The hook and table suites live in `packages/platform-web/test/db-backup/`; the page suite stays in the reference app ([`DbBackupPage.test.tsx`](../../../../apps/web/src/__tests__/pages/Admin/DbBackupPage.test.tsx), saas rendering included), as the jobs page suites do, and the app's `settingsCards.test.ts` pins the card's permission to the controller.

## Upgrade notes

Zone date operations: the schedule's Timezone field is a free-text picker over the runtime's zone list instead of a plain text field (same label, same value, still unvalidated in the browser); the page's markup changed accordingly.

PP-14.23: the page takes the page-slot contract. One behaviour change on the one slot that existed: `Sections` is rendered at both ends of the page (`position: 'top'` under the header and `'bottom'` after the run history) instead of once at the bottom, so a `Sections` component written for the old page returns `null` when `position` is `'top'`; `DbBackupSectionsProps` gains `position`. With no slot the markup is unchanged.

PP-14.12 is additive. The frequency list gains `cron`: choosing it shows a cron expression field in place of the time of day, and a save sends `cron` only under that frequency (every other save carries the fields it always did). `RestoreGateId` is open (the eight built-ins or an app's id) and `RESTORE_GATE_IDS` is a deprecated alias of `BUILTIN_RESTORE_GATE_IDS`; a gate's `kind` gains `app`, and a block by an app gate is named by the gate's title, shows no schema panel and offers no override. `DbBackupConfig` gains optional `cron` and `retention`.

New in this version: moved from the reference app's `pages/Admin/DbBackupPage.tsx`, `dbBackupTable.tsx`, `components/admin/DbBackup*.tsx`, `hooks/useDbBackup.ts` and `services/dbBackup.ts`. The module-level request functions became the methods of `createDbBackupApi`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `useDbBackupApi: no db-backup client` | No `PlatformHostProvider` | Mount it, or pass `{ api }` to the hooks |
| A plain table without filters | No `DbBackupWebAdaptersProvider` `DataTable` | Provide the app's table through the adapters |
| Restore buttons are disabled with a saas note | `DEPLOYMENT_MODE=saas` | By design |

## Links

- [Package README](../../README.md)
- [The API slice](../../../platform-api/src/db-backup/README.md)
- [Spec: database backup](../../../../docs/specs/database-backup.md), [database restore](../../../../docs/specs/database-restore.md)
