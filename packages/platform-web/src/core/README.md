# @marinoscar/platform-web/core

`@marinoscar/platform-web/core`: the **web host ports** every packaged page reuses (issue #696). A packaged page reaches the app through one context, never by importing app code: the app's transport, the signed-in viewer and optional formatting hooks. It also defines the settings-page descriptor an app turns into a registry card and a route. No other slice of the package is needed (`packages/platform-slices.json`: `"core": []`).

## Purpose and scope

Does: `PlatformApiClient` (the app's transport, as an interface) and `PlatformApiError` with `isPlatformApiError`; `PlatformViewer` (who is looking: user id, `hasPermission`, `isFeatureEnabled`); `PlatformWebHost` and `PlatformHostProvider` with `usePlatformHost`, `usePlatformApi`, `usePlatformViewer` and `useOptionalPlatformHost`; `PlatformSettingsPage`, the descriptor of a packaged admin or settings page; and `PlatformHttpClient` with `ApiError` (issue #727): the browser transport moved from the reference app's `services/api.ts`, which holds the access token, refreshes once on a 401 and retries, serialises refreshes across pages with a Web Lock, and signals a lost session. The identity slice's `AuthProvider` drives sessions through it.

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
export const appPlatformApi: PlatformApiClient = Object.freeze({
  get: (path) => mapped(() => api.get(path)),            // ApiError -> PlatformApiError
  // post, put, patch (ifMatch -> If-Match), delete
});

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
| `children` | `ReactNode` | required | The routed tree that may render packaged pages. |

### Host ports

| Port | What it is for | How the reference app binds it |
|---|---|---|
| `PlatformApiClient` | Every API call of a packaged page | The app's `services/api.ts` (auth header, token refresh, maintenance handling stay in the app); `ApiError` mapped onto `PlatformApiError`; a network failure passes through and is *not* a `PlatformApiError`. The optional `getBlob(path)` (#772) returns a download's raw body and headers (`PlatformBlobResponse`); the reference app maps it onto `responseType: 'blobWithHeaders'` |
| `PlatformViewer` | Permission and feature questions a page asks of content (never of reachability: the route gate does that) | `usePermissions().hasPermission`, the auth context's user id, the shell's AI and telemetry flags |
| `formatRelativeTime` | Consistent dates | `utils/relativeTime` |

Every later packaged page reuses these ports unchanged.

### Registering a packaged page (Settings UI Pattern)

The app stays the owner of `ADMIN_SECTIONS` / `USER_SETTINGS_SECTIONS` and of its routes. For each packaged page it:

1. appends a card `{ ...page.card, Icon: page.Icon }` to the right section (append-only rule);
2. adds one route `path={page.card.path}` whose element is `<RequirePermission permission={page.card.permission}>` around the page (plus `RequireAiEnabled` / `RequireTelemetryEnabled` when `card.feature` says so);
3. lists the page in `apps/web/src/__tests__/config/platformPages.test.ts`, which asserts one card, one route, and that the card's `permission` is the exact string the packaged API controller enforces (rule 3).

`PlatformSettingsPage<never>['card']` (a page that is never feature-gated) is assignable to the app's `SettingsCardDef` minus `Icon`; that test asserts it too.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `PlatformHostProvider` | option | `PlatformHostProvider(props: { host: PlatformWebHost; children: ReactNode }): ReactElement` | Mount the app's host once, inside the auth provider, around the shell | experimental | [example](../../../../apps/web/src/platform/platformHost.tsx) |
| `PlatformSettingsPage` | component | `{ id; card: { title; description; path; permission?; feature? }; Icon; Page }` | Turn a packaged page into one registry card and one route of the app | experimental | [example](../../../../apps/web/src/config/adminSections.tsx) |
| `PlatformHttpClientOptions` | option | `{ baseUrl: string; refreshLockName: string; onErrorResponse?(status, body): void }` | Bind the browser transport to the app's API base, its refresh lock name and its own error-response handling | experimental | [example](../../../../apps/web/src/services/api.ts) |

Supporting exports, all `@stability experimental` except `ApiError` (`stable`): `PlatformHttpClient` (options `PlatformHttpClientOptions`: `baseUrl`, `refreshLockName`, `onErrorResponse?`; per-request `PlatformHttpRequestOptions`: `skipAuth`, `responseType`), `ApiError`, `PlatformHttpBlobWithHeaders`, `PlatformHttpErrorBody`, `SessionExpiredListener`, `PlatformWebHost`, `PlatformApiClient`, `PlatformApiError`, `PlatformBlobResponse`, `isPlatformApiError`, `PlatformViewer`, `usePlatformHost` (throws outside the provider), `usePlatformApi`, `usePlatformViewer`, `useOptionalPlatformHost` (`null` outside the provider).

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

#727: `PlatformHttpClient` and `ApiError` moved here from the reference app's `services/api.ts`. An app keeps one instance (`new PlatformHttpClient({ baseUrl, refreshLockName, onErrorResponse })`, or a subclass that fixes them, as `apps/web/src/services/api.ts` does) and passes it to the identity slice's `AuthProvider`; behaviour is unchanged.

#772: `PlatformApiClient.getBlob` (optional) for file downloads. An app transport without it keeps working; only the Doctor's "Download support bundle" reports that it cannot download. First release: #696.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `usePlatformHost: no PlatformHostProvider above this component` | The page renders outside the provider. Mount `PlatformHostProvider` around the shell (and in the app's test wrapper). |
| A packaged page refetches on every render | The host's `api` changes identity. Make it a module-level constant and memoise the host. |
| A 403 shows as a generic error | The app's adapter rethrows its own error class. Map it onto `{ status, message, code? }`. |

## Links

- Spec: [platform-packages.md](../../../../docs/specs/platform-packages.md), "UI extensibility" and "The Extension Contract".
- The API host ports: [platform-api core README](../../../platform-api/src/core/README.md#host-ports).
- Test doubles: [testing README](../testing/README.md).
- Package README: [platform-web](../../README.md).
