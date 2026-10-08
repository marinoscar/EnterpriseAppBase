# @marinoscar/platform-web/db-backup

The database backup and restore page (issue #740, PP-8.7): the `/admin/settings/db-backup` page with its policy panel, run history and restore/rollback dialog (`/ui`), the client and hooks it renders through (`/headless`), and its admin card as data. React and MUI. It depends on `core` of this package only (`packages/platform-slices.json`; the table contract, the polling hook and the formatters are the jobs slice's, restated); its wire shapes are [`@marinoscar/platform-contract/db-backup`](../../../platform-contract/src/db-backup/README.md) and its API is [`@marinoscar/platform-api/db-backup`](../../../platform-api/src/db-backup/README.md).

## Purpose and scope

An administrator schedules backups, reviews what has been taken (progress, size, checksum, provenance), downloads an archive, cancels or deletes a run, and restores or rolls back the database. Every decision is the API's: the page renders the pre-flight's gates (all of them, passes included, `rls_bypass` among them), the `guided` command block and the `blocked` override exactly as the API returns them, and requires the typed `RESTORE` / `ROLLBACK` confirmation.

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

`DbBackupWebAdaptersProvider` takes the app's `DataTable` and, optionally, its own `DbBackupApi`. The hooks take an optional `{ api }` (default: the adapters' `api`, else `createDbBackupApi` over the platform host's transport).

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `DbBackupPage` | component | `DbBackupPage(): ReactElement` | Route `/admin/settings/db-backup` | experimental | [example](../../../../apps/web/src/App.tsx) |
| `DbBackupWebAdaptersProvider` | component | `DbBackupWebAdaptersProvider(props: { adapters: DbBackupWebAdapters; children: ReactNode }): ReactElement` | Hand the page the app's table (and optionally its client) | experimental | [example](../../../../apps/web/src/App.tsx) |
| `DbBackupWebAdapters` | option | `{ DataTable?: DbBackupDataTableComponent; api?: DbBackupApi }` | The app's table and client for the page | experimental | [example](../../../../apps/web/src/platform/dbBackupAdapters.ts) |
| `dbBackupAdminSections` | component | `{ operations: readonly DbBackupSettingsCard[] }` | Spread the `Database Backup` card into the admin hub at its position | experimental | [example](../../../../apps/web/src/config/adminSections.tsx) |

Supporting exports (experimental): `createDbBackupApi`, `useDbBackupApi`, `useDbBackupConfig`, `useDbBackupRuns`, `useDbBackupActions`, `DB_BACKUP_POLL_INTERVAL_MS`, the predicates (`isBackupRunActive`, `isBackupDownloadable`, `isBackupRestorable`, `isBackupDeletable`, `isBackupCancelable`, `isRestoreInFlight`, `isRollbackAvailable`, `parseByteCount`), the value lists (the contract's), the wire types, `DbBackupConfigPanel`, `DbBackupRestoreDialog`, `DB_BACKUP_PAGE_TITLE` and `DB_BACKUP_PAGE_DESCRIPTION`.

## Data

None stored. The run list polls every `DB_BACKUP_POLL_INTERVAL_MS` (10 s) while the tab is in front (a copy of the jobs slice's `useVisiblePolling`); byte counts stay decimal strings and are parsed for formatting only.

## Permissions and settings

The card and the route: `db_backup:read`. Inside the page, writes need `db_backup:write` and restore/rollback `db_backup:restore` AND `restore.available` (off when `DEPLOYMENT_MODE=saas`); missing ones DISABLE the controls with the reason, they are never hidden.

## UI

`/ui`: the page (default and named export), `DbBackupConfigPanel`, `DbBackupRestoreDialog` and `dbBackupAdminSections`. The page title and the card share `DB_BACKUP_PAGE_TITLE`.

## Infra

None.

## Observability

None. The page emits nothing beyond the API calls it makes.

## Security notes

The page never decides a restore: the confirmation literal is the contract's, the override is offered only when the API's `block.overrideParameter` names it, and the guided commands are shown as the API sends them. A saas deployment shows the restore actions disabled with "deployment_mode_saas" explained, so an administrator learns why rather than finding the button missing.

## Conformance suite

None of its own. The hook and table suites live in `packages/platform-web/test/db-backup/`; the page suite stays in the reference app ([`DbBackupPage.test.tsx`](../../../../apps/web/src/__tests__/pages/Admin/DbBackupPage.test.tsx), saas rendering included), as the jobs page suites do, and the app's `settingsRegistry.test.ts` pins the card's permission to the controller.

## Upgrade notes

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
