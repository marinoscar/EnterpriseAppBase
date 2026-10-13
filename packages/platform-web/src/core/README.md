# @marinoscar/platform-web/core

`@marinoscar/platform-web/core`: the **web host ports** every packaged page reuses (issue #696). A packaged page reaches the app through one context, never by importing app code: the app's transport, the signed-in viewer and optional formatting hooks. It also defines the settings-page descriptor an app turns into a registry card and a route. No other slice of the package is needed (`packages/platform-slices.json`: `"core": []`).

## Purpose and scope

Does: the packaged-page slot contract `PageSlotsBase` and `TableSlots` (PP-14.23, [Page slots](#page-slots)); the SSE client `connectSse`/`postSse`/`SseParser` (issue #900); `PlatformApiClient` (the app's transport, as an interface) and `PlatformApiError` with `isPlatformApiError`; `PlatformViewer` (who is looking: user id, `hasPermission`, `isFeatureEnabled`); `PlatformWebHost` and `PlatformHostProvider` with `usePlatformHost`, `usePlatformApi`, `usePlatformViewer` and `useOptionalPlatformHost`, plus `usePlatformPort` and `useOptionalPlatformPort` for the ports an extension package declares in `host.extensions`; `PlatformSettingsPage`, the descriptor of a packaged admin or settings page; and `PlatformHttpClient` with `ApiError` (issue #727): the browser transport moved from the reference app's `services/api.ts`, which holds the access token, refreshes once on a 401 and retries, serialises refreshes across pages with a Web Lock, and signals a lost session. The identity slice's `AuthProvider` drives sessions through it. `createPlatformApiClient` (issue #868) adapts that one client to `PlatformApiClient`, so an app hands the packaged pages the same transport `AuthProvider` drives instead of writing the adapter by hand.

Does not: decide where the API lives or name the refresh lock (`PlatformHttpClient` takes both as options, so no app identity is baked in), interpret an error response beyond the error envelope (the app's `onErrorResponse` hook does, e.g. the reference app's maintenance recogniser), know the app's routes, layout, navigation or auth context, or register cards and routes itself. The app owns its registries (`ADMIN_SECTIONS`, `USER_SETTINGS_SECTIONS`) and its router (CLAUDE.md, Settings UI Pattern); this slice only describes what a packaged page needs.

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpath:

```ts
import { PlatformHostProvider, usePlatformHost } from '@marinoscar/platform-web/core';
```

Peers are those of the package ([README](../../README.md#install-and-peer-dependencies)); this slice uses `react` and, for a type only, `@mui/material`.

## Quick start

The reference app builds the host once from what it already has and mounts the provider around its shell, inside its auth provider ([`platformHost.tsx`](../../../../apps/web/src/platform/platformHost.tsx), [`App.tsx`](../../../../apps/web/src/App.tsx)):

```tsx
export const api = new PlatformHttpClient({ baseUrl: '/api', refreshLockName: `${APP_SLUG}-auth-refresh` });
export const appPlatformApi = createPlatformApiClient(api, { postSse });   // ApiError -> PlatformApiError

export function AppPlatformHostProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const host = useMemo(() => ({
    api: appPlatformApi,                                   // stable identity
    viewer: { userId: user?.id ?? null, hasPermission, isFeatureEnabled: (f) => features[f] === true },
    formatRelativeTime,
  }), [user?.id, hasPermission /* , features */]);
  return <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
}
```

## Configuration

`PlatformHostProvider` props:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `host.api` | `PlatformApiClient` | required | The app's transport. Paths are relative to the API base (`'/admin/doctor'`); each call resolves to the response's `data` and rejects with a `PlatformApiError` on an error status. Keep its identity stable: packaged hooks key their effects on it. |
| `host.viewer` | `PlatformViewer` | required | `userId`, `hasPermission(permission)`, `isFeatureEnabled(feature)`. |
| `host.formatRelativeTime` | `(iso: string) => string` | each page's own fallback | Format timestamps the way the app does. |
| `host.extensions` | `Readonly<Record<string \| symbol, unknown>>` | none | Ports an installed extension package declares for itself, keyed by the string or `Symbol.for(...)` the package exports. The package reads one with `usePlatformPort<T>(key)`, which throws a clear error when the app did not supply it (`useOptionalPlatformPort` answers `undefined`). Own keys only: `Object.prototype` members are never ports. Keep the record and each port stable across renders. |
| `host.applyTheme` | `(theme: 'light' \| 'dark' \| 'system') => void` | none (the preference is stored, the app's theme left alone) | Push the stored theme preference into the app's theme context (the Appearance page, #892). Keep its identity stable. |
| `children` | `ReactNode` | required | The routed tree that may render packaged pages. |

### Host ports

| Port | What it is for | How the reference app binds it |
|---|---|---|
| `PlatformApiClient` | Every API call of a packaged page | `createPlatformApiClient(api, { postSse })` over the app's `services/api.ts` (auth header, token refresh, maintenance handling stay in the app); `ApiError` mapped onto `PlatformApiError`; a network failure passes through and is *not* a `PlatformApiError`. The optional `postFormData(path, formData)` (#892) sends a multipart body (the profile picture upload) through the same client. The optional `getBlob(path)` (#772) returns a download's raw body and headers (`PlatformBlobResponse`); the adapter maps it (and `postBlob`) onto `responseType: 'blobWithHeaders'`. Every method takes `PlatformRequestOptions`: `signal`, `ifMatch` (the `If-Match` header) and `headers` (#731: a page's extra request headers, such as the link token's `x-link-token`); the adapter (`toHttpRequestOptions`) sends `headers` first, so `If-Match` and its own `Authorization` and `Content-Type` win |
| `PlatformViewer` | Permission and feature questions a page asks of content (never of reachability: the route gate does that) | `usePermissions().hasPermission`, the auth context's user id, the shell's AI and telemetry flags |
| `formatRelativeTime` | Consistent dates | `utils/relativeTime` |

Every later packaged page reuses these ports unchanged.

### Registering a packaged page (Settings UI Pattern)

The app stays the owner of `ADMIN_SECTIONS` / `USER_SETTINGS_SECTIONS` and of its routes. For each packaged page it:

1. appends a card `{ ...page.card, Icon: page.Icon }` to the right section (append-only rule);
2. adds one route `path={page.card.path}` whose element is `<RequirePermission permission={page.card.permission}>` around the page (plus `RequireAiEnabled` / `RequireTelemetryEnabled` when `card.feature` says so);
3. lists the page in `apps/web/src/__tests__/config/platformPages.test.ts`, which asserts one card, one route, and that the card's `permission` is the exact string the packaged API controller enforces (rule 3).

`PlatformSettingsPage<never>['card']` (a page that is never feature-gated) is assignable to the app's `SettingsCardDef` minus `Icon`; that test asserts it too.

### Page slots

Every packaged page (a component this package exports from a `ui` entry point under a name ending in `Page`) takes one optional prop, `slots`. The contract is the same on every page, so an app learns it once. Absent slots leave the page's markup exactly as it was; a slot only adds to the page or replaces one named part of it.

```ts
interface PageSlotsBase {
  Header?: PageSlot<PageHeaderSlotProps>;        // replaces the title and subtitle block
  BeforeContent?: PageSlot<object>;              // a banner or notice area under the header
  Sections?: PageSlot<PageSectionsSlotProps>;    // extra sections, rendered at both ends: { position: 'top' | 'bottom' }
  AfterContent?: PageSlot<object>;               // after everything else
}
interface TableSlots<Row, Column> {              // a page that draws a table
  Columns?: (base: Column[]) => Column[];        // add, reorder or remove columns
  RowActions?: PageSlot<{ row: Row }>;           // extra per-row actions
  DetailPanel?: PageSlot<{ row: Row }>;          // extra content in the row's detail view
  Toolbar?: PageSlot<object>;                    // extra controls above the table
}
// A page's props: { slots?: PageSlotsBase & TableSlots<Row, Column> & <page-specific slots> }
```

Rules:

- **Every slot is optional**, and a page with none renders the markup it always did (the pages keep `builtin-dom` snapshot tests that pin this).
- **A slot receives data, never a client.** It gets the row, the check, or the state the page already holds, read-only. A slot that must call the API uses `usePlatformApi()` or its own client; permissions stay enforced by the API.
- **Order of the body**: `Header`, `BeforeContent`, `Sections` (`top`), the page's own content, `Sections` (`bottom`), `AfterContent`, all inside the page's existing container, so slot controls live inside the landmark the page already has and add no layout shift when absent. `Sections` is rendered twice; return `null` for the position you do not want.
- **`Header`** gets `{ title, description?, readOnly?, actions? }`. Print `title` as the page's `h1`. `actions` is `null` on a page whose default header carries none (every operations page keeps its buttons in the body, so a custom header never loses them). A `Header` written against an older page-specific props type (`JobsPageHeaderProps`, `NodesPageHeaderProps`, `DoctorPageHeaderProps`) keeps working: those types gain `actions` and nothing else.
- **`PageSlot<Props>`** is a function component type whose parameter is compared bivariantly, so a page may pass a slot more data than the base names (the database backup page's `Sections` also gets the policy and the runs) and the page's `slots` type still extends `PageSlotsBase`. Pass a plain function component.
- **Table slots** work through the table's columns: `RowActions` adds a `More actions` column (secondary priority) and `DetailPanel` a `Details` column (detail priority, so it shows in the row expander and the phone card); `Columns` runs last and sees both. `useTableSlotColumns(columns, slots)` does this for a page and returns `columns` itself when no table slot is set.
- **Page-specific slots** (`Filters`, `VitalsPanel`, `RunRowActions`, `CheckRowActions`) are documented in the README of the page's slice.
- **Enforced.** `test/page-slots.contract.test.ts` reads the `ui` entries of the package's `exports` map with the TypeScript compiler and fails, naming the page, when an exported `*Page` has no `slots` prop that extends `PageSlotsBase` and accepts every member of it. A page that is not migrated yet is listed with a reason in `test/page-slots.exempt.json`; the list only shrinks (an entry whose page now conforms fails the test).

```tsx
<JobsPage
  slots={{
    BeforeContent: () => <Alert severity="info">Queue maintenance tonight.</Alert>,
    Columns: (base) => [...base, ownerColumn],
    RowActions: ({ row }) => <OpenInTracker jobId={row.id} />,
  }}
/>
```

Recipe: [docs/EXTENDING.md](../../../../docs/EXTENDING.md#add-a-slot-to-a-packaged-page).

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `PlatformHostProvider` | option | `PlatformHostProvider(props: { host: PlatformWebHost; children: ReactNode }): ReactElement` | Mount the app's host once, inside the auth provider, around the shell | experimental | [example](../../../../apps/web/src/platform/platformHost.tsx) |
| `PlatformWebHost.extensions` | option | `extensions?: Readonly<Record<string \| symbol, unknown>>` | Supply the ports an installed extension package declares for itself (the app's router, a feature flag source), keyed by the key the package exports | experimental | [example](../../../../apps/web/src/platform-extensions/core/transcripts-port.example.tsx) |
| `usePlatformPort` | option | `usePlatformPort<T>(key: string \| symbol): T` | Read a port the app supplied from a package's own component; throws, naming the key, when it is missing | experimental | [example](../../../../apps/web/src/platform-extensions/core/transcripts-port.example.tsx) |
| `useOptionalPlatformPort` | option | `useOptionalPlatformPort<T>(key: string \| symbol): T \| undefined` | Read a port that is genuinely optional (`undefined` when missing or outside the provider) | experimental | [example](../../../../apps/web/src/__tests__/examples/core/platform-port.test.tsx) |
| `PlatformSettingsPage` | component | `{ id; card: { title; description; path; permission?; feature? }; Icon; Page }` | Turn a packaged page into one registry card and one route of the app | experimental | [example](../../../../apps/web/src/config/adminSections.tsx) |
| `PlatformHttpClientOptions` | option | `{ baseUrl: string; refreshLockName: string; onErrorResponse?(status, body): void }` | Bind the browser transport to the app's API base, its refresh lock name and its own error-response handling | experimental | [example](../../../../apps/web/src/services/api.ts) |
| `createPlatformApiClient` | option | `createPlatformApiClient(http: PlatformHttpClient, options?: { postSse? }): PlatformApiClient` | Hand the packaged pages the app's one HTTP client as their transport (build it once, at module scope) | experimental | [example](../../../../apps/web/src/platform/platformHost.tsx) |
| `PageSlotsBase` | slot | `{ Header?: PageSlot<PageHeaderSlotProps>; BeforeContent?; Sections?: PageSlot<{ position: 'top' \| 'bottom' }>; AfterContent? }` | Add a banner or a section to a packaged page, or replace its header, without a fork; the `slots` prop of every packaged page extends it | experimental | [example](../../../../apps/web/src/platform-extensions/db-backup/RestoreDrillSection.example.tsx) |
| `TableSlots` | slot | `{ Columns?: (base: Column[]) => Column[]; RowActions?: PageSlot<{ row }>; DetailPanel?: PageSlot<{ row }>; Toolbar? }` | Add a column, a per-row action, a detail view or toolbar controls to the table of a packaged page | experimental | [example](../../../../apps/web/src/platform-extensions/jobs/WaitedColumn.example.tsx) |

Supporting exports, all `@stability experimental` except `ApiError` (`stable`): `PageSlot`, `PageHeaderSlotProps`, `PageSectionsSlotProps`, `SlotTableColumn`, `useTableSlotColumns` (applies the table slots to a page's columns), `SLOT_ROW_ACTIONS_COLUMN_ID`, `SLOT_DETAIL_PANEL_COLUMN_ID`, `connectSse` (reconnecting `GET` event stream with a bearer header, backoff and a 401 renewal; `SseOptions`, `SseConnection`, `SseState`), `postSse` (one `POST`ed request, one streamed answer, no reconnect, one 401 retry, `ApiError` on a non-2xx handed first to `onErrorResponse?`; `PostSseOptions`, `PostSseErrorBody`), `SseParser` and `SseFrame` (the incremental framing parser), `PlatformHttpClient` (options `PlatformHttpClientOptions`: `baseUrl`, `refreshLockName`, `onErrorResponse?`; per-request `PlatformHttpRequestOptions`: `skipAuth`, `responseType`), `ApiError`, `PlatformHttpBlobWithHeaders`, `PlatformHttpErrorBody`, `SessionExpiredListener`, `PlatformWebHost`, `PlatformApiClient`, `PlatformApiError`, `PlatformBlobResponse`, `isPlatformApiError`, `PlatformViewer`, `usePlatformHost` (throws outside the provider), `usePlatformApi`, `usePlatformViewer`, `useOptionalPlatformHost` (`null` outside the provider), `PlatformApiClientOptions`, `toPlatformApiError` (an `ApiError` as a `PlatformApiError`, anything else unchanged), `toHttpRequestOptions` (`PlatformRequestOptions` as the client's request options).

## Data

None. The browser holds no data model; packaged pages read and write through the API.

## Permissions and settings

None declared. `PlatformViewer.hasPermission` answers with the exact permission strings the API enforces; a descriptor's `card.permission` must be the exact string its packaged controller enforces.

## UI

No page of its own. It defines how packaged pages are hosted (`PlatformHostProvider`) and registered (`PlatformSettingsPage`).

## Infra

None. No environment variable and no deployment configuration.

## Observability

None. Nothing is logged or measured; errors surface to the page that made the call.

## Security notes

Authorization stays in the API: `hasPermission` decides what a page shows, never what the server allows, and a packaged page never gates its own route. The transport is the app's, so tokens never pass through packaged code. Pages never hold an API key and never call an AI provider from the browser.

## Conformance suite

None of its own. `apps/web/src/__tests__/config/platformPages.test.ts` in the reference app checks the registration rules for every packaged page it binds; the package's `test/core/` pins the provider and the error guard.

## Upgrade notes

PP-14.23: the packaged-page slot contract (`PageSlotsBase`, `TableSlots`, `PageSlot`, `useTableSlotColumns`) is new and additive. The Jobs, Job Insights, Worker Nodes, Database Backup and Doctor pages take it ([Page slots](#page-slots)); the other packaged pages are listed in `test/page-slots.exempt.json` until the stories that migrate them land. One behaviour change on a page that already had a slot: the database backup page renders `slots.Sections` at both ends (`position: 'top'` and `'bottom'`) instead of once at the bottom, so a `Sections` component written for the old page returns `null` for `position === 'top'`.

PP-14.14: additive. `PlatformWebHost.extensions` (an optional record of ports an extension package declares), `usePlatformPort<T>(key)` and `useOptionalPlatformPort<T>(key)`; `createTestPlatformHost({ extensions })` of `@marinoscar/platform-web/testing` fills it. An app that sets nothing is unchanged.

#900: the Server-Sent Events client (`SseParser`, `connectSse`, `postSse`) moved here from the reference app's `services/sse.ts` (`core/http/sse.ts`), behaviour unchanged except that `postSse` no longer knows about maintenance mode: it hands every non-2xx status and JSON body to the new optional `onErrorResponse` (the app passes its maintenance recogniser, as for `PlatformHttpClient`). Bind `postSse` to the transport port's `postSse` and `connectSse` to `configureNotificationsWeb({ connectSse })`.

#868: `createPlatformApiClient(http, { postSse? })`, `toPlatformApiError` and `toHttpRequestOptions` moved here from the reference app's `platform/platformHost.tsx`. Replace a hand-written `PlatformApiClient` over a `PlatformHttpClient` with one call; behaviour is unchanged (the error mapping, `If-Match`, extra headers first, `getBlob`/`postBlob` as `blobWithHeaders`).

#727: `PlatformHttpClient` and `ApiError` moved here from the reference app's `services/api.ts`. An app keeps one instance (`new PlatformHttpClient({ baseUrl, refreshLockName, onErrorResponse })`, or a subclass that fixes them, as `apps/web/src/services/api.ts` does) and passes it to the identity slice's `AuthProvider`; behaviour is unchanged.

#772: `PlatformApiClient.getBlob` (optional) for file downloads. An app transport without it keeps working; only the Doctor's "Download support bundle" reports that it cannot download. First release: #696.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `usePlatformHost: no PlatformHostProvider above this component` | The page renders outside the provider. Mount `PlatformHostProvider` around the shell (and in the app's test wrapper). |
| `usePlatformPort: the host has no extension port <key>` | An extension package needs a port the app did not supply. Add it to the host's `extensions` under the key the package exports (and in the app's test wrapper). |
| A packaged page refetches on every render | The host's `api` changes identity. Make it a module-level constant and memoise the host. |
| A 403 shows as a generic error | The app's adapter rethrows its own error class. Map it onto `{ status, message, code? }`. |

## Links

- Spec: [platform-packages.md](../../../../docs/specs/platform-packages.md), "UI extensibility" and "The Extension Contract".
- The API host ports: [platform-api core README](../../../platform-api/src/core/README.md#host-ports).
- Test doubles: [testing README](../testing/README.md).
- Package README: [platform-web](../../README.md).
