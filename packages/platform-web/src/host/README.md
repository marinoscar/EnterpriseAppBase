# @marinoscar/platform-web/host

The host pages of the platform (issue #891): the admin About page, the admin Maintenance page and the public maintenance screen (`/ui`), with the wire shapes, the API calls, the maintenance-block store and the hooks they render through (`/headless`). React and MUI. It depends on `core` and `identity` of this package (`packages/platform-slices.json`: the transport and the viewer's permissions); the API half is the `host` slice of [`@marinoscar/platform-api`](../../../platform-api/src/host/README.md).

## Purpose and scope

Three screens an operator or a blocked user meets around a deployment:

- **About** (`/admin/settings/about`): what is actually running here: the API version, the deployment mode, the deploy document `appctl deploy` leaves on disk (commit, ref, install and update times, the run's outcome and failed step, the proxy and certificate expiry, the host, the history) and a database liveness fact. It has three render states (a document, no usable document, and a document describing a failed run) and never says how the instance was deployed when no record was found.
- **Maintenance** (`/admin/settings/maintenance`): the switch, the message and `allowAdmins`, with every contributing layer (environment variable, server task, saved setting) and the one that decides.
- **The maintenance screen**: what a viewer sees instead of the application while a deliberate window is open. Not a route: the app's gate renders it in place.

The headless half is the client side of the maintenance wire contract: `readMaintenanceBlock` (the one place that decides whether a failed response is a window), the module-level block store (written from the app's HTTP client, read through `useSyncExternalStore`), `createHostApi`, `useAbout`, `useMaintenance` and `useMaintenanceBlock`.

Not here: the gate and the banner (they sit in the app's layout), the registry cards and routes (the Settings UI Pattern keeps them in the app's section registries), the API (the host slice of `@marinoscar/platform-api`).

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { useAbout, useMaintenance, useMaintenanceBlock } from '@marinoscar/platform-web/host/headless';
import { AboutPage, MaintenancePage, MaintenanceScreen } from '@marinoscar/platform-web/host/ui';
```

The package's peers: `react`, `@mui/material`, `@mui/icons-material`, `react-router-dom`.

## Quick start

The reference app binds each page in a one-line file and keeps its card and route ([`pages/Admin/AboutPage.tsx`](../../../../apps/web/src/pages/Admin/AboutPage.tsx), [`pages/Admin/MaintenancePage.tsx`](../../../../apps/web/src/pages/Admin/MaintenancePage.tsx), [`pages/MaintenancePage.tsx`](../../../../apps/web/src/pages/MaintenancePage.tsx)):

```tsx
const AboutPage = lazy(() => import('./pages/Admin/AboutPage'));
// <Route path="/admin/settings/about" element={<RequirePermission permission="system_settings:read"><AboutPage /></RequirePermission>} />

// The app's HTTP client feeds the block store; the gate renders the screen.
const api = new PlatformHttpClient({
  onErrorResponse: (status, body) => {
    const block = readMaintenanceBlock(status, body);
    if (block) reportMaintenanceBlock(block);
  },
});
const { block, clear } = useMaintenanceBlock();
if (block) return <MaintenanceScreen appName={APP_NAME} block={block} onRetry={clear} />;
```

The pages and the two data hooks need `PlatformHostProvider` (the transport; the viewer's permissions come from the identity slice's auth context). The maintenance screen and `useMaintenanceBlock` need neither: they run while the API is refusing.

## Configuration

The pages take no props. `MaintenanceScreen` takes:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `appName` | `string` | required | The heading: "<appName> is under maintenance". |
| `block` | `MaintenanceBlock` | required | What the API said when it refused the request. |
| `onRetry` | `() => void` | required | Forget the block so the application renders again and its pages re-fetch. |

`useMaintenance({ enabled, pollIntervalMs })`: `enabled: false` makes no request (the banner mounts for every user); `MAINTENANCE_POLL_INTERVAL_MS` (60 s) is the banner's period. The relative times use the host's `formatRelativeTime` when it supplies one, else a built-in formatter with the same rules.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `AboutPage` | component | `AboutPage(): ReactElement` | Route `/admin/settings/about` behind `system_settings:read` | experimental | [example](../../../../apps/web/src/pages/Admin/AboutPage.tsx) |
| `MaintenancePage` | component | `MaintenancePage(): ReactElement` | Route `/admin/settings/maintenance` behind `system_settings:read` | experimental | [example](../../../../apps/web/src/pages/Admin/MaintenancePage.tsx) |
| `MaintenanceScreen` | component | `MaintenanceScreen(props: MaintenanceScreenProps): ReactElement` | Render in place of the application while a window is open, outside the layout | experimental | [example](../../../../apps/web/src/pages/MaintenancePage.tsx) |
| `useMaintenance` | hook | `useMaintenance(options?: UseMaintenanceOptions): UseMaintenanceReturn` | Read and change the window (the admin page, the banner) | experimental | [example](../../../../apps/web/src/components/common/MaintenanceBanner.tsx) |
| `useMaintenanceBlock` | hook | `useMaintenanceBlock(): UseMaintenanceBlockReturn` | Subscribe to the block the HTTP client recorded (the gate) | experimental | [example](../../../../apps/web/src/components/common/MaintenanceGate.tsx) |

Supporting exports (experimental): `useAbout`, `createHostApi`, the recogniser and store (`readMaintenanceBlock`, `reportMaintenanceBlock`, `clearMaintenanceBlock`, `getMaintenanceBlock`, `subscribeToMaintenanceBlock`, `isDecidingLayer`), the wire constants (`MAINTENANCE_ERROR_MARKER`, `MAINTENANCE_RETRY_AFTER_SECONDS`, `MAINTENANCE_FALLBACK_MESSAGE`, `MAINTENANCE_ADMIN_PATH`, `MAINTENANCE_POLL_INTERVAL_MS`) and the wire types (`AboutResponse` and its parts, `MaintenanceStatus`, `UpdateMaintenanceInput`).

## Data

None stored. The block store is module state in the browser tab (one slot, never persisted). About is not polled: a deployment's identity changes when somebody deploys, and `refresh` re-reads on demand (the API reads the deploy document from disk on every request).

## Permissions and settings

No permission of its own. The cards and routes are `system_settings:read` (the literal the API enforces: `about.controller.ts` and `maintenance.controller.ts` of the host slice); `system_settings:write` enables the Maintenance page's controls (they are disabled, never hidden, without it). Both pages also redirect to `/` without `system_settings:read`, as a second line behind the app's route gate. The registry cards stay in the app's `ADMIN_SECTIONS` (`apps/web/src/config/adminSections.tsx`) with their exact permission strings.

## UI

`/ui`: `AboutPage`, `MaintenancePage` and `MaintenanceScreen`. The DOM and `sx` are those of the pages as the reference app rendered them before the move, so the visual baselines do not change. The About history is a table on `sm` and up and stacked cards on a phone, chosen by mounting one of them, never by hiding the other.

## Infra

None.

## Observability

None. The pages emit nothing beyond the API calls they make.

## Security notes

`GET /api/admin/about` always answers 200, so `useAbout`'s `error` means only that the request failed (a 403, the network, a window), never that the deployment is broken; the page renders a missing or invalid deploy document and an unreachable database as facts. The screen shows the operator's message from the 503 body as text, never as markup. An ordinary 503 (no `details.reason === 'MAINTENANCE_MODE'`) is never read as a window, so a crashed API does not promise that the application will be back shortly.

## Conformance suite

None of its own. The page and hook suites live in `packages/platform-web/test/host/`; the app keeps the gate and banner suites and the test that the Maintenance card's route equals `MAINTENANCE_ADMIN_PATH` (`apps/web/src/__tests__/services/maintenance.test.ts`), and `settingsCards.test.ts` pins the About card's permission to the host slice's controller.

## Upgrade notes

New in this version: moved from the reference app's `pages/Admin/AboutPage.tsx`, `pages/Admin/MaintenancePage.tsx`, `pages/MaintenancePage.tsx`, `hooks/useAbout.ts`, `hooks/useMaintenance.ts`, `services/maintenance.ts` and the About and Maintenance types. The module-level `getAbout`, `getMaintenanceStatus` and `updateMaintenance` of `services/api.ts` became the methods of `createHostApi`. The public screen takes `appName` instead of importing `APP_NAME`. An app that kept local copies deletes them, keeps one-line bindings and re-exports `services/maintenance.ts` from this slice so the HTTP client, the gate and the banner share ONE block store.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `usePlatformHost: no PlatformHostProvider above this component` | A page or `useMaintenance` rendered outside the host provider | Mount `PlatformHostProvider` inside the auth provider |
| The gate never shows the screen | The HTTP client's `onErrorResponse` does not call `reportMaintenanceBlock`, or the app has a second copy of the store | Feed the store from the client; import the store from this slice only |
| An admin is locked out of the Maintenance page during a window | The gate does not let `MAINTENANCE_ADMIN_PATH` through | Exempt that route in the gate |

## Links

- [Package README](../../README.md)
- [The API slice](../../../platform-api/src/host/README.md)
- [Spec: maintenance mode](../../../../docs/specs/maintenance-mode.md)
