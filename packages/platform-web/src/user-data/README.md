# @marinoscar/platform-web/user-data

The user-data slice of the web package (issue #743, PP-9.1): the user Danger Zone page (`/settings/danger-zone`), the admin factory reset page (`/admin/settings/factory-reset`), the organization offboarding dialog and its row button, the typed-confirmation dialog they share, and the start-and-poll hook. The UI half of `@marinoscar/platform-api/user-data`. Two entry points: `@marinoscar/platform-web/user-data/headless` (clients, `useDestructiveJob`, `dangerZoneLastViolations`; no component) and `@marinoscar/platform-web/user-data/ui` (pages, dialogs, the two settings-page descriptors). It depends on `core` only (`packages/platform-slices.json`).

## Purpose and scope

The UX rules both source apps arrived at, once:

- **Two layers** (kvox): narrow scopes (`layer: 'specific'`) are rows with live counts and bytes, each disabled at zero; under a divider and an error-coloured heading come the composite scopes (`content`, `everything`).
- **Never inline** (EvoPath): every destructive action opens `TypedConfirmDialog`, which needs the acknowledgement checkbox AND the exact phrase; while the job runs it cannot be closed and shows progress; on success it lists the non-zero counts, warns when stored files were kept, and the page calls `onCompleted` so the app clears its caches; on failure it shows the error and offers a retry.
- **Static lists render even if the summary fails**: what is always kept, what a factory reset deletes and keeps, and the two built-in scopes.
- **Backup first**: the factory reset page links to `/admin/settings/db-backup` above everything else, and says why the button is off in SaaS mode.

Not here: the routes, the registries and the jobs (`@marinoscar/platform-api/user-data`); the app's cache clearing (the app passes `onCompleted`).

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpath:

```ts
import { UserDangerZonePage, FactoryResetPage, dangerZoneSettingsPage } from '@marinoscar/platform-web/user-data/ui';
import { useDestructiveJob, dangerZoneLastViolations } from '@marinoscar/platform-web/user-data/headless';
```

Peers: `react`, `react-router-dom` (the backup link), `@mui/material`, `@mui/icons-material`. The pages read the app's transport and viewer from `PlatformHostProvider` (`@marinoscar/platform-web/core`).

## Quick start

The reference app binds the pages ([`UserDataPages.tsx`](../../../../apps/web/src/pages/UserDataPages.tsx)), routes them in [`App.tsx`](../../../../apps/web/src/App.tsx) and declares the two cards in Danger Zone groups pinned last of both registries ([`userSettingsSections.tsx`](../../../../apps/web/src/config/userSettingsSections.tsx), [`adminSections.tsx`](../../../../apps/web/src/config/adminSections.tsx)):

```tsx
export function DangerZoneRoute() {
  const { refreshUser } = useAuth();
  return <UserDangerZonePage onCompleted={() => void refreshUser()} />;
}
// userSettingsSections.tsx, the LAST group:
{ label: DANGER_ZONE_GROUP_LABEL, cards: [{ ...dangerZoneSettingsPage.card, Icon: dangerZoneSettingsPage.Icon }] },
```

## Configuration

None beyond props: `onCompleted` and `pollIntervalMs` (default 1500 ms) on both pages; `organization`, `onClose`, `onCompleted` on the offboarding dialog.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `dangerZoneLastViolations` | hook | `(sections, expectedPath) => string[]` | Assert both Danger Zone groups are last (web conformance) | experimental | [settingsCards.test.ts](../../../../apps/web/src/__tests__/config/settingsCards.test.ts) |
| `UserDangerZonePage` | component | `(props: UserDangerZonePageProps) => ReactElement` | Mount `/settings/danger-zone` | experimental | [UserDataPages.tsx](../../../../apps/web/src/pages/UserDataPages.tsx) |
| `FactoryResetPage` | component | `(props: FactoryResetPageProps) => ReactElement` | Mount `/admin/settings/factory-reset` | experimental | [UserDataPages.tsx](../../../../apps/web/src/pages/UserDataPages.tsx) |
| `OffboardOrganizationButton` | component | `(props: OffboardOrganizationButtonProps) => ReactElement \| null` | The organizations page's row action (`renderActions`) | experimental | [UserDataPages.tsx](../../../../apps/web/src/pages/UserDataPages.tsx) |
| `dangerZoneSettingsPage` | component | `PlatformSettingsPage` | The user card (no permission, no feature) | experimental | [userSettingsSections.tsx](../../../../apps/web/src/config/userSettingsSections.tsx) |
| `factoryResetSettingsPage` | component | `PlatformSettingsPage` | The admin card (`system:factory_reset`) | experimental | [adminSections.tsx](../../../../apps/web/src/config/adminSections.tsx) |

Supporting exports (experimental): `useDestructiveJob` (start a destructive job and poll it), `TypedConfirmDialog` (the shared dialog, for an app's own destructive flow), `OrgOffboardingDialog` (what the button opens), `createUserDataClient`, `createFactoryResetClient`, `createOrgOffboardingClient` and their types, `DANGER_ZONE_GROUP_LABEL`, the copy constants (`USER_DATA_KEPT`, `FACTORY_RESET_DELETED`, `FACTORY_RESET_KEPT`, the page titles and descriptions).

## Data

None. The pages read `GET /api/user-data/summary` and the two other summaries, and poll the status routes.

## Permissions and settings

The user card declares no `permission` (every role holds `user_settings:write`) and no `feature`, so it stays reachable while AI is off. The admin card declares `system:factory_reset`, the exact string the API enforces. `OffboardOrganizationButton` renders only for a viewer holding `orgs:offboard`, never for the default organization. Both Danger Zone groups are pinned last: the one documented exception to append-only ([settings-ui.md](../../../../docs/specs/settings-ui.md)).

## UI

`UserDangerZonePage`, `FactoryResetPage`, `OrgOffboardingDialog`, `OffboardOrganizationButton`, `TypedConfirmDialog`. MUI only; the dialogs label themselves, the progress is a `role="status"` live region, the result list is a labelled list, and every control works by keyboard. Phone width: rows stack below `sm`.

## Infra

None.

## Observability

None in the browser. The API counts and audits every request and job.

## Security notes

The phrase is collected here and re-checked by the API (a wrong phrase is a `400`, shown in the dialog). No page decides a permission: the cards gate reachability, the API enforces.

## Conformance suite

`dangerZoneLastViolations(sections, expectedPath)` is the web counterpart of the API's `user-data` suite; the reference app asserts both registries with it in [settingsCards.test.ts](../../../../apps/web/src/__tests__/config/settingsCards.test.ts). The package's own tests are `test/user-data/`.

## Upgrade notes

First release (#743). The identity slice's `OrganizationsPage` gained a `renderActions` prop, which is where the reference app mounts `OffboardOrganizationButton`.

## Troubleshooting

- **The confirm button stays disabled**: tick the checkbox and type the phrase exactly (case and spacing included); the offboarding dialog also needs a skip reason when a precondition fails.
- **The success list warns about kept files**: the storage provider refused them; their rows are kept, and running the deletion again retries them.

## Links

- [docs/specs/user-data-reset.md](../../../../docs/specs/user-data-reset.md), [docs/runbooks/factory-reset.md](../../../../docs/runbooks/factory-reset.md).
- [`@marinoscar/platform-api/user-data`](../../../platform-api/src/user-data/README.md), [`@marinoscar/platform-contract/user-data`](../../../platform-contract/src/user-data/README.md).
