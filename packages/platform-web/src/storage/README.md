# @marinoscar/platform-web/storage

The browser half of the storage slice (issue #736, PP-8.3): the `/admin/settings/storage` page, its switch-confirmation dialog and hook, moved from the reference app with their behaviour unchanged, and an objects client for the objects API. Since PP-14.7 (#925) the page is driven by the storage drivers the API describes rather than a closed list of three, and an app or package adds a driver's form with `registerStorageDriverPanel` (or with no web code at all). Three subpaths: `/storage/headless` (`useStorageConfig`, the storage-config client, the objects client and their types, no component), `/storage/ui` (`StorageConfigPage`, default and named export, `StorageSwitchConfirmDialog`, and the driver panel registry) and `/storage/ui/driver-panels` (the registry alone). It depends on `core` and `settings` of this package (the host transport and viewer, and the settings slice's `PluggableConfigForm`; `packages/platform-slices.json`) and on `@marinoscar/platform-contract/storage` for the wire shapes and value lists.

## Purpose and scope

The page an administrator configures object storage on: the driver (the built-in `s3`, `r2`, `s3compatible`, or any driver an app registered with `registerStorageDriver`), its settings (for the built-ins: bucket, region, endpoint, account id, the access key id and the write-only secret access key, path style), the connection test (a diagnosis per check, or the driver's own message and details), bucket provisioning (or guided commands, or the driver's own answer), and the typed `SWITCH` confirmation when a save would strand existing objects. And the calls a feature makes to store a file: upload (simple or resumable), wait until it is ready, get a signed download URL.

Not here: the API (`@marinoscar/platform-api/storage`), the settings card (the app's `ADMIN_SECTIONS` declares the `Storage` card), an upload UI component.

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { createStorageObjectsClient, useStorageConfig } from '@marinoscar/platform-web/storage/headless';
const StorageConfigPage = lazy(() => import('@marinoscar/platform-web/storage/ui'));
// the driver panel registry alone, without the page (an app's main chunk):
import { registerStorageDriverPanel } from '@marinoscar/platform-web/storage/ui/driver-panels';
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

### A driver an app added

An app or package adds a storage driver on the API side with `registerStorageDriver` (`@marinoscar/platform-api/storage`). The web side needs **no code**: `GET /api/admin/storage-config` serves `descriptors` (one `PluggableDescriptor` per registered driver, `kind: 'storage-driver'`: its label, a field per setting, then one `secret` field per declared secret carrying only whether a value is stored) and `drivers` (every driver's settings, defaults filled). The page lists one radio per descriptor, labelled by the driver, and draws the selected driver's form with `StorageGenericDriverPanel`: a control per setting through the settings slice's `PluggableConfigForm` (a switch, a select for an enum, a text or number input) and a write-only field per secret (blank keeps the stored one; the helper text says whether one is saved). Save, Test connection and Create bucket send the one body `{ provider, drivers: { <id>: settings }, secrets: { <id>: { <name>: value } } }`: only the active driver's settings, a cleared text field as `''` (the API merges `drivers.<id>` over the stored settings, so an absent key would keep the old value), and `secrets` only when one was typed. "Test connection" shows the driver's `message` and `details` when it reports no checks; "Create bucket" is offered after a test that reported `bucket_missing` or failed without any checks, and shows the driver's answer (`outcome`, `message`, skipped steps) either way, so a driver that cannot provision says so.

To replace the generated form for one driver, register a component for its id at module scope:

```tsx
import { StorageGenericDriverPanel, registerStorageDriverPanel } from '@marinoscar/platform-web/storage/ui/driver-panels';

registerStorageDriverPanel('local-fs', (props) => (
  <>
    <Alert severity="warning">Objects are lost when the host is rebuilt.</Alert>
    <StorageGenericDriverPanel {...props} />
  </>
), { validate: (value) => (String(value.directory ?? '').startsWith('/') || !value.directory ? {} : { directory: 'Use an absolute path.' }) });
```

The three built-in drivers register their bespoke form (`S3FamilyDriverPanel`: the markup the page always drew) through this same registry; an app's registration for an id wins over a built-in's, whichever module loads first. A panel receives `StorageDriverPanelProps`: the driver id, its `descriptor`, the loaded `config`, the driver's edited `value` and `onChange(name, next)`, the typed `secrets` and `onSecretChange(name, next)`, the field `errors` the registered `validate` found (a non-empty result disables Save, Test and Create bucket) and `canWrite`. A panel presents and collects; the API validates every save (`STORAGE_DRIVER_SETTINGS_INVALID`, `STORAGE_UNKNOWN_DRIVER`). A runnable example for the reference app's `local-fs` driver: [`local-fs-driver-panel.test.tsx`](../../../../apps/web/src/__tests__/examples/storage/local-fs-driver-panel.test.tsx).

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `useStorageConfig({ api })` | `PlatformApiClient` | the host's | The transport, when the hook runs outside `PlatformHostProvider` |
| `createStorageObjectsClient(api)` | `StorageObjectsTransport` | none | The transport; `postFormData` is needed for the simple upload only |
| `waitForReady(object, { intervalMs, timeoutMs })` | `number`, `number` | `500`, `30000` | The polling bounds |

The page takes no props.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `useStorageConfig` | hook | `useStorageConfig(options?: { api? }): UseStorageConfigReturn` | Build your own storage settings page over the same load, save, test and provision contract | experimental | [example](../../../../apps/web/src/__tests__/pages/Admin/StorageConfigPage.test.tsx) |
| `createStorageObjectsClient` | hook | `createStorageObjectsClient(api: StorageObjectsTransport): StorageObjectsClient` | Upload, wait for, download and delete objects from a feature | experimental | [example](../../../../apps/web/src/services/storage.ts) |
| `StorageConfigPage` | component | `StorageConfigPage(): ReactElement` | Route `/admin/settings/storage` | experimental | [example](../../../../apps/web/src/App.tsx) |
| `registerStorageDriverPanel` | registry | `registerStorageDriverPanel(id: string, Component: ComponentType<StorageDriverPanelProps>, options?: { validate? }): void` | Draw one storage driver's form on the admin storage page with your own component instead of the generated one (import from `/storage/ui/driver-panels` to keep the page out of the main chunk) | experimental | [example](../../../../apps/web/src/__tests__/examples/storage/local-fs-driver-panel.test.tsx) |
| `StorageGenericDriverPanel` | component | `StorageGenericDriverPanel(props: StorageDriverPanelProps): ReactElement` | The form drawn for any driver without a registered panel; wrap it in a registered panel to add to it | experimental | [example](../../../../apps/web/src/__tests__/examples/storage/local-fs-driver-panel.test.tsx) |
| `StorageDriverPanelProps` | slot | `{ provider; descriptor; config; value; onChange; secrets; onSecretChange; errors; canWrite }` | The props of a registered driver panel: the API's descriptor of the driver, its edited settings and its write-only secrets | experimental | [example](../../../../apps/web/src/__tests__/examples/storage/local-fs-driver-panel.test.tsx) |

Supporting exports (experimental): `createStorageConfigClient`, `reportsBucketMissing`, `getStorageDriverPanel`, `StorageObjectNotReadyError`, `StorageSwitchConfirmDialog`, `STORAGE_LOCATION_IN_USE_CODE`, the value lists re-exported from the contract (`BUILTIN_STORAGE_PROVIDER_KINDS`, with `STORAGE_PROVIDER_KINDS` as its deprecated alias), and the types (`StorageConfigView` with `drivers` and `descriptors`, `StorageConfigInput` with `drivers` and `secrets`, `StorageDriverPanelComponent`, `StorageDriverPanelOptions`, `StorageDriverSettings`, `StorageConnectionTestResult`, `StorageBucketProvisionResult`, `StorageObject`, `StorageObjectsTransport`, `UseStorageConfigReturn`, ...).

## Data

None. The page reads and writes `/api/admin/storage-config` only; the objects client calls `/api/storage/objects*` and `/api/storage/status`. File bytes of a resumable upload go straight to the presigned part URLs, never through the API.

## Permissions and settings

The page is reached with `storage_config:read` (the `Storage` card's permission, the exact string `StorageConfigController` enforces; a viewer without it is redirected to `/`). Saving, the test and bucket provisioning need `storage_config:write`: without it the controls are disabled. The objects client's calls need `storage:read|write`. No settings of its own.

## UI

`StorageConfigPage`, an MUI page in the Console's settings layout: the driver choice (one radio per descriptor the API serves), the selected driver's form (the built-ins': the field groups per provider, the R2 endpoint derived from the account id, the secret with the saved hint in its helper text; any other driver's: generated from its descriptor), Save (`If-Match`; a version 409 reloads the form and says so, a `STORAGE_LOCATION_IN_USE` 409 opens `StorageSwitchConfirmDialog`, which requires the typed word), "Test connection" (each check with its status and code, or the driver's `message` and `details`) and "Create bucket" (offered on `bucket_missing`, or after a failed test that reported no checks; never on `bucket_forbidden`). A driver the build no longer registers is named in a warning instead of drawing an empty form. The app's admin registry entry (`ADMIN_SECTIONS`, title `Storage`, `permission: 'storage_config:read'`) is unchanged by the move.

## Infra

None.

## Observability

None. The page emits no telemetry of its own; the API logs and audits saves, tests and provisioning.

## Security notes

- Every secret is write-only: the page never receives one (the response carries a masked status for the active driver's first secret, and only `hasValue` on each descriptor secret field), and it sends one only when the admin typed one, as `secrets.<id>.<name>`, never inside `drivers`. `StorageConfigPage.wire.test.tsx` and `test/storage/StorageConfigPage.drivers.test.tsx` assert the request bodies and that a typed value never reaches the markup.
- A panel is a presentation choice. Hiding or disabling a control never replaces the API's validation or the `storage_config:write` check.
- A driver's test `message` and `details` are rendered as text (the API redacts secret material from them); a custom panel should do the same.
- A signed download URL is a bearer credential for its lifetime: the client fetches it when needed and nothing here stores or logs it.
- The two probes answer HTTP 200 carrying the diagnosis; the hook never turns a failed diagnosis into success, and a failed call into a fabricated result.

## Conformance suite

None in the web package for this slice. The API slice's `storage` suite covers the shapes and keys, and `describeStorageDriverConformance` the drivers; the reference app's page tests (`apps/web/src/__tests__/pages/Admin/StorageConfigPage*.test.tsx`) render this package's page, and `test/storage/StorageConfigPage.builtin-dom.test.tsx` holds a snapshot of the three built-in forms recorded before the registry existed.

## Upgrade notes

New subpaths in this version. From the reference app's `pages/Admin/StorageConfigPage.tsx`, `components/admin/StorageSwitchConfirmDialog.tsx`, `hooks/useStorageConfig.ts`, `services/storageConfig.ts` and `services/storage.ts` (#736):

- Lazy-load the page from `@marinoscar/platform-web/storage/ui`; import the hook, the clients and the types from `/storage/headless` (`getStorageConfig` and friends are `createStorageConfigClient(api)` now).
- The page reads permissions from the host viewer instead of the app's `usePermissions`.
- To mock the hook in a page test, mock `@marinoscar/platform-web/storage/headless` (keep its other exports with `importOriginal`).

#925 (PP-14.7): additive, with one behaviour change in what the page sends. New subpath `/storage/ui/driver-panels` (also exported by `/storage/ui`): `registerStorageDriverPanel`, `getStorageDriverPanel`, `StorageGenericDriverPanel` and the panel types. `StorageProviderKind` and `MissingStorageConfigField` are `string`; `StorageConfigView` gained `drivers` and `descriptors` (the flat `bucket`, `region`, `endpoint`, `accountId`, `accessKeyId`, `forcePathStyle` are a deprecated read view of the active built-in); `StorageConfigInput` needs only `provider` and gained `drivers` and `secrets` (the flat fields and `secretAccessKey` stay as deprecated aliases for the built-ins); `StorageConnectionTestResult` and `StorageBucketProvisionResult` gained `message` (and `details` on the test). The page now saves, tests and provisions with `{ provider, drivers: { <id>: settings }, secrets }` instead of the flat fields, so an app that mocks the PUT body must read `drivers.<provider>`. The S3-compatible radio label is the driver's own ("S3-compatible") rather than the former hard-coded "S3-compatible (MinIO, Wasabi, Backblaze B2…)". The built-in forms' markup is otherwise unchanged. The storage slice now imports `PluggableConfigForm` through the settings slice's entry (`platform-slices.json`: `storage` depends on `settings`).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `useStorageConfig needs a transport` | No `PlatformHostProvider` above the page | Mount the provider (from `/core`), also in test wrappers, or pass `{ api }` |
| `This transport cannot send multipart/form-data` | The objects client's transport has no `postFormData` | Pass the app's HTTP client (`PlatformHttpClient` has it), or use the resumable upload |
| A driver an app registered is missing from the page | The API did not list it: its `registerStorageDriver` call did not run before the application bootstrapped | Register it at import time; see the API slice README |
| Save always reloads the form | Another admin saved in between (409), or the transport drops `ifMatch` | Review and save again; make the transport send `If-Match` |

## Links

- [Package README](../../README.md)
- [The API slice](../../../platform-api/src/storage/README.md)
- [The contract](../../../platform-contract/src/storage/README.md)
- [Settings UI spec](../../../../docs/specs/settings-ui.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)
