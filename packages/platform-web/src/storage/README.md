# @marinoscar/platform-web/storage

The browser half of the storage slice (issue #736, PP-8.3): the `/admin/settings/storage` page, its switch-confirmation dialog and hook, moved from the reference app with their behaviour unchanged, and an objects client for the objects API. Two subpaths: `/storage/headless` (`useStorageConfig`, the storage-config client, the objects client and their types, no component) and `/storage/ui` (`StorageConfigPage`, default and named export, and `StorageSwitchConfirmDialog`). It depends on `core` of this package (the host transport and viewer; `packages/platform-slices.json`) and on `@marinoscar/platform-contract/storage` for the wire shapes and value lists.

## Purpose and scope

The page an administrator configures object storage on: the provider (`s3`, `r2`, `s3compatible`), bucket, region, endpoint, account id, the access key id and the write-only secret access key, path style, the connection test (a diagnosis per check), bucket provisioning (or guided commands), and the typed `SWITCH` confirmation when a save would strand existing objects. And the calls a feature makes to store a file: upload (simple or resumable), wait until it is ready, get a signed download URL.

Not here: the API (`@marinoscar/platform-api/storage`), the settings card (the app's `ADMIN_SECTIONS` declares the `Storage` card), an upload UI component.

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { createStorageObjectsClient, useStorageConfig } from '@marinoscar/platform-web/storage/headless';
const StorageConfigPage = lazy(() => import('@marinoscar/platform-web/storage/ui'));
```

`/ui` needs the package's MUI peers (`@mui/material`, `@mui/icons-material`, `@emotion/react`, `@emotion/styled`), React and `react-router-dom`. `/headless` needs React for the hook only; the clients are plain functions over a transport. The hook and the page need a `PlatformHostProvider` above them (or, for the hook, an `api` option).

## Quick start

The reference app routes the page behind the card's permission ([`App.tsx`](../../../../apps/web/src/App.tsx)) and binds the objects client to its transport ([`services/storage.ts`](../../../../apps/web/src/services/storage.ts)):

```tsx
const StorageConfigPage = lazy(() => import('@marinoscar/platform-web/storage/ui'));

<RequirePermission permission="storage_config:read" fallback={<Navigate to="/" replace />}>
  <StorageConfigPage />
</RequirePermission>
```

```ts
const objects = () => createStorageObjectsClient(api);       // api: the app's PlatformHttpClient (has postFormData)
export const uploadStorageObjectAndWait = (file: File, options?: WaitForReadyOptions) => objects().uploadAndWait(file, options);
```

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `useStorageConfig({ api })` | `PlatformApiClient` | the host's | The transport, when the hook runs outside `PlatformHostProvider` |
| `createStorageObjectsClient(api)` | `StorageObjectsTransport` | none | The transport; `postFormData` is needed for the simple upload only |
| `waitForReady(object, { intervalMs, timeoutMs })` | `number`, `number` | `500`, `30000` | The polling bounds |

The page takes no props.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `useStorageConfig` | hook | `useStorageConfig(options?: { api? }): UseStorageConfigReturn` | Build your own storage settings page over the same load, save, test and provision contract | experimental | [example](../../../../apps/web/src/__tests__/pages/Admin/StorageConfigPage.test.tsx) |
| `createStorageObjectsClient` | hook | `createStorageObjectsClient(api: StorageObjectsTransport): StorageObjectsClient` | Upload, wait for, download and delete objects from a feature | experimental | [example](../../../../apps/web/src/services/storage.ts) |
| `StorageConfigPage` | component | `StorageConfigPage(): ReactElement` | Route `/admin/settings/storage` | experimental | [example](../../../../apps/web/src/App.tsx) |

Supporting exports (experimental): `createStorageConfigClient`, `reportsBucketMissing`, `StorageObjectNotReadyError`, `StorageSwitchConfirmDialog`, `STORAGE_LOCATION_IN_USE_CODE`, the value lists re-exported from the contract, and the types (`StorageConfigView`, `StorageConfigInput`, `StorageConnectionTestResult`, `StorageBucketProvisionResult`, `StorageObject`, `StorageObjectsTransport`, `UseStorageConfigReturn`, ...).

## Data

None. The page reads and writes `/api/admin/storage-config` only; the objects client calls `/api/storage/objects*` and `/api/storage/status`. File bytes of a resumable upload go straight to the presigned part URLs, never through the API.

## Permissions and settings

The page is reached with `storage_config:read` (the `Storage` card's permission, the exact string `StorageConfigController` enforces; a viewer without it is redirected to `/`). Saving, the test and bucket provisioning need `storage_config:write`: without it the controls are disabled. The objects client's calls need `storage:read|write`. No settings of its own.

## UI

`StorageConfigPage`, an MUI page in the Console's settings layout: the provider choice, the field groups per provider (the R2 endpoint derived from the account id), the secret (blank keeps the stored one; the helper text names the saved hint), Save (`If-Match`; a version 409 reloads the form and says so, a `STORAGE_LOCATION_IN_USE` 409 opens `StorageSwitchConfirmDialog`, which requires the typed word), "Test connection" (each check with its status and code) and "Create bucket" (offered only on `bucket_missing`, never on `bucket_forbidden`). The app's admin registry entry (`ADMIN_SECTIONS`, title `Storage`, `permission: 'storage_config:read'`) is unchanged by the move.

## Infra

None.

## Observability

None. The page emits no telemetry of its own; the API logs and audits saves, tests and provisioning.

## Security notes

- The secret access key is write-only: the page never receives it (the response carries a masked status), and it sends one only when the admin typed one. `StorageConfigPage.wire.test.tsx` asserts the request bodies.
- A signed download URL is a bearer credential for its lifetime: the client fetches it when needed and nothing here stores or logs it.
- The two probes answer HTTP 200 carrying the diagnosis; the hook never turns a failed diagnosis into success, and a failed call into a fabricated result.

## Conformance suite

None in the web package for this slice. The API slice's `storage` suite covers the shapes and keys; the reference app's page tests (`apps/web/src/__tests__/pages/Admin/StorageConfigPage*.test.tsx`) render this package's page.

## Upgrade notes

New subpaths in this version. From the reference app's `pages/Admin/StorageConfigPage.tsx`, `components/admin/StorageSwitchConfirmDialog.tsx`, `hooks/useStorageConfig.ts`, `services/storageConfig.ts` and `services/storage.ts` (#736):

- Lazy-load the page from `@marinoscar/platform-web/storage/ui`; import the hook, the clients and the types from `/storage/headless` (`getStorageConfig` and friends are `createStorageConfigClient(api)` now).
- The page reads permissions from the host viewer instead of the app's `usePermissions`.
- To mock the hook in a page test, mock `@marinoscar/platform-web/storage/headless` (keep its other exports with `importOriginal`).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `useStorageConfig needs a transport` | No `PlatformHostProvider` above the page | Mount the provider (from `/core`), also in test wrappers, or pass `{ api }` |
| `This transport cannot send multipart/form-data` | The objects client's transport has no `postFormData` | Pass the app's HTTP client (`PlatformHttpClient` has it), or use the resumable upload |
| Save always reloads the form | Another admin saved in between (409), or the transport drops `ifMatch` | Review and save again; make the transport send `If-Match` |

## Links

- [Package README](../../README.md)
- [The API slice](../../../platform-api/src/storage/README.md)
- [The contract](../../../platform-contract/src/storage/README.md)
- [Settings UI spec](../../../../docs/specs/settings-ui.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)
