# @marinoscar/platform-web/doctor

`@marinoscar/platform-web/doctor`: the admin Doctor page (issue #696), in two entry points of one slice. `/doctor/headless` holds the wire types, the client, the `useDoctor` hook and the category labels, with no component; `/doctor/ui` holds `DoctorPage`, its parts and the `doctorSettingsPage` descriptor the app registers. Depends on the `core` slice only (`packages/platform-slices.json`): it reads the app through `usePlatformHost()`.

## Purpose and scope

Does: render the report of `GET /api/admin/doctor` (`@marinoscar/platform-api/doctor`): the verdict, counts by status, one accordion per category (problems expanded), a "Problems only" filter, each check's detail, remedy, verbatim error and "Open settings" link, and "Run again" (`refresh=true`). A failing check is data, never a page error; the error alert is reserved for a request that failed.

Does not: check permissions (the app's route gate does), import app context, layout or navigation, own the registry card or the route (the app appends both from the descriptor), or define the wire contract (the zod schemas live in `@marinoscar/platform-api/doctor` until #701 moves them to `@marinoscar/platform-contract`; the types here mirror them by hand).

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { useDoctor, createDoctorClient } from '@marinoscar/platform-web/doctor/headless';
import { DoctorPage, doctorSettingsPage } from '@marinoscar/platform-web/doctor/ui';
```

`/doctor/ui` needs the package peers `@mui/material`, `@mui/icons-material`, `@emotion/*` and `react-router-dom` (links); `/doctor/headless` needs only `react`.

## Quick start

The reference app binds the page in three places:

```tsx
// apps/web/src/config/adminSections.tsx: the LAST Observability card
{ ...doctorSettingsPage.card, Icon: doctorSettingsPage.Icon },

// apps/web/src/App.tsx: one route, gated on the card's permission
<Route path="/admin/settings/doctor" element={
  <RequirePermission permission="system_settings:read" fallback={<Navigate to="/" replace />}>
    <DoctorPage />
  </RequirePermission>
} />

// apps/web/src/pages/Admin/DoctorPage.tsx: the lazily loaded binding
export default function DoctorPage() {
  const { hasPermission } = usePermissions();
  if (!hasPermission(doctorSettingsPage.card.permission!)) return <Navigate to="/" replace />;
  return <doctorSettingsPage.Page />;
}
```

`PlatformHostProvider` (from `/core`) must be mounted above the route.

## Configuration

`DoctorPage` props (all optional; the app's route renders `<DoctorPage />`):

| Option | Type | Default | Meaning |
|---|---|---|---|
| `categories` | `readonly { key; label }[]` | `PLATFORM_DOCTOR_CATEGORY_LABELS` | Display order and labels. A category not listed renders after, title-cased (`fork_widgets` becomes "Fork Widgets"). Pass the app's list when it adds categories or `DoctorModule.forRoot({ categoryOrder })` reorders them. |
| `sx` | `SxProps<Theme>` | none | Styles for the page's outer box. |
| `slots.Header` | `ComponentType<{ title; description }>` | the default `h1` and subtitle | Replaces the title block; receives the descriptor's title and description. |

`createDoctorClient(api, path = '/admin/doctor')` takes the route when the app moved it with `DoctorModule.forRoot({ path })`. `useDoctor(client?)` uses `createDoctorClient(usePlatformApi())` unless given a client (keep its identity stable).

### Theme tokens

Status colours come from the theme-token contract `palette.status.{ok,warn,crit,neutral}` (issue #686): `pass` is `ok`, `warn` is `warn`, `fail` is `crit`, `skip` is `neutral`. An app restyles the Doctor by setting those tokens in its theme; a theme that sets none falls back to the palette roles the tokens default to (`success`, `warning`, `error`, `grey[500]`), so it looks as before. The verdict alert keeps MUI's severity colours.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `doctorSettingsPage` | component | `PlatformSettingsPage<never>` | Register the Doctor as one admin card and one route | experimental | [example](../../../../apps/web/src/config/adminSections.tsx) |
| `DoctorPage` | component | `DoctorPage(props?: DoctorPageProps): ReactElement` | Render the page in the app's route | experimental | [example](../../../../apps/web/src/pages/Admin/DoctorPage.tsx) |
| `DoctorPageProps` | slot | `{ categories?; sx?; slots?: { Header? } }` | Relabel or reorder categories, restyle, or replace the header | experimental | [example](../../../../apps/web/src/pages/Admin/DoctorPage.tsx) |
| `useDoctor` | hook | `useDoctor(client?: DoctorClient): { report; isLoading; error; rerun }` | Build a different Doctor view on the same data | stable | [example](../../../../apps/web/src/pages/Admin/DoctorPage.tsx) |
| `createDoctorClient` | hook | `createDoctorClient(api: PlatformApiClient, path?: string): DoctorClient` | Call the Doctor API outside the page, or at a moved path | stable | [example](../../../../apps/web/src/pages/Admin/DoctorPage.tsx) |

Supporting exports. `/doctor/headless`: `DoctorStatus`, `DoctorCheckReport`, `DoctorReport`, `DoctorReportQuery`, `DoctorClient`, `UseDoctorReturn`, `DOCTOR_STATUS_ORDER`, `PLATFORM_DOCTOR_CATEGORY_LABELS`, `DoctorCategoryLabel`, `categoryLabel(key, labels?)`. `/doctor/ui`: `CheckRow`, `CheckRowProps`, `StatusIcon`, `STATUS_LABELS`, `STATUS_CHIP_COLORS` (the palette role each status's token defaults to), `DoctorPageHeaderProps`.

## Data

None. The page reads `GET /admin/doctor` through the host's transport and keeps the last report in component state.

## Permissions and settings

The card and the route require `system_settings:read` (`doctorSettingsPage.card.permission`), the exact string `@marinoscar/platform-api/doctor` enforces by default (`DEFAULT_DOCTOR_PERMISSION`). The page itself checks nothing; a 403 from the API shows "You do not have permission to run the Doctor". No `feature`: the Doctor reports on AI and telemetry while they are off.

## UI

One page, `/admin/settings/doctor`, contributed as one admin registry card (title "Doctor", the description the page shows as its subtitle, icon `HealthAndSafetyOutlined`). The app appends the card last in its Observability section. One slot (`slots.Header`); theme tokens `palette.status.*` (see Configuration).

## Infra

None.

## Observability

None. The page logs nothing; the API's warn log on a throwing check is the Doctor's only log line.

## Security notes

Read-only: the page only reads the report; "Run again" sends `refresh=true` and nothing else. It renders the API's strings as text (no HTML), shows errors verbatim in a `<pre>` (the API guarantees no secret material in any field), and leaves authorization to the API and the app's route gate.

## Conformance suite

None yet. The reference app's `apps/web/src/__tests__/config/platformPages.test.ts` checks the registration rules (one card, one route, permission equal to the package default); the package's `test/doctor/` covers the page with `createTestPlatformHost`.

## Upgrade notes

First packaged release (#696). Moving from the app's own Doctor page: delete `components/doctor/CheckRow.tsx`, `hooks/useDoctor.ts` and `services/doctor.ts`; build the card from `doctorSettingsPage.card`; mount `PlatformHostProvider` (`/core`); render `doctorSettingsPage.Page` from the route. Behaviour, texts and test ids are unchanged.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `useDoctor: no PlatformHostProvider above this component and no client was passed` | Mount `PlatformHostProvider` around the shell (and in the test wrapper), or pass `createDoctorClient(api)`. |
| The page requests the report in a loop | The host's `api` changes identity on each render; make it a module-level constant. |
| A fork's category shows as a title-cased key | Pass `categories` with its label, in the order `DoctorModule.forRoot({ categoryOrder })` uses. |
| Status colours ignore the theme | The theme sets the tokens under another key; they are `palette.status.ok`, `warn`, `crit` and `neutral`. |

## Links

- Spec: [docs/specs/doctor.md](../../../../docs/specs/doctor.md) (§2.8 the page); runbook: [docs/runbooks/doctor.md](../../../../docs/runbooks/doctor.md).
- The API side: [`@marinoscar/platform-api/doctor`](../../../platform-api/src/doctor/README.md).
- Hosting and registration: [core README](../core/README.md).
- Package README: [platform-web](../../README.md).
