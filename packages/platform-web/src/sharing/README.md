# @marinoscar/platform-web/sharing

The sharing UI of the platform (issue #731, PP-7.4): headless hooks over the generic group, grant and link-share routes of `@marinoscar/platform-api/sharing` (#728 to #730), and MUI components built on them (a share dialog, the group pages, the pending invitations, a "shared with me" list and the public `/s` link page). Web layer; it depends only on the `core` slice of this package (`packages/platform-slices.json`) and on the wire shapes of `@marinoscar/platform-contract/sharing`.

## Purpose and scope

Two subpath exports:

- `@marinoscar/platform-web/sharing/headless`: behaviour without markup. A sharing client over the app's injected transport (`createSharingClient`), one read hook per question (`useGroups`, `useGroup`, `useGroupMembers`, `useGroupInvites`, `useMyGroupInvites`, `useGrants`, `useLinkGrants`, `useSharedWithMe`), the writes (`useGroupActions`, `useShareActions`, and `create` / `revoke` / `copyUrl` on `useLinkGrants`), `usePublicLink()` for the public `/s` route and the link-renderer registry (`registerLinkRenderer`).
- `@marinoscar/platform-web/sharing/ui`: `ShareDialog`, `GroupsPage`, `GroupDetailPage`, `PendingGroupInvites`, `SharedWithMeList`, `PublicLinkPage` and the `groupsSettingsPage` descriptor.

Packages own behaviour, apps own appearance: no component creates a theme, every one takes `sx`, `className` and `slots`, and the pages are route components the app mounts inside its own shell. None imports the app's layout, navigation, auth context or datatable.

Not here: the API (the routes, `AccessPolicy`, the token handling on the server) is `@marinoscar/platform-api/sharing`; organization administration is the identity slice (#726); what an anonymous visitor sees of a record is the app's own renderer (`registerLinkRenderer`). Every extension point below has a compiled, tested example in the reference app's test tree, `apps/web/src/__tests__/examples/sharing/` (#732), on the app's own platform host and transport.

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { registerLinkRenderer, useGrants } from '@marinoscar/platform-web/sharing/headless';
import { GroupsPage, ShareDialog, groupsSettingsPage } from '@marinoscar/platform-web/sharing/ui';
```

Peers are those of the package ([README](../../README.md#install-and-peer-dependencies)); this slice uses `react`, `react-router-dom` (the pages link and navigate), `@mui/material` and `@mui/icons-material`. It uses no optional peer (no charts, no data grid, no editor).

## Quick start

The reference app binds the slice in three places. The card, appended as the only card of a last `Sharing` section ([`userSettingsSections.tsx`](../../../../apps/web/src/config/userSettingsSections.tsx)):

```tsx
{ label: 'Sharing', cards: [{ ...groupsSettingsPage.card, Icon: groupsSettingsPage.Icon }] },
```

The routes ([`App.tsx`](../../../../apps/web/src/App.tsx)): the two group pages inside the authenticated shell behind the card's permission, and the public link page OUTSIDE `ProtectedRoute`, next to `/login`, with the app's transport passed directly (no host is mounted there):

```tsx
<Route path="/s" element={<PublicLinkPage apiClient={appPlatformApi} />} />
...
<Route path="/settings/groups" element={<RequirePermission permission="groups:read" fallback={<Navigate to="/" replace />}><GroupsPage /></RequirePermission>} />
<Route path="/settings/groups/:id" element={<RequirePermission permission="groups:read" fallback={<Navigate to="/" replace />}><GroupDetailPage /></RequirePermission>} />
```

The link renderers, registered and frozen before the first render ([`platform/linkRenderers.ts`](../../../../apps/web/src/platform/linkRenderers.ts), called from `main.tsx`; a worked renderer: [`PublicAlbumView.example.tsx`](../../../../apps/web/src/__tests__/examples/sharing/PublicAlbumView.example.tsx)):

```ts
export function registerAppLinkRenderers(): void {
  registerLinkRenderer('album', PublicAlbumView);   // the template registers none: it ships no shareable type
  freezeLinkRenderers();
}
```

A feature page opens the share dialog for one of its records ([`NoteShareButton.example.tsx`](../../../../apps/web/src/__tests__/examples/sharing/NoteShareButton.example.tsx)):

```tsx
<ShareDialog
  open={open}
  onClose={() => setOpen(false)}
  resource={{ type: 'transcript', id }}
  resourceTitle={title}
  roles={[{ value: 'viewer', label: 'Can view' }, { value: 'editor', label: 'Can edit' }]}
  allowLinks
/>
```

## Configuration

Props, all optional unless marked. Every component also takes `sx` and `className`.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `ShareDialog.open`, `onClose`, `resource`, `roles` | `boolean`, `() => void`, `ResourceRef`, `{ value; label }[]` | required | The record and the roles a person or group may be given (weakest first; the first is the default) |
| `ShareDialog.resourceTitle` | `string` | none | The title reads `Share "<title>"` |
| `ShareDialog.allowGroups` | `boolean` | `true` | Offer sharing with one of the viewer's groups |
| `ShareDialog.allowLinks` | `boolean` | `false` | Show the link section (the type lists link roles on the API) |
| `ShareDialog.linkRoles` | `{ value; label }[]` | the first of `roles` | The roles a link may grant; a select appears with two or more |
| `ShareDialog.linkExpiryPresets` | `{ label; days \| null }[]` | 1, 7, 30 days, never | The link lifetimes offered; the first is the default |
| `ShareDialog.onChanged` | `() => void` | none | After every successful change |
| `GroupsPage.detailPath` | `(groupId) => string` | `/settings/groups/<id>` | Where a group opens |
| `GroupDetailPage.groupId` | `string` | the `:id` route parameter | The group |
| `GroupDetailPage.backPath` | `string` | `/settings/groups` | Back, and after a delete or a leave |
| `GroupDetailPage.currentUserId` | `string \| null` | the host viewer's | Who "leave" removes |
| `PendingGroupInvites.onChanged` | `({ inviteId, groupId, accepted }) => void` | none | After an accept or a decline |
| `PendingGroupInvites.hideWhenEmpty` | `boolean` | `true` | Render nothing while there is no invitation |
| `SharedWithMeList.resourceType` | `string` | every type | One type only |
| `SharedWithMeList.resolvePath` | `(type, id, item) => string \| null` | the API's `path` | Where an item opens |
| `SharedWithMeList.typeLabels`, `roleLabels` | `Record<string, string>` | humanised ids | Headings and role names |
| `PublicLinkPage.apiClient` | `PlatformApiClient` | the host's | The transport; required on a public route outside the host |
| `PublicLinkPage.registry` | `LinkRendererRegistry` | the app's (`linkRenderers`) | The renderers to use (tests) |
| every component and hook `.client` | `SharingClient` | `createSharingClient(host.api)` | Moved routes (`createSharingClient(api, { groups, grants, publicLinks })`) or a test double |
| every component `.can` | `(permission) => boolean` | the host viewer's `hasPermission` | Hides or disables controls only; the API decides |

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `groupsSettingsPage` | component | `PlatformSettingsPage<never>` | Register the groups page as one user card (`groups:read`) and its routes | experimental | [example](../../../../apps/web/src/config/userSettingsSections.tsx) |
| `ShareDialog` | component | `ShareDialog(props: ShareDialogProps): ReactElement` (`open`, `onClose`, `resource`, `roles`, `allowGroups?`, `allowLinks?`, `linkRoles?`, `linkExpiryPresets?`, `slots?: { Title? }`) | Let a feature page share one of its records with people, groups and links | experimental | [example](../../../../apps/web/src/__tests__/examples/sharing/NoteShareButton.example.tsx) |
| `useGrants` | hook | `useGrants(resource, { enabled?, client? }): SharingResource<GrantList>` | Who a record is shared with, under the app's own markup | experimental | [example](../../../../apps/web/src/__tests__/examples/sharing/HeadlessShareList.example.tsx) |
| `useShareActions` | hook | `useShareActions(resource, { client? }): ShareActions` (`shareWithEmail`, `shareWithUser`, `shareWithGroup`, `changeRole`, `changeExpiry`, `revoke`, `pending`) | The share writes without `ShareDialog` | experimental | [example](../../../../apps/web/src/__tests__/examples/sharing/HeadlessShareList.example.tsx) |
| `useSharedWithMe` | hook | `useSharedWithMe(resourceType?, { page?, pageSize?, client? }): SharingResource<SharedWithMeList>` | A "shared with me" list of the app's own design | experimental | [example](../../../../apps/web/src/__tests__/examples/sharing/HeadlessShareList.example.tsx) |
| `GroupsPage` | component | `GroupsPage(props?: GroupsPageProps): ReactElement` | Route the groups destination (`/settings/groups`) | experimental | [example](../../../../apps/web/src/App.tsx) |
| `GroupDetailPage` | component | `GroupDetailPage(props?: GroupDetailPageProps): ReactElement` | Route one group's page (`/settings/groups/:id`) | experimental | [example](../../../../apps/web/src/App.tsx) |
| `PublicLinkPage` | component | `PublicLinkPage(props?: { apiClient?; client?; registry?; slots?: { Frame?; NotAvailable?; Loading? }; sx?; className? }): ReactElement` | Route the public `/s` page outside the authenticated shell; brand it with `slots.Frame` | experimental | [route](../../../../apps/web/src/App.tsx), [framed](../../../../apps/web/src/__tests__/examples/sharing/PublicAlbum.example.test.tsx) |
| `registerLinkRenderer` | registry | `registerLinkRenderer(resourceType: string, component: ComponentType<{ resolution; token; apiClient }>): void` | Show a resource type's public view on `/s` | experimental | [example](../../../../apps/web/src/__tests__/examples/sharing/PublicAlbumView.example.tsx) |
| `freezeLinkRenderers` | registry | `freezeLinkRenderers(): void` | Refuse every later registration once the app has bootstrapped | experimental | [example](../../../../apps/web/src/platform/linkRenderers.ts) |

The link-renderer registry follows the core registry semantics (`@marinoscar/platform-api/core`'s `Registry`): ids are resource type ids (lower-case snake_case, `INVALID_ID` otherwise), a duplicate is `DUPLICATE_ID`, a registration after `freezeLinkRenderers()` is `FROZEN`, and reads keep working. Each refusal is a `LinkRendererRegistryError`; switch on its `code`.

### Headless hooks

Every read hook returns `{ data, loading, error, refresh }` (`SharingResource<T>`): `data` stays while a refresh runs, `error` is a `SharingError` (`message` safe to show, `status`, `reason` from `details.reason`, `retryAfterSeconds` for a `429`, raw `details`), and `refresh()` never rejects. Every action rejects with a `SharingError`.

| Hook | Calls | Notes |
|---|---|---|
| `useGroups(options \| 'mine' \| 'all')` | `GET /groups?scope` | `all` needs `groups:admin`; `enabled: false` skips it |
| `useGroup(id)` | `GET /groups/:id` | A group the viewer may not see is `404`, never `403` |
| `useGroupMembers(id)` | `GET /groups/:id/members` | Admins first |
| `useGroupInvites(id, { status, enabled })` | `GET /groups/:id/invites` | Group admins only: pass `enabled: false` otherwise |
| `useMyGroupInvites()` | `GET /groups/invites/mine` | Accept or decline with `useGroupActions()` |
| `useGroupActions()` | `POST/PATCH/DELETE /groups...` | `create`, `update(id, input, version)` (sends `If-Match`), `remove`, `addMember`, `updateMember`, `removeMember` (own id: leave), `invite`, `revokeInvite`, `accept`, `decline` |
| `useGrants(resource)` | `GET /grants?resourceType&resourceId` | The viewer must be allowed to share the record |
| `useShareActions(resource)` | `POST/PATCH/DELETE /grants` | `shareWithEmail`, `shareWithUser`, `shareWithGroup`, `changeRole`, `changeExpiry`, `revoke` |
| `useLinkGrants(resource)` | `GET/POST /grants/links`, `DELETE /grants/:id` | `create`, `revoke`, `copyUrl` (resolves `false` when the browser refuses) |
| `useSharedWithMe(resourceType?)` | `GET /grants/shared-with-me` | `title` and `path` when the type describes its records |
| `usePublicLink({ apiClient })` | `GET /public/links/current` | See Security notes |

Supporting exports. `/sharing/headless`: `ResourceRef`, `SharingRoleOption`, `SharingError`, `SharingResource`, `toSharingError`, `isSharingError`, `describeRetryAfter`, `createSharingClient`, `SharingClient`, `SharingClientPaths`, `SharingPageQuery`, `ShareTarget`, `IssuedLinkGrant`, `CreateLinkInput`, `UseGroupsOptions`, `GroupActions`, `ShareActions`, `UseLinkGrantsReturn`, `parseLinkTokenFromHash`, `PublicLinkStatus`, `UsePublicLinkOptions`, `UsePublicLinkReturn`, `LinkRendererRegistry`, `LinkRendererRegistryError`, `LinkRendererRegistryErrorCode`, `linkRenderers`, `LinkRenderer`, `LinkRendererProps`, and the hooks above. `/sharing/ui`: `ShareDialog` with `ShareDialogProps` and `ShareDialogSlots` (`Title`), `PendingGroupInvites` with `PendingGroupInvitesProps` and `PendingGroupInvitesSlots` (`Container`), `SharedWithMeList` with `SharedWithMeListProps` and `SharedWithMeListSlots` (`Item`), `GroupsPageProps` and `GroupsPageSlots` (`Header`), `GroupDetailPageProps` and `GroupDetailPageSlots` (`Header`), `PublicLinkPageProps` and `PublicLinkPageSlots`. The other read hooks (`useGroups`, `useGroup`, `useGroupMembers`, `useGroupInvites`, `useMyGroupInvites`, `useLinkGrants`, `usePublicLink`) and `useGroupActions` follow the same contract as the catalogued ones.

### Minimal examples

Each is the smallest working use; the linked file is the compiled, tested version (Vitest and Testing Library, msw for the API's wire shapes, the reference app's `AppPlatformHostProvider`).

The app's own markup over the hooks ([`HeadlessShareList.example.tsx`](../../../../apps/web/src/__tests__/examples/sharing/HeadlessShareList.example.tsx)):

```tsx
const grants = useGrants({ type: 'note', id });
const actions = useShareActions({ type: 'note', id });
return <ul>{grants.data?.items.map((g) => (
  <li key={g.id}>{g.grantee.displayName ?? g.grantee.groupName}
    <button onClick={() => void actions.revoke(g.id).then(grants.refresh)}>Remove</button></li>
))}</ul>;
```

A renderer for the public page, calling the app's public route with the token in the header and showing a presigned URL ([`PublicAlbumView.example.tsx`](../../../../apps/web/src/__tests__/examples/sharing/PublicAlbumView.example.tsx)):

```tsx
function PublicAlbumView({ token, apiClient }: LinkRendererProps) {
  const [album, setAlbum] = useState<{ title: string; coverUrl: string } | null>(null);
  useEffect(() => void apiClient.get('/public/albums/current', { headers: { [LINK_TOKEN_HEADER]: token } }).then(setAlbum), [apiClient, token]);
  return album ? <img src={album.coverUrl} alt={album.title} /> : null;
}
registerLinkRenderer('album', PublicAlbumView);
<PublicLinkPage apiClient={appPlatformApi} slots={{ Frame: AppPublicFrame }} />;
```

## Data

None. A web slice owns no tables; the models (`groups`, `group_members`, `group_invites`, `grants`) belong to `@marinoscar/platform-db`'s sharing fragment and the API slice.

## Permissions and settings

The slice declares no permission; it reads the API's, through `can` (or the host viewer):

| Permission | Effect in the UI |
|---|---|
| `groups:read` | The `Groups` card and its two routes (the card's `permission`; the app's route gate) |
| `groups:write` | "New group"; with the group `admin` role (or `groups:admin`), rename, delete, member roles, removal and invitations |
| `groups:admin` | The "All groups" switch on `GroupsPage` and management of every group (one destination with an in-page toggle, never a second admin card) |
| `sharing:write` | The share form, the role selects, remove, and creating and revoking links in `ShareDialog` |

It reads no setting.

## UI

| Contribution | Where |
|---|---|
| `Groups` card (`groupsSettingsPage.card`: `/settings/groups`, `groups:read`, icon `GroupsOutlined`, no `feature`) | The app's `USER_SETTINGS_SECTIONS`, a new last `Sharing` section |
| `GroupsPage` | Route `/settings/groups`: pending invitations on top, the viewer's groups (or all, with `groups:admin`), a create dialog |
| `GroupDetailPage` | Route `/settings/groups/:id`: members (role, remove, leave), invitations (create, revoke), rename (`If-Match`; a `409 VERSION_CONFLICT` offers "Reload"), delete (`409 GROUP_OWNS_RESOURCES` shows the counts); `409 LAST_GROUP_ADMIN` is explained wherever it can happen |
| `PublicLinkPage` | Route `/s`, outside the authenticated shell: the registered renderer for the resolved type, or "This link is not available." for every failure |
| `ShareDialog` | Opened by a feature page: people and groups, then the link section, as stacked sections (never tabs) |
| `PendingGroupInvites`, `SharedWithMeList` | Anywhere the app wants them (a home page, a sidebar) |

Slots: `ShareDialog.slots.Title`, `GroupsPage.slots.Header`, `GroupDetailPage.slots.Header`, `PendingGroupInvites.slots.Container`, `SharedWithMeList.slots.Item`, `PublicLinkPage.slots.{Frame, NotAvailable, Loading}`. No theme token: the components use the app's MUI theme as it is.

Accessibility: every form control has a visible label (the role selects included); MUI's `Dialog` traps focus and returns it on close; async results ("Shared with …", "Link copied …", "Group saved.") are announced through a visually hidden `aria-live` region; each share URL is also a read-only text field, the copy button's fallback when the clipboard is refused. Lists and forms stack at phone width (below `sm`) and lay out in a row from `sm` up; the tables scroll inside their container, never the page.

## Infra

None. The slice adds no compose fragment and no environment variable; the share URL's origin is the API's `APP_URL`.

## Observability

None. The slice emits no log line, metric or span of its own; the API's sharing slice counts and traces the calls. It never logs anything, so it can never log a token.

## Security notes

- **The link token rides in the URL fragment** (`/s#lnk_…`, `buildLinkUrl`), which a browser never sends to a server. `usePublicLink()` reads it from `window.location.hash`, **removes it from the address bar at once** with `history.replaceState` (before any request, keeping the router's history state), and `PublicLinkPage` then drops it from the router's own location too, so it survives in neither the history, a bookmark, a screenshot nor a later `Referer`.
- **Memory only.** The token lives in a ref and in state, never `localStorage`, `sessionStorage`, a cookie or IndexedDB (any script on the origin could read those). A reload after the fragment is gone shows the neutral message; the recipient opens the original link again. Tests spy on both storages.
- **Header only.** The token is sent in `x-link-token` (`LINK_TOKEN_HEADER`), never in a path or a query string; a renderer passes it the same way to the app's public routes (`apiClient.get(path, { headers: { [LINK_TOKEN_HEADER]: token } })`). It is never logged.
- **One answer for every failure.** Unknown, expired, revoked, malformed, throttled and unrenderable links all show "This link is not available.", matching the API's uniform `404`.
- **No telemetry capture on `/s`.** An app must not record `location.hash` or `location.href` on `/s` (the reference app records neither anywhere).
- **The UI hides, the API decides.** `can` and the viewer only hide or disable controls; every decision (who may share, who may see a group, a 404 rather than a 403) is the API's.

## Conformance suite

None in this package: the web slice holds no invariant an app could break outside its own code (it owns no data and decides nothing; the API does). The sharing conformance suite is the API slice's (`@marinoscar/platform-api/sharing/testing`, see its [README](../../../platform-api/src/sharing/README.md#conformance-suite)); this slice's behaviour is pinned by its tests under `packages/platform-web/test/sharing/` and by the reference app's examples, registry and route tests.

## Upgrade notes

None. First release of the slice (#731); there is no earlier version to migrate from.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The share dialog's link section says "Links are not available for this item." | The links route answered `404`: the API does not serve `/grants/links` yet (#730), the resource type lists no link role, or the viewer may not share the record | Deploy the link routes, list a role under the type's `grantable.link`, or open the dialog only for records the viewer may share |
| `/s` always shows "This link is not available." | No renderer is registered for the resolved type (the template registers none), the link expired or was revoked, or the page was reloaded after the fragment was removed | `registerLinkRenderer(type, Component)` before `freezeLinkRenderers()`; open the original link again |
| `LinkRendererRegistryError` with code `FROZEN` | A renderer registered after the app's bootstrap (a lazily imported module) | Register it in the app's registration file, before the freeze |
| `usePublicLink: no apiClient, no client and no PlatformHostProvider` | The public route renders outside the host provider | Pass the app's transport: `<PublicLinkPage apiClient={appPlatformApi} />` |
| The Groups card is missing | The viewer lacks `groups:read` in the active organization | Grant it through the org role (every org role holds it by default) |
| Rename shows "Someone else changed this since you opened it" | `409 VERSION_CONFLICT`: the group changed after the page loaded | Choose "Reload", then rename again |

## Links

- [Package README](../../README.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)
- [Settings UI spec](../../../../docs/specs/settings-ui.md)
- [API sharing slice README](../../../platform-api/src/sharing/README.md)
- [Contract sharing README](../../../platform-contract/src/sharing/README.md)
- TypeDoc API reference: `npm run docs --workspace=@marinoscar/platform-web` writes `packages/platform-web/docs-api/` (entry points `src/sharing/headless/index.ts`, `src/sharing/ui/index.ts`)
