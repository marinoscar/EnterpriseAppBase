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

None in this slice yet. The registry tripwires run in the reference app (`apps/web/src/__tests__/config/settingsRegistry.test.ts`, `aiSettingsRegistry.test.ts`, `platformPages.test.ts`); their web counterpart of `runPlatformConformance()` lands with #742.

## Upgrade notes

From the reference app's local copies (#733): `components/settings/SettingsHub.tsx` is deleted (import `SettingsHub` from `/settings/ui`, and pass `hasPermission` and `useScrollRestoration` when the hub renders outside a platform host or with scroll restoration); the card types and helpers left `config/adminSections.tsx`; the feature key is open (`SettingsFeatureKey` is `keyof SettingsFeatureRegistry`), so an app key needs an augmentation and a `registerSettingsFeature` call.

## Troubleshooting

- **`registerSettingsFeature("x"): the feature set is fixed`.** A NEW key was registered after the first `useSettingsFeatures()` render; register at module scope (re-registering an existing key is allowed).
- **Every permission-gated card is missing.** The hub renders outside a `PlatformHostProvider` and no `hasPermission` prop was passed.
- **`Settings hooks need a transport`.** Mount `PlatformHostProvider` or pass `{ api }`.

## Links

- [settings-ui.md](../../../../docs/specs/settings-ui.md): the Settings UI Pattern, the breakpoint gates.
- API: [`@marinoscar/platform-api/settings`](../../../platform-api/src/settings/README.md). Contract: [`@marinoscar/platform-contract/settings`](../../../platform-contract/src/settings/README.md).
