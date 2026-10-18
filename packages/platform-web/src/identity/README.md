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
| `api` | `IdentityApi` | `createIdentityApi(usePlatformApi())` | The identity calls. The reference app binds `createIdentityApi(appPlatformApi)` here, because the login and `/activate` pages render outside the platform host. |

`RequireAuth`: `loading` (shown during the probe), `loginPath` (default `'/login'`), `children` (default `<Outlet />`). `RequirePermission`: `permission`, `permissions` + `requireAll`, `role`, `roles`, `fallback`. `RequireMultiOrg`: `fallback` (default a replace-redirect to `/`). `LoginPage`: `slots` (see the catalog). `AuthCallbackPage`: `provider` (restarted by the error screen's buttons; default: a `:provider` route segment, then the provider the current sign-in started with, then `'google'`).

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `AuthProvider` | component | `AuthProvider(props: { client; onBeforeLogout?; loginPath?; callbackPath?; children }): ReactElement` | Hold the session for the routed tree | stable | [example](../../../../apps/web/src/App.tsx) |
| `useAuth` | hook | `useAuth(): AuthContextValue` | Read the user, the providers and the session actions | stable | [example](../../../../apps/web/src/platform/platformHost.tsx) |
| `usePermissions` | hook | `usePermissions(): UsePermissionsReturn` | Hide or disable controls the viewer cannot use | stable | [example](../../../../apps/web/src/platform/platformHost.tsx) |
| `RequireAuth` | component | `RequireAuth(props: { loading?; loginPath?; children? }): ReactElement` | Gate routes on a signed-in user | stable | [example](../../../../apps/web/src/App.tsx) |
| `RequirePermission` | component | `RequirePermission(props: { permission?; permissions?; requireAll?; role?; roles?; children; fallback? }): ReactElement` | Gate a route or content on the exact permission the API enforces | stable | [example](../../../../apps/web/src/App.tsx) |
| `RequireMultiOrg` | component | `RequireMultiOrg(props: { children; fallback? }): ReactElement` | Gate an org-administration route on multi-org mode | stable | [example](../../../../apps/web/src/App.tsx) |
| `useOrgsFeature` | hook | `useOrgsFeature(): boolean` | Feed the `orgs` feature flag to settings hubs and chrome | stable | [example](../../../../apps/web/src/hooks/useSettingsFeatures.ts) |
| `registerAuthProvider` | registry | `registerAuthProvider(descriptor: { id; label; Icon?; color?; textColor?; border?; start? }): () => void` | Give a sign-in provider the API enables its own button, restyle a built-in one, or (with `start`) supply the function `login(id)` runs for a provider the API lists with `mode: 'custom'` | experimental | [example](../../../../apps/web/src/identity/authProviders.ts) |
| `IdentityWebAdapters` | option | `{ appName?; Spinner?; DataTable?; api? }` | Hand the identity pages the app's name, spinner, table and client | experimental | [example](../../../../apps/web/src/platform/identityAdapters.ts) |
| `IdentityWebAdaptersProvider` | component | `IdentityWebAdaptersProvider(props: { adapters; children }): ReactElement` | Mount the adapters once, around the routes | experimental | [example](../../../../apps/web/src/App.tsx) |
| `IdentityApi` | option | `{ getUsers; updateUser; ...; renameOrganization }` | Route the identity calls through the app's own client | experimental | [example](../../../../apps/web/src/platform/identityAdapters.ts) |
| `useUsers` | hook | `useUsers(api?: IdentityApi): UseUsersReturn` | Build another view of the user list | stable | [example](../../../../apps/web/src/identity/dataHookExamples.tsx) |
| `useAllowlist` | hook | `useAllowlist(api?: IdentityApi): UseAllowlistReturn` | Build another view of the allowlist | stable | [example](../../../../apps/web/src/identity/dataHookExamples.tsx) |
| `usePersonalAccessTokens` | hook | `usePersonalAccessTokens(api?: IdentityApi): UsePersonalAccessTokensReturn` | Build another view of the caller's tokens | stable | [example](../../../../apps/web/src/identity/dataHookExamples.tsx) |
| `useOrgMembers` | hook | `useOrgMembers(api?: IdentityApi): UseOrgMembersReturn` | Build another view of the current organization's members | stable | [example](../../../../apps/web/src/identity/dataHookExamples.tsx) |
| `useOrgInvites` | hook | `useOrgInvites(api?: IdentityApi): UseOrgInvitesReturn` | Build another view of the current organization's invitations | stable | [example](../../../../apps/web/src/identity/dataHookExamples.tsx) |
| `useOrganizations` | hook | `useOrganizations(api?: IdentityApi): UseOrganizationsReturn` | Build another view of the deployment's organizations | stable | [example](../../../../apps/web/src/identity/dataHookExamples.tsx) |
| `useRoles` | hook | `useRoles(scope?: 'system' \| 'org', options?: { enabled?; api? }): UseRolesReturn` | Read the roles the API says exist (`GET /api/roles`): `assignable` for a role picker, `labelOf(id)` for a display name; the invite, member and Manage roles dialogs use it, so an app role shows up with no web edit | experimental | [example](../../../../apps/web/src/__tests__/examples/identity/app-roles.test.tsx) |
| `LoginPage` | slot | `LoginPage(props?: { slots?: PageSlotsBase & { Logo?; Title?; Footer?; ProviderButton?; BeforeProviders?; AfterProviders? } }): ReactElement` | Keep the sign-in flow and replace its logo, heading, footer or buttons, or add a control (an SSO field, a popup button) above or below the provider buttons, or a banner or section (the page-slot contract) | experimental | [example](../../../../apps/web/src/platform-extensions/identity/company-sso.tsx) |
| `AuthCallbackPage` | component | `AuthCallbackPage(props?: { provider?; slots?: AuthCallbackPageSlots }): ReactElement` | Render the `/auth/callback` route | stable | [example](../../../../apps/web/src/App.tsx) |
| `AuthCallbackPageSlots` | slot | `PageSlotsBase` | Add a notice or replace the "Completing authentication..." line on the screen shown while the sign-in completes | experimental | [example](../../../../apps/web/src/App.tsx) |
| `ActivateDevicePage` | component | `ActivateDevicePage(props?: { slots?: ActivateDevicePageSlots }): ReactElement` | Render the `/activate` device-flow route | stable | [example](../../../../apps/web/src/App.tsx) |
| `ActivateDevicePageSlots` | slot | `PageSlotsBase` | Add a notice or a section to the device-activation card, or replace its heading | experimental | [example](../../../../apps/web/src/App.tsx) |
| `OrgSwitcher` | component | `OrgSwitcher(): ReactElement \| null` | Place the organization switcher in the app bar | stable | [example](../../../../apps/web/src/components/navigation/AppBar.tsx) |
| `UserTokensPage` | component | `UserTokensPage(props?: { slots?: UserTokensPageSlots }): ReactElement` | Render the `/settings/tokens` route | stable | [example](../../../../apps/web/src/App.tsx) |
| `UserTokensPageSlots` | slot | `PageSlotsBase` | Add a notice or a section to the access tokens page, or replace its header | experimental | [example](../../../../apps/web/src/App.tsx) |
| `UsersPage` | component | `UsersPage(props?: { slots?: UsersPageSlots }): ReactElement` | Render the `/admin/settings/users` route (Users and Allowlist tabs) | stable | [example](../../../../apps/web/src/App.tsx) |
| `UsersPageSlots` | slot | `PageSlotsBase & TableSlots<UserListItem, IdentityTableColumn<UserListItem>> & { Tabs?: readonly UsersPageTab[] }` | Add a banner or a section, a column (read `extensions` of a user-list extension), a per-row action, a detail view or toolbar controls, or append a tab parallel to Users and Allowlist | experimental | [example](../../../../apps/web/src/platform-extensions/identity/TeamColumn.example.tsx) |
| `UserListSlots` | slot | `TableSlots<UserListItem, IdentityTableColumn<UserListItem>>` | Add a column, a per-row action, a detail view or toolbar controls to the user list used outside the Users page | experimental | [example](../../../../apps/web/src/platform-extensions/identity/TeamColumn.example.tsx) |
| `OrganizationPage` | component | `OrganizationPage(props?: { slots?: OrganizationPageSlots }): ReactElement` | Render the `/admin/settings/organization` route (Members and Invites tabs) | stable | [example](../../../../apps/web/src/App.tsx) |
| `OrganizationPageSlots` | slot | `PageSlotsBase & Pick<TableSlots<OrgMember>, 'RowActions' \| 'DetailPanel' \| 'Toolbar'>` | Add a banner or a section, a per-member action, a detail view or toolbar controls to the organization page | experimental | [example](../../../../apps/web/src/App.tsx) |
| `OrgMembersPanelSlots` | slot | `Pick<TableSlots<OrgMember>, 'RowActions' \| 'DetailPanel' \| 'Toolbar'>` | Add a per-member action, a detail view or toolbar controls to the members list used outside the organization page | experimental | [example](../../../../apps/web/src/App.tsx) |
| `OrganizationsPage` | component | `OrganizationsPage(props?: { renderActions?; slots?: OrganizationsPageSlots }): ReactElement` | Render the `/admin/settings/organizations` route | stable | [example](../../../../apps/web/src/App.tsx) |
| `OrganizationsPageSlots` | slot | `PageSlotsBase & Pick<TableSlots<Organization>, 'RowActions' \| 'DetailPanel' \| 'Toolbar'>` | Add a banner or a section, a per-organization action, a detail view or toolbar controls to the organizations page | experimental | [example](../../../../apps/web/src/App.tsx) |
| `useCurrentUserExtension` | hook | `useCurrentUserExtension<T>(id: string): T \| undefined` | Read what the API's current-user extension `id` added to `/auth/me` (`extensions.<id>`) for the signed-in user | experimental | [example](../../../../apps/web/src/platform-extensions/identity/TeamColumn.example.tsx) |
| `identityAdminSections` | component | `{ access: IdentitySettingsCard[]; organizations: IdentitySettingsCard[] }` | Spread the identity admin cards into the app's `ADMIN_SECTIONS` | experimental | [example](../../../../apps/web/src/config/adminSections.tsx) |
| `identityUserSettingsSections` | component | `{ security: IdentitySettingsCard[] }` | Spread the Access Tokens card into the app's `USER_SETTINGS_SECTIONS` | experimental | [example](../../../../apps/web/src/config/userSettingsSections.tsx) |

Supporting exports. `/identity/headless`: `AuthContext`, `useOptionalAuth`, `LocalIdentityProvider`, `createLocalAuthContextValue`, `LocalIdentityInput`, the types `AuthContextValue`, `AuthUser`, `AuthRole`, `AuthProviderInfo`, `AuthSessionClient`, `LoginOptions`, `OrgSummary`, `OrgMembershipSummary`, the props types of the guards and the provider, `UsePermissionsReturn`, `userExtension` (one extension's contribution from a user payload: the signed-in user or a row of the user list), `getRegisteredAuthProvider`, `listRegisteredAuthProviders`, `AuthProviderDescriptor`, `lastAuthProvider`, `rememberAuthProvider`, `validAuthProviderId`, `createIdentityApi`, `useIdentityApi`, `useIdentityWebAdapters`, `ORG_ROLES` (deprecated: the platform's three org roles; no packaged page reads it), `UseRolesOptions`, `UseRolesReturn`, `RoleDescriptor`, `RoleScope` and the row, page and query types of the API client, the `Use*Return` types, the table types (`IdentityDataTableComponent`, `IdentityDataTableProps`, `IdentityTableColumn`, `IdentityTableRowAction`, `IdentityTableFilter`, `IdentityTableSortState` and their unions), and the device-activation logic (`readCredentialKind`, `sanitizeDeviceText`, `DEVICE_PAT_APPROX_DAYS`, the display bounds, `DeviceCredentialKind`). `/identity/ui`: `LoginPageProps`, `LoginPageSlots`, `LoginProvidersSlotProps`, `AuthCallbackPageProps`, `UsersPageProps`, `UsersPageTab`, `UserListProps`, `OrganizationPageProps`, `OrganizationsPageProps`, `OrgMembersPanelProps`, `UserTokensPageProps`, `ActivateDevicePageProps`, `SignInErrorView` and its props, the sign-in copy (`createSignInErrorContent(appName)`, `SIGN_IN_ERROR_CODES`, `DEFAULT_SIGN_IN_ERROR_CODE`, `resolveSignInErrorCode` and the types), `OAuthButton` and its props, `BUILT_IN_AUTH_PROVIDERS`, the list components `PersonalAccessTokens`, `UserList`, `AllowlistTable`, `OrgMembersPanel`, `OrgInvitesPanel` (each takes an optional `roles` from `useRoles('org')`, which `OrganizationPage` reads once and shares), `buildUserColumns(roles?)`, and `IdentitySettingsCard`.

### Local identity (no sign-in host)

A host with one user and no API (KVox Desktop, issue #997) mounts `LocalIdentityProvider` instead of `AuthProvider`. It provides an `AuthContext` value built by `createLocalAuthContextValue`, so the shell surfaces and `useAuth` consumers work without a session, a token or any request.

```tsx
import { LocalIdentityProvider } from '@marinoscar/platform-web/identity/headless';

<PlatformHostProvider host={host}>
  <LocalIdentityProvider userId="local" displayName="Oscar" permissions={LOCAL_PERMISSIONS}>
    <ShellLayout navigation={NAVIGATION} brand="KVox" />
  </LocalIdentityProvider>
</PlatformHostProvider>
```

| `LocalIdentityInput` field | Type | Default | Meaning |
|---|---|---|---|
| `userId` | `string` | required | The one user's id. |
| `displayName` | `string` | `'You'` | Shown in the user menu; its initials are the avatar. |
| `email` | `string \| null` | none | Shown in the user menu when set. |
| `permissions` | `readonly string[]` | required | What `usePermissions().hasPermission` answers `true` for. Pass a stable array. |
| `roles` | `readonly string[]` | `[]` | What `usePermissions().hasRole` answers `true` for. |

The value is always authenticated (`isAuthenticated: true`), lists no sign-in providers (`providers: []`) and sets `mode: 'local'`; `login`, `logout`, `switchOrg` and `setAccessToken` are no-ops that return resolved promises. `AuthContextValue.mode` is a new optional `'server' | 'local'` (absent means `'server'`, which `AuthProvider` sets), so UI can adapt: the shell's `ShellUserMenu` hides sign-out and the organization switcher in `'local'` mode.

`usePermissions()` now resolves its source in this order: the mounted `AuthContext` (`AuthProvider` or `LocalIdentityProvider`), then `PlatformHost.viewer` (`hasPermission`, `userId`), and it throws only when neither is mounted, with a message naming both. A page that sits under a `PlatformHostProvider` alone therefore answers permission questions from the viewer; with an `AuthContext` present the behaviour is what it was. The viewer's and the local identity's permissions are two copies of one list: build both from the same constant.

This is a convenience for display, not authorization: the local host's own server (or nothing) decides what is allowed. `RequireAuth` passes in local mode because the value is authenticated; do not use local mode in a deployment that has an API (use `AuthProvider`).

### Roles

The role choices and labels come from the API, never from a list in the package. `OrganizationPage` reads `GET /api/roles?scope=org` once and hands it to both tabs: the invite dialog and the member role select offer the roles the API marks `assignable`, labelled by the API (`Coach`, not `coach`), and the invitation and member rows label a role by the same list (a raw id when the list does not hold it). A role a member already holds that the caller cannot assign is shown, disabled. `UserList` reads the system roles, and outside multi-organization mode the org roles too (`PUT /api/users/:id/roles` sets the default-organization membership role in single mode), without `org_admin`, which `admin` implies; its Manage roles dialog sends role names (`roleNames`). A list that fails to load leaves the dialogs with nothing to offer rather than a guess, and the API still decides every write. An app registers a role on the API side ([identity API README](../../../platform-api/src/identity/README.md#roles-and-who-may-assign-them)); no web code is needed.

### Page slots

Every packaged identity page takes the packaged-page slot contract (`PageSlotsBase`: `Header`, `BeforeContent`, `Sections` at both ends, `AfterContent`; [core README](../core/README.md#page-slots)), and the pages that draw rows add the table slots. With no slot the markup is exactly what it was (`test/identity/IdentityPages.builtin-dom.test.tsx` pins it against a recording made before the slots).

| Page | Slots | Notes |
|---|---|---|
| `UsersPage` | `PageSlotsBase`, `Columns`, `RowActions`, `DetailPanel`, `Toolbar` (passed to the Users tab's `UserList`), `Tabs` | `Sections` sits outside the tab strip. See [Tabs](#tabs-on-the-users-page). |
| `OrganizationPage` | `PageSlotsBase`, `RowActions`, `DetailPanel`, `Toolbar` (passed to the Members tab) | No `Columns`: the member list is cards that wrap at phone width, not a table. |
| `OrganizationsPage` | `PageSlotsBase`, `RowActions`, `DetailPanel`, `Toolbar` | Also keeps `renderActions` (the user-data slice's offboard button); `RowActions` renders after it. No `Columns`, for the same reason. |
| `UserTokensPage` | `PageSlotsBase` | |
| `ActivateDevicePage` | `PageSlotsBase` | All inside the card; `Header` gets the step's `title` and `description`. |
| `LoginPage` | `PageSlotsBase`, `Logo`, `Title`, `Footer`, `ProviderButton`, `BeforeProviders`, `AfterProviders` | `Header` replaces `Title` (and wins when both are set). |
| `AuthCallbackPage` | `PageSlotsBase` | On the waiting screen only; the error screen has its own copy and buttons. `Header` replaces the "Completing authentication..." line. |

`Columns` of the users table receives `buildUserColumns(roles)` plus the `RowActions` and `DetailPanel` columns; a column reads what a user-list extension added with `userExtension(user, 'id')`. `UserList` and `OrgMembersPanel` accept the same table slots when an app composes them without the page.

### Tabs on the Users page

`UsersPage` keeps its two tabs, Users and Allowlist, and `slots.Tabs` can only APPEND to them: `Tabs: [{ id, label, Panel, permission? }]` (a module constant). That follows the Settings UI Pattern rule 2 ([settings-ui spec](../../../../docs/specs/settings-ui.md)): a tab strip holds PARALLEL content, here another answer to "who may use this application" (a domain allow-list, a pending-approval queue). A new settings page is a card in the app's registry with its own route, never a tab here. `permission` hides the tab from a viewer without it (a UI hint; the API behind the panel enforces the permission).

### User extensions on the user payloads

The API's `registerCurrentUserExtension` and `registerUserListExtension` ([identity API README](../../../platform-api/src/identity/README.md#user-extensions)) put small JSON of the app's own under `extensions.<id>` in `GET /api/auth/me` and in each row of `GET /api/users`. `AuthUser.extensions` and `UserListItem.extensions` are typed `Record<string, Record<string, unknown>>`; read one with `useCurrentUserExtension<T>(id)` (the signed-in user) or `userExtension<T>(user, id)` (either payload), which answer `undefined` for an extension that did not contribute. Treat the content as untrusted data to render, never as markup, and as a hint, never as a permission check.

### Login layout and theme

`LoginPage` slots: `Logo` (above the heading, nothing by default), `Title` (the "Welcome" heading block; `Header` does the same and wins), `Footer` (the terms caption), `ProviderButton` (one provider's button; receives `{ provider, onClick }`), `BeforeProviders` (above the "Sign in with" divider) and `AfterProviders` (under the buttons, above the footer), both nothing by default and both receiving `LoginProvidersSlotProps` (`{ providers, login }`). Inside the card the order is `Logo`, the heading, the session-expired notice, `BeforeContent`, `Sections` (top), `BeforeProviders`, the buttons, `AfterProviders`, `Sections` (bottom), `AfterContent`, `Footer`; the page's DOM is unchanged until one is passed. Everything else is styled by the app's theme: the pages use palette roles (`background.default`, `info`, `warning`, `error`), `theme.shadows[10]` and typography variants, never a hard-coded theme. The provider buttons keep each provider's brand colours (registered per provider). `AuthCallbackPage` reads the provider its retry buttons restart from its `provider` prop, else a `:provider` route segment, else the provider the sign-in started with.

**Custom providers.** The API lists a provider that owns its sign-in flow (a popup, a native SDK, a form) with `mode: 'custom'` on `GET /api/auth/providers`; a redirect provider's entry is unchanged. `useAuth().login(id)` stores the return URL and the id as before, then, for a custom provider, calls `start()` of the look registered for it with `registerAuthProvider` instead of navigating to `/api/auth/<id>` (it logs an error when none is registered). A redirect provider needs no web code beyond an optional look. The flow must end at `/auth/callback?token=...` or by calling `setAccessToken` and `refreshUser`. Worked example: [`company-sso.tsx`](../../../../apps/web/src/platform-extensions/identity/company-sso.tsx).

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

First packaged release (#727, PP-6.6 parts 3 to 5; part 5 deleted the reference app's compatibility re-exports, so the app imports the slice only from these entry points). Moving from the app's own copies: mount `AuthProvider` from `/identity/headless` with your transport as `client` and your logout clean-up as `onBeforeLogout`; mount `IdentityWebAdaptersProvider` with your product name, spinner and table; spread `identityAdminSections` / `identityUserSettingsSections` where your literal cards were; route to the packaged pages. Behaviour, texts and test ids are unchanged. `ProtectedRoute` is `RequireAuth` with the spinner passed as `loading`. The sign-in copy is `createSignInErrorContent(appName)`, no longer a constant naming the app.

#997 (additive): `/identity/headless` gains `LocalIdentityProvider`, `createLocalAuthContextValue` and `LocalIdentityInput` (see [Local identity](#local-identity-no-sign-in-host)); `AuthContextValue` gains an optional `mode` (`'server' | 'local'`); `usePermissions` falls back to `PlatformHost.viewer` when no `AuthContext` is mounted instead of throwing at once. An app with an `AuthProvider` sees no change.

PP-14.25 (additive): `UsersPage`, `UserList`, `OrganizationPage`, `OrgMembersPanel`, `OrganizationsPage`, `UserTokensPage`, `ActivateDevicePage`, `AuthCallbackPage` and `LoginPage` take `slots` (see [Page slots](#page-slots)); `AuthUser` and `UserListItem` gain an optional `extensions`, with `useCurrentUserExtension` and `userExtension` to read it. Pages with no slot render the markup they always did. `LoginPage.slots.Title` keeps working; the new `Header` replaces it. A test that mocked `UserList` or the page as a component with no props keeps working.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `useAuth must be used within an AuthProvider` | Mount `AuthProvider` inside the router, above every route. |
| `usePermissions` throws naming `AuthContext` and `PlatformHost` | Neither is mounted. A host with a server mounts `AuthProvider`; a single-user host without one mounts `PlatformHostProvider` (its `viewer`) and `LocalIdentityProvider`. |
| `useIdentityApi: no identity client` | A page or hook renders outside `PlatformHostProvider` and the adapters carry no `api`. Mount the host (or pass `adapters.api`). |
| The lists look different from the rest of the app | No `DataTable` adapter: the plain MUI fallback renders. Hand the app's table in `IdentityWebAdapters.DataTable`. |
| The sign-in error says "this app" | `IdentityWebAdapters.appName` is not set. |
| A provider shows a generic blue button | Register its look with `registerAuthProvider` before the first render. |

## Links

- Spec: [platform-packages.md](../../../../docs/specs/platform-packages.md), "UI extensibility".
- The API side: [`@marinoscar/platform-api/identity`](../../../platform-api/src/identity/README.md); the wire shapes: [`@marinoscar/platform-contract/identity`](../../../platform-contract/src/identity/README.md).
- Hosting, the HTTP client and the settings-page descriptor: [core README](../core/README.md).
- Package README: [platform-web](../../README.md).
