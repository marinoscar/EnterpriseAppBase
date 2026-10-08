# @marinoscar/platform-web/settings

The settings slice of the web package (issue #733, PP-8.1): `SettingsHub`, the one component every settings surface renders, the section registry's types and helpers, the open deployment-feature registry the cards are gated on, and the headless hooks of `/api/system-settings`, `/api/user-settings` and `/api/org-settings`. Two entries: `/settings/ui` (the hub and the registry helpers) and `/settings/headless` (the hooks and the feature registry). It depends on `core` only (`packages/platform-slices.json`).

## Purpose and scope

The settings hub and its card types are platform structure: every slice's web package contributes cards and pages that the hub renders, so the hub cannot stay app code. This slice holds that structure; the app keeps its registries (`ADMIN_SECTIONS`, `USER_SETTINGS_SECTIONS`), its routes and its pages.

- **`SettingsHub`**, moved WITHOUT behavioural change from the reference app: a searchable, grouped card grid from `sm` up, an iOS-style drill-down list below it. It is gate 4 of the five coupled breakpoint gates (`isCompactWindow = down('sm')`, [settings-ui.md](../../../../docs/specs/settings-ui.md#breakpoint-gates)); the other four stay in the app (`Layout.tsx` twice, `BottomNav`, `AppBar.tsx`).
- **The registry helpers**: `SettingsCardDef`, `SettingsSectionDef`, `visibleSettingsSections` (permission, feature and title-search gates; empty sections dropped), `settingsPageTitle` (longest-prefix route title) and `isFeatureEnabled`. The hub, the Console rail and the AppBar title resolver run these, so they cannot disagree.
- **An OPEN feature key** (rung 2): `SettingsFeatureRegistry` declares `ai` and `telemetry`; an app augments it with its own key and registers how to read it with `registerSettingsFeature(key, useIsOn)`. `useSettingsFeatures()` asks every registered resolver.
- **The hooks**: `useSystemSettings`, `useUserSettings` (moved) and `useOrgSettings` (new), each with the house fetch contract (a mounted guard, 403 named, a 409 refetches and throws, `If-Match` from the loaded version).

Not here: the app's registries and routes (Settings UI Pattern rule 1), the pages behind the cards (each slice's own), the app's theme context (the app passes its setter to `useUserSettings`).

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { SettingsHub, visibleSettingsSections } from '@marinoscar/platform-web/settings/ui';
import { useOrgSettings, registerSettingsFeature } from '@marinoscar/platform-web/settings/headless';
```

Peers: `react`, `react-router-dom` (the hub navigates), `@mui/material` and `@mui/icons-material` (the hub's components and the card's `Icon` type). The wire types come from `@marinoscar/platform-contract/settings`.

## Quick start

The reference app's admin hub binding ([`SettingsHubPage.tsx`](../../../../apps/web/src/pages/Admin/SettingsHubPage.tsx)):

```tsx
import { SettingsHub } from '@marinoscar/platform-web/settings/ui';

const { hasPermission } = usePermissions();
<SettingsHub
  sections={ADMIN_SECTIONS}
  hubKey="admin-settings-hub"
  title={ADMIN_HUB_TITLE}
  subtitle="Manage system configuration, providers, and operational settings."
  features={{ ai: aiConfig.enabled, telemetry: isTelemetryOn(telemetryConfig), orgs }}
  hasPermission={hasPermission}
  useScrollRestoration={useScrollRestoration}
/>;
```

An app-owned feature key ([`useSettingsFeatures.ts`](../../../../apps/web/src/hooks/useSettingsFeatures.ts)):

```ts
declare module '@marinoscar/platform-web/settings/headless' {
  interface SettingsFeatureRegistry { orgs: true }
}
registerSettingsFeature('orgs', useOrgsFeature);
```

## Configuration

`SettingsHub` props:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `sections` | `SettingsSectionDef[]` | required | The registry, passed whole (the gates live in `visibleSettingsSections`) |
| `hubKey` | `string` | required | The scroll-restoration key, one per surface |
| `title`, `subtitle` | `string` | required | The heading and the line under it |
| `features` | `SettingsFeatures` | `{}` | The deployment feature map; a feature-gated card is hidden unless its key is `true` |
| `hasPermission` | `(permission: string) => boolean` | the host viewer's | The permission check; without a host, permission-gated cards are hidden |
| `useScrollRestoration` | `(key: string) => void` | none | A hook restoring the hub's scroll offset across a drill-down; must be the same function every render |

The hooks take `{ api?: PlatformApiClient }` (default: the `PlatformHostProvider`'s); `useUserSettings` also takes `syncTheme` (default `true`) and `applyTheme`.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `SettingsHub` | component | `SettingsHub(props: SettingsHubProps): ReactElement` | Render a settings surface (admin or per-user) from a section registry | stable | [example](../../../../apps/web/src/pages/Admin/SettingsHubPage.tsx) |
| `registerSettingsFeature` | registry | `registerSettingsFeature(key: SettingsFeatureKey, useIsOn: () => boolean): void` | Add a deployment feature a card can be gated on (augment `SettingsFeatureRegistry` first) | experimental | [example](../../../../apps/web/src/hooks/useSettingsFeatures.ts) |
| `useSystemSettings` | hook | `useSystemSettings<T>(options?): UseSystemSettingsResult<T>` | Read and save the deployment-wide settings document | experimental | [example](../../../../apps/web/src/hooks/useSystemSettings.ts) |
| `useUserSettings` | hook | `useUserSettings<T, U>(options?): UseUserSettingsResult<T, U>` | Read and save the signed-in user's settings, syncing the app's theme | experimental | [example](../../../../apps/web/src/hooks/useUserSettings.ts) |
| `useOrgSettings` | hook | `useOrgSettings(options?): UseOrgSettingsResult` | Read and patch the active organization's settings overrides | experimental | [example](../../../../apps/web/src/pages/Admin/OrgSettingsPage.tsx) |
| `settingsRegistryGatesSuite` | registry | `WebConformanceSuite` (id `settings-registry-gates`) | Read the suite's id; it runs for every app that imports `/settings/testing` | experimental | [example](../../../../apps/web/src/__tests__/conformance.test.ts) |
| `settingsRegistryShapeSuite` | registry | `WebConformanceSuite` (id `settings-registry-shape`) | Read the suite's id | experimental | [example](../../../../apps/web/src/__tests__/conformance.test.ts) |
| `settingsAiCardsSuite` | registry | `WebConformanceSuite` (id `settings-ai-cards`) | Read the suite's id | experimental | [example](../../../../apps/web/src/__tests__/conformance.test.ts) |
| `settingsCardRoutesSuite` | registry | `WebConformanceSuite` (id `settings-card-routes`) | Read the suite's id | experimental | [example](../../../../apps/web/src/__tests__/conformance.test.ts) |
| `settingsRouteOwnershipSuite` | registry | `WebConformanceSuite` (id `settings-route-ownership`) | Read the suite's id | experimental | [example](../../../../apps/web/src/__tests__/conformance.test.ts) |

Supporting exports: `SettingsCardDef`, `SettingsSectionDef`, `visibleSettingsSections`, `settingsPageTitle`, `isFeatureEnabled` (stable); `SettingsFeatureRegistry`, `SettingsFeatureKey`, `SettingsFeatures`, `useSettingsFeatures`, `registeredSettingsFeatures`, the hook option and result types (experimental).

## Data

None. The slice owns no storage; it reads and writes through the API's settings routes.

## Permissions and settings

The hub mirrors permissions, it never invents one: a card's `permission` is the exact string the API controller enforces (Settings UI Pattern rule 3). The hooks call `/system-settings` (`system_settings:read|write`), `/user-settings` (`user_settings:read|write`) and `/org-settings` (`org_settings:read|write`).

## UI

`SettingsHub` only; the app's pages render behind its cards. The reference app's `Organization settings` page ([`OrgSettingsPage.tsx`](../../../../apps/web/src/pages/Admin/OrgSettingsPage.tsx)) is built on `useOrgSettings` and renders a form generated from the namespace descriptors the API returns. Accessibility (from the hub's spec): the search field has an explicit accessible name, inert cards are not tab stops, the compact list and the grid are chosen by mounting (never both in the DOM).

## Infra

None. Static code; no route, no proxy rule.

## Observability

None. The hooks surface errors to their callers; the API logs and audits every write.

## Security notes

The browser only presents: every permission and every org-layer rule is enforced by the API. A hidden card is a convenience, never the gate (the route has its own `RequirePermission`, and the API refuses the call).

## Conformance suite

`@marinoscar/platform-web/settings/testing` registers five suites with `runPlatformWebConformance()` (`@marinoscar/platform-web/testing`). They run over the app's own registries, route table and destination table, and every expectation is derived from that data, never from a literal title or a controller's source:

| Suite id | What it pins |
|---|---|
| `settings-registry-gates` | `visibleSettingsSections` and `settingsPageTitle` are the one gate the hub, the Console rail and the AppBar title run: permission gating, empty sections dropped, `alwaysShow` and the feature axis (fail closed), title-only case-insensitive search composed with the gates, longest-prefix titles on segment boundaries, nested routes, a feature card titles nothing while its feature is off, `null` outside the hub. Fixture cases plus every card of both registries, checked against an independent reference implementation |
| `settings-registry-shape` | Every card has a title, a description and an icon component, a route under its hub (or is inert with no route), a unique route, and only permissions in the API's generated catalog (Settings UI Pattern rules 1 and 3) |
| `settings-ai-cards` | AI cards (`feature: 'ai'` or routed under an `ai` segment) carry `ai_config:*`, `org_ai_config:*` or `ai:use` as the API enforces, are never confused across scopes, and declare `feature: 'ai'` except the admin switch (AI rule 5). With an OpenAPI document, the permission must also be one an AI route declares in `x-rbac` |
| `settings-card-routes` | Every card path has a route gated on exactly the permission the card declares, and sits in the destination that owns its hub |
| `settings-route-ownership` | Every route the app declares is owned by exactly one destination or deliberately by none; ownership matches on segment boundaries |

```ts
// apps/web/src/__tests__/conformance.test.ts
import '@marinoscar/platform-web/settings/testing'; // registers the suites
runPlatformWebConformance({
  adminSections: ADMIN_SECTIONS,
  userSettingsSections: USER_SETTINGS_SECTIONS,
  hubs: { admin: { path: ADMIN_HUB_PATH, title: ADMIN_HUB_TITLE }, user: { path: USER_HUB_PATH, title: USER_HUB_TITLE } },
  routes: { appTsx: readFileSync(APP_TSX, 'utf8') }, // or an exported array of { path, permission }
  apiPermissions: catalog.permissions.map((permission) => permission.name),
  destinations: { routes: DESTINATION_ROUTES, unowned: UNOWNED_ROUTES, owns, resolveActive: resolveActiveDestination, destinations: [...] },
  suites: { 'settings-route-ownership': { skip: 'This app has no destination table.' } }, // optional; a reason is required
});
```

Options: `adminSections`, `userSettingsSections`, `hubs`, `routes` (a route array, preferred, or `{ appTsx }`, the text of the route file parsed for `<Route>` elements so the live routes are read and never a copy), `apiPermissions` (the generated permission catalog, `apps/api/prisma/catalog/permissions.json`), `openApiDocument?` (when the environment has one), `destinations?` (required by `settings-route-ownership`) and `suites?` (skips by id). The app reads files itself, because this package has no Node types.

The reference app keeps only what is about ITS cards (which group holds Broadcasts, that Console is pinned) in `apps/web/src/__tests__/config/settingsCards.test.ts` and `destinations.test.ts`. The breakpoint-gate tripwires (`Layout`, `AppBar`, `BottomNav`) stay in the app because they render the app's own components; gate 4, `SettingsHub`, is pinned by this package's `test/settings/settings-hub.test.tsx`.

Each suite is proved against a planted violation in `test/settings/testing/conformance.test.ts` and `gate-broken.test.ts` (a card with no route, an invented permission, an AI card without its feature, a route two destinations claim, a shared gate that forgets the feature axis).

## Upgrade notes

From the reference app's local copies (#733): `components/settings/SettingsHub.tsx` is deleted (import `SettingsHub` from `/settings/ui`, and pass `hasPermission` and `useScrollRestoration` when the hub renders outside a platform host or with scroll restoration); the card types and helpers left `config/adminSections.tsx`; the feature key is open (`SettingsFeatureKey` is `keyof SettingsFeatureRegistry`), so an app key needs an augmentation and a `registerSettingsFeature` call.

## Troubleshooting

- **`registerSettingsFeature("x"): the feature set is fixed`.** A NEW key was registered after the first `useSettingsFeatures()` render; register at module scope (re-registering an existing key is allowed).
- **Every permission-gated card is missing.** The hub renders outside a `PlatformHostProvider` and no `hasPermission` prop was passed.
- **`Settings hooks need a transport`.** Mount `PlatformHostProvider` or pass `{ api }`.

## Links

- [settings-ui.md](../../../../docs/specs/settings-ui.md): the Settings UI Pattern, the breakpoint gates.
- API: [`@marinoscar/platform-api/settings`](../../../platform-api/src/settings/README.md). Contract: [`@marinoscar/platform-contract/settings`](../../../platform-contract/src/settings/README.md).
