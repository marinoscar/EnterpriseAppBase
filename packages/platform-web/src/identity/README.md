# @marinoscar/platform-web/identity

`@marinoscar/platform-web/identity`: the browser side of the identity slice (issue #727, PP-6.6), in two entry points. `/identity/headless` holds the behaviour without markup: the auth context (`AuthProvider`, `useAuth`), the permission hook and the route guards (`RequireAuth`, `RequirePermission`, `RequireMultiOrg`), the identity API client and its data hooks, the web sign-in provider registry and the device-activation credential logic. `/identity/ui` holds the pages and components built on it: the login page with slots, the sign-in callback and device-activation pages, the organization switcher, the Access Tokens, Users & Allowlist, Organization and Organizations pages, and their registry entries as data. Depends on the `core` slice only (`packages/platform-slices.json`): the session runs through core's `PlatformHttpClient`, the pages call the API through `usePlatformApi()`.

## Purpose and scope

Does: hold the session in the browser (one refresh from the HttpOnly cookie on boot, `GET /auth/me`, sign-in redirect, sign-out, organization switch, the "session expired" signal), answer permission questions for visibility, guard routes for reachability, and render the identity pages "packages own behaviour, apps own appearance": the app's MUI theme styles them, `slots` replace parts of the login page, and the identity adapters hand in the app's spinner, its table and, optionally, its own identity client.

Does not: decide anything. Every permission is enforced by the API (`@marinoscar/platform-api/identity`); `usePermissions` and the guards only hide controls and routes. It does not create a theme, own the app's registries or routes (the app declares every card in `ADMIN_SECTIONS` / `USER_SETTINGS_SECTIONS` and every route in its router, CLAUDE.md Settings UI Pattern), import app context, layout or navigation, ship a data table (the app's comes in through the adapters; a plain MUI table is the fallback), or know the product's name (`IdentityWebAdapters.appName`). The wire constants (`AUTH_ERROR_CODES`, the PAT and org enums) come from `@marinoscar/platform-contract/identity` ([contract slice README](../../../platform-contract/src/identity/README.md)).

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { AuthProvider, useAuth, RequireAuth, RequirePermission } from '@marinoscar/platform-web/identity/headless';
import { LoginPage, UsersPage, identityAdminSections } from '@marinoscar/platform-web/identity/ui';
```

`/identity/headless` needs `react` and `react-router-dom` (the provider and guards navigate). `/identity/ui` also needs `@mui/material`, `@mui/icons-material` and `@emotion/*`. Both depend on `@marinoscar/platform-contract` (installed with this package) for constants and types only; `zod` is not bundled.

## Quick start

The reference app binds the slice in four places:

```tsx
// apps/web/src/services/api.ts: the one transport (core's PlatformHttpClient)
export const api = new ApiService(); // baseUrl, refreshLockName, maintenance hook

// apps/web/src/App.tsx: the session and the adapters around the routes
<AuthProvider client={api} onBeforeLogout={removePushSubscription}>
  <IdentityWebAdaptersProvider adapters={appIdentityAdapters}>
    <AppRoutes />
  </IdentityWebAdaptersProvider>
</AuthProvider>

// routes: the guards, and the packaged pages behind the cards' permissions
<Route element={<RequireAuth loading={<LoadingSpinner fullScreen />} />}> ... </Route>
<Route path="/admin/settings/users" element={
  <RequirePermission permission="users:read" fallback={<Navigate to="/" replace />}><UsersPage /></RequirePermission>
} />

// apps/web/src/config/adminSections.tsx: the cards, as data, where they were
{ label: 'Access', cards: [...identityAdminSections.access] },
```

`PlatformHostProvider` (from `/core`) must be mounted above the signed-in pages; the reference app's `AppPlatformHostProvider` wraps the shell.

## Configuration

`AuthProvider` props:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `client` | `AuthSessionClient` | required | The app's HTTP client (core's `PlatformHttpClient` satisfies it). Keep its identity stable. |
| `onBeforeLogout` | `() => Promise<unknown>` | none | Work that needs the access token before `POST /auth/logout` (the reference app drops the push subscription). An error is logged; sign-out continues. |
| `loginPath` | `string` | `'/login'` | Where sign-out lands. |
| `callbackPath` | `string` | `'/auth/callback'` | The route that skips the boot-time probe (it sets the token from the URL). |

`IdentityWebAdaptersProvider` `adapters` (`IdentityWebAdapters`, all optional, a module constant):

| Option | Type | Default | Meaning |
|---|---|---|---|
| `appName` | `string` | `'this app'` | The product name the sign-in error copy names. |
| `Spinner` | `ComponentType<{ fullScreen? }>` | an MUI `CircularProgress` | Loading states. |
| `DataTable` | `IdentityDataTableComponent` | a plain MUI table | The table the users, allowlist and token lists render through. The props are a subset of the reference app's `DataTable`, which is assignable without a cast. |
| `api` | `IdentityApi` | `createIdentityApi(usePlatformApi())` | The identity calls; the reference app binds its existing service functions. |

`RequireAuth`: `loading` (shown during the probe), `loginPath` (default `'/login'`), `children` (default `<Outlet />`). `RequirePermission`: `permission`, `permissions` + `requireAll`, `role`, `roles`, `fallback`. `RequireMultiOrg`: `fallback` (default a replace-redirect to `/`). `LoginPage`: `slots` (see the catalog). `AuthCallbackPage`: `provider` (default `'google'`, restarted by the error screen's buttons).

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `AuthProvider` | component | `AuthProvider(props: { client; onBeforeLogout?; loginPath?; callbackPath?; children }): ReactElement` | Hold the session for the routed tree | stable | [example](../../../../apps/web/src/App.tsx) |
| `useAuth` | hook | `useAuth(): AuthContextValue` | Read the user, the providers and the session actions | stable | [example](../../../../apps/web/src/platform/platformHost.tsx) |
| `usePermissions` | hook | `usePermissions(): UsePermissionsReturn` | Hide or disable controls the viewer cannot use | stable | [example](../../../../apps/web/src/platform/platformHost.tsx) |
| `RequireAuth` | component | `RequireAuth(props: { loading?; loginPath?; children? }): ReactElement` | Gate routes on a signed-in user | stable | [example](../../../../apps/web/src/components/common/ProtectedRoute.tsx) |
| `RequirePermission` | component | `RequirePermission(props: { permission?; permissions?; requireAll?; role?; roles?; children; fallback? }): ReactElement` | Gate a route or content on the exact permission the API enforces | stable | [example](../../../../apps/web/src/App.tsx) |
| `RequireMultiOrg` | component | `RequireMultiOrg(props: { children; fallback? }): ReactElement` | Gate an org-administration route on multi-org mode | stable | [example](../../../../apps/web/src/App.tsx) |
| `useOrgsFeature` | hook | `useOrgsFeature(): boolean` | Feed the `orgs` feature flag to settings hubs and chrome | stable | [example](../../../../apps/web/src/hooks/useSettingsFeatures.ts) |
| `registerAuthProvider` | registry | `registerAuthProvider(descriptor: { id; label; Icon?; color?; textColor?; border? }): () => void` | Give a sign-in provider the API enables its own button, or restyle a built-in one | experimental | [example](../../../../apps/web/src/identity/authProviders.ts) |
| `IdentityWebAdapters` | option | `{ appName?; Spinner?; DataTable?; api? }` | Hand the identity pages the app's name, spinner, table and client | experimental | [example](../../../../apps/web/src/platform/identityAdapters.ts) |
| `IdentityWebAdaptersProvider` | component | `IdentityWebAdaptersProvider(props: { adapters; children }): ReactElement` | Mount the adapters once, around the routes | experimental | [example](../../../../apps/web/src/App.tsx) |
| `IdentityApi` | option | `{ getUsers; updateUser; ...; renameOrganization }` | Route the identity calls through the app's own client | experimental | [example](../../../../apps/web/src/platform/identityAdapters.ts) |
| `useUsers` | hook | `useUsers(api?: IdentityApi): UseUsersReturn` | Build another view of the user list | stable | [example](../../../../apps/web/src/hooks/useUsers.ts) |
| `useAllowlist` | hook | `useAllowlist(api?: IdentityApi): UseAllowlistReturn` | Build another view of the allowlist | stable | [example](../../../../apps/web/src/hooks/useAllowlist.ts) |
| `usePersonalAccessTokens` | hook | `usePersonalAccessTokens(api?: IdentityApi): UsePersonalAccessTokensReturn` | Build another view of the caller's tokens | stable | [example](../../../../apps/web/src/hooks/usePersonalAccessTokens.ts) |
| `useOrgMembers` | hook | `useOrgMembers(api?: IdentityApi): UseOrgMembersReturn` | Build another view of the current organization's members | stable | [example](../../../../apps/web/src/hooks/useOrgMembers.ts) |
| `useOrgInvites` | hook | `useOrgInvites(api?: IdentityApi): UseOrgInvitesReturn` | Build another view of the current organization's invitations | stable | [example](../../../../apps/web/src/hooks/useOrgInvites.ts) |
| `useOrganizations` | hook | `useOrganizations(api?: IdentityApi): UseOrganizationsReturn` | Build another view of the deployment's organizations | stable | [example](../../../../apps/web/src/hooks/useOrganizations.ts) |
| `LoginPage` | slot | `LoginPage(props?: { slots?: { Logo?; Title?; Footer?; ProviderButton? } }): ReactElement` | Keep the sign-in flow and replace its logo, heading, footer or buttons | experimental | [example](../../../../apps/web/src/identity/LoginPage.tsx) |
| `AuthCallbackPage` | component | `AuthCallbackPage(props?: { provider? }): ReactElement` | Render the `/auth/callback` route | stable | [example](../../../../apps/web/src/pages/AuthCallbackPage.tsx) |
| `ActivateDevicePage` | component | `ActivateDevicePage(): ReactElement` | Render the `/activate` device-flow route | stable | [example](../../../../apps/web/src/pages/ActivateDevicePage.tsx) |
| `OrgSwitcher` | component | `OrgSwitcher(): ReactElement \| null` | Place the organization switcher in the app bar | stable | [example](../../../../apps/web/src/components/navigation/AppBar.tsx) |
| `UserTokensPage` | component | `UserTokensPage(): ReactElement` | Render the `/settings/tokens` route | stable | [example](../../../../apps/web/src/pages/UserTokensPage.tsx) |
| `UsersPage` | component | `UsersPage(): ReactElement` | Render the `/admin/settings/users` route (Users and Allowlist tabs) | stable | [example](../../../../apps/web/src/pages/Admin/UsersPage.tsx) |
| `OrganizationPage` | component | `OrganizationPage(): ReactElement` | Render the `/admin/settings/organization` route (Members and Invites tabs) | stable | [example](../../../../apps/web/src/pages/Admin/OrganizationPage.tsx) |
| `OrganizationsPage` | component | `OrganizationsPage(): ReactElement` | Render the `/admin/settings/organizations` route | stable | [example](../../../../apps/web/src/pages/Admin/OrganizationsPage.tsx) |
| `identityAdminSections` | component | `{ access: IdentitySettingsCard[]; organizations: IdentitySettingsCard[] }` | Spread the identity admin cards into the app's `ADMIN_SECTIONS` | experimental | [example](../../../../apps/web/src/config/adminSections.tsx) |
| `identityUserSettingsSections` | component | `{ security: IdentitySettingsCard[] }` | Spread the Access Tokens card into the app's `USER_SETTINGS_SECTIONS` | experimental | [example](../../../../apps/web/src/config/userSettingsSections.tsx) |

Supporting exports. `/identity/headless`: `AuthContext`, `useOptionalAuth`, the types `AuthContextValue`, `AuthUser`, `AuthRole`, `AuthProviderInfo`, `AuthSessionClient`, `LoginOptions`, `OrgSummary`, `OrgMembershipSummary`, the props types of the guards and the provider, `UsePermissionsReturn`, `getRegisteredAuthProvider`, `listRegisteredAuthProviders`, `AuthProviderDescriptor`, `createIdentityApi`, `useIdentityApi`, `useIdentityWebAdapters`, `ORG_ROLES` and the row, page and query types of the API client, the `Use*Return` types, the table types (`IdentityDataTableComponent`, `IdentityDataTableProps`, `IdentityTableColumn`, `IdentityTableRowAction`, `IdentityTableFilter`, `IdentityTableSortState` and their unions), and the device-activation logic (`readCredentialKind`, `sanitizeDeviceText`, `DEVICE_PAT_APPROX_DAYS`, the display bounds, `DeviceCredentialKind`). `/identity/ui`: `LoginPageProps`, `LoginPageSlots`, `AuthCallbackPageProps`, `SignInErrorView` and its props, the sign-in copy (`createSignInErrorContent(appName)`, `SIGN_IN_ERROR_CODES`, `DEFAULT_SIGN_IN_ERROR_CODE`, `resolveSignInErrorCode` and the types), `OAuthButton` and its props, `BUILT_IN_AUTH_PROVIDERS`, the list components `PersonalAccessTokens`, `UserList`, `AllowlistTable`, `OrgMembersPanel`, `OrgInvitesPanel`, `buildUserColumns`, and `IdentitySettingsCard`.

### Slots and theme

`LoginPage` slots: `Logo` (above the heading, nothing by default), `Title` (the "Welcome" heading block), `Footer` (the terms caption), `ProviderButton` (one provider's button; receives `{ provider, onClick }`). Everything else is styled by the app's theme: the pages use palette roles (`background.default`, `info`, `warning`, `error`), `theme.shadows[10]` and typography variants, never a hard-coded theme. The provider buttons keep each provider's brand colours (registered per provider).

## Data

None. The browser holds the session in memory (the access token in the client, the user in context) and the sign-in return URL in `sessionStorage` (`auth_return_url`); every record is read and written through the API.

## Permissions and settings

The registry entries carry the exact strings the identity controllers enforce: `Users & Allowlist` `users:read` (`users.controller.ts`; the Allowlist tab gates `allowlist:read` inside the page), `Organization` `org_members:read` (`org-members.controller.ts`, an org permission; the Invites tab gates `org_invites:read`), `Organizations` `organizations:read` (`organizations-admin.controller.ts`, a system permission); both organization cards carry `feature: 'orgs'`. `Access Tokens` has no permission. Writes are gated inside the pages (`users:write`, `rbac:manage`, `allowlist:write`, `org_members:write`, `org_invites:write`, `organizations:write`), never by a second card.

## UI

Routes the app mounts: `/login` (`LoginPage`), `/auth/callback` (`AuthCallbackPage`), `/activate` (`ActivateDevicePage`, full screen, signed in), `/settings/tokens` (`UserTokensPage`), `/admin/settings/users` (`UsersPage`: Users and Allowlist, the one legitimate parallel-tab page), `/admin/settings/organization` (`OrganizationPage`: Members and Invites), `/admin/settings/organizations` (`OrganizationsPage`). Component: `OrgSwitcher` for the app bar. Registry entries: `identityAdminSections.access`, `identityAdminSections.organizations`, `identityUserSettingsSections.security`. Layouts are mobile-first (the Organization pages tighten padding below `sm`); the lists follow whatever breakpoints the app's table has.

## Infra

None. No environment variable is read in the browser; the API base and the refresh lock name are the app's options to core's `PlatformHttpClient`.

## Observability

None. The slice logs only to the browser console on a failed provider list, boot probe or sign-out; the API's logs, metrics (`authLogin` outcomes) and spans cover sign-in.

## Security notes

Authorization stays in the API: the guards and `usePermissions` decide what is shown, never what is allowed. The access token lives only in the app's HTTP client memory, sent as `Authorization: Bearer`; the refresh token stays in the HttpOnly cookie and refreshes are serialised across pages (core). The callback page never renders the `?error=` value: it is narrowed to the closed `AUTH_ERROR_CODES` set, and an unknown value shows the generic failure. The device-activation page treats every `clientInfo` field as attacker-chosen (`readCredentialKind`, `sanitizeDeviceText`) and says plainly when an approval mints a 90-day token. A PAT's raw value is shown once and never stored in the browser.

## Conformance suite

None in the web package. The API side runs the identity conformance suite (`@marinoscar/platform-api/identity/testing`). The reference app's `apps/web/src/__tests__/config/` registry tests check the identity cards (one declaration, exact permissions, features) and the package's `test/identity/` covers the provider, guards, client, hooks, registry, pages, slots and the table seam.

## Upgrade notes

First packaged release (#727, PP-6.6 parts 3 and 4). Moving from the app's own copies: mount `AuthProvider` from `/identity/headless` with your transport as `client` and your logout clean-up as `onBeforeLogout`; mount `IdentityWebAdaptersProvider` with your product name, spinner and table; spread `identityAdminSections` / `identityUserSettingsSections` where your literal cards were; route to the packaged pages. Behaviour, texts and test ids are unchanged. `ProtectedRoute` is `RequireAuth` with the spinner passed as `loading`. The sign-in copy is `createSignInErrorContent(appName)`, no longer a constant naming the app.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `useAuth must be used within an AuthProvider` | Mount `AuthProvider` inside the router, above every route. |
| `useIdentityApi: no identity client` | A page or hook renders outside `PlatformHostProvider` and the adapters carry no `api`. Mount the host (or pass `adapters.api`). |
| The lists look different from the rest of the app | No `DataTable` adapter: the plain MUI fallback renders. Hand the app's table in `IdentityWebAdapters.DataTable`. |
| The sign-in error says "this app" | `IdentityWebAdapters.appName` is not set. |
| A provider shows a generic blue button | Register its look with `registerAuthProvider` before the first render. |

## Links

- Spec: [platform-packages.md](../../../../docs/specs/platform-packages.md), "UI extensibility".
- The API side: [`@marinoscar/platform-api/identity`](../../../platform-api/src/identity/README.md); the wire shapes: [`@marinoscar/platform-contract/identity`](../../../platform-contract/src/identity/README.md).
- Hosting, the HTTP client and the settings-page descriptor: [core README](../core/README.md).
- Package README: [platform-web](../../README.md).
