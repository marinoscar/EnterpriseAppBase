# @marinoscar/platform-web/onboarding

The onboarding slice of the web package (issue #745, PP-9.3), in two entries: `/onboarding/headless` (the client, `OnboardingProvider` and its hooks, the feature-notice registry, the "Getting started" action) and `/onboarding/ui` (the welcome dialog, the checklist, the Setup guide and Getting started pages, the Activation section, the feature notice, the menu item and the two settings-page descriptors). It reads `GET /api/onboarding` and `GET /api/admin/onboarding/metrics` of `@marinoscar/platform-api/onboarding` and writes through `PATCH /api/user-settings`. It depends on `core` only (`packages/platform-slices.json`).

## Purpose and scope

Presentation of checklists the API derives. The browser never ticks a step: every status comes from the API, and the only writes are UI state (the welcome was seen, a checklist was dismissed, a step was skipped) in the `onboarding` user-settings namespace, with `If-Match`.

- **One fetch per shell.** `OnboardingProvider` runs the query once around the authenticated shell; the dialog, the checklists, the menu and the Setup guide read the same state. Without a provider, `useOnboarding` is inert and requests nothing.
- **Optimistic writes.** Closing the dialog closes it at once; the state is re-read afterwards. A failed write keeps the local value for the session and reports `error`.
- **Accessible.** The dialog follows the ARIA dialog pattern (`aria-labelledby`, `aria-describedby`, focus in and out, Escape closes, full screen below `sm`, no motion under `prefers-reduced-motion`); every status is a word beside an icon, never colour alone; progress is text ("3 of 5 done").

Not here: the app's routes, registries and menu (the app binds the descriptors and the menu item), tours or coach marks, and anything per user in the metrics.

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { OnboardingProvider, useOnboarding } from '@marinoscar/platform-web/onboarding/headless';
import { WelcomeDialog, setupGuideSettingsPage } from '@marinoscar/platform-web/onboarding/ui';
```

Peers: `react`, `react-dom`, `react-router-dom` (the pages link and navigate), `@mui/material`, `@mui/icons-material`, `@emotion/react`, `@emotion/styled`. The wire types come from `@marinoscar/platform-contract/onboarding`.

## Quick start

The reference app mounts the provider inside its platform host, around the shell ([`App.tsx`](../../../../apps/web/src/App.tsx)), the dialog once in its layout ([`Layout.tsx`](../../../../apps/web/src/components/common/Layout.tsx)) and the menu item in its user menu ([`UserMenu.tsx`](../../../../apps/web/src/components/navigation/UserMenu.tsx)):

```tsx
<AppPlatformHostProvider>
  <OnboardingProvider appName={APP_NAME}>
    <Layout />            {/* renders <WelcomeDialog /> once */}
  </OnboardingProvider>
</AppPlatformHostProvider>
```

and binds the two pages as registry cards and routes:

```tsx
// config/adminSections.tsx (General, appended)
{ ...setupGuideSettingsPage.card, Icon: setupGuideSettingsPage.Icon },
// config/userSettingsSections.tsx (Account, appended)
{ ...gettingStartedSettingsPage.card, Icon: gettingStartedSettingsPage.Icon },
```

## Configuration

`OnboardingProvider` props: `appName` (used in the copy; default `'this app'`) and `client` (default `createOnboardingClient(host.api)`). `WelcomeDialog` props: `slots`, `setupPath` (default `/admin/settings/setup`), `gettingStartedPath` (default `/settings/getting-started`). `SetupGuidePage` props: `showActivation` (default `true`), `footer`. No environment variable.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `OnboardingProvider` | component | `OnboardingProvider(props: { children; appName?; client? }): ReactElement` | Run the one onboarding fetch around the authenticated shell | experimental | [example](../../../../apps/web/src/App.tsx) |
| `useOnboarding` | hook | `useOnboarding(): UseOnboardingReturn` | Read the state and write UI state (seen, dismissed, skipped, an app field) | experimental | [example](../../../../apps/web/src/platform-extensions/onboarding/GetStartedCard.example.tsx) |
| `useOnboardingMetrics` | hook | `useOnboardingMetrics(days: number, client?): UseOnboardingMetricsReturn` | Read the aggregate activation metrics | experimental | [example](../../../../apps/web/src/__tests__/platform/onboarding.test.tsx) |
| `createOnboardingClient` | hook | `createOnboardingClient(api: PlatformApiClient): OnboardingClient` | Call the onboarding routes outside the provider | experimental | [example](../../../../apps/web/src/__tests__/platform/onboarding.test.tsx) |
| `registerFeatureNotice` | registry | `registerFeatureNotice(def: FeatureNoticeDef): void` | Add a feature `FeatureUnavailableNotice` can name (`telemetry` in the reference app) | experimental | [example](../../../../apps/web/src/platform/onboarding.ts) |
| `useGettingStartedAction` | hook | `useGettingStartedAction(): GettingStartedAction` | Build the app's own "Getting started" menu entry | experimental | [example](../../../../apps/web/src/__tests__/platform/onboarding.test.tsx) |
| `WelcomeDialog` | slot | `WelcomeDialog(props: { slots?: { adminPane?; userPane? }; setupPath?; gettingStartedPath? }): ReactElement \| null` | The one-time welcome; an app's question goes in a pane slot | experimental | [example](../../../../apps/web/src/platform-extensions/onboarding/RoleWelcomePane.example.tsx) |
| `OnboardingChecklist` | component | `OnboardingChecklist(props: { steps; completed; total; label?; grouped?; onNavigate?; onSkip? }): ReactElement` | Embed a checklist in an app page | experimental | [example](../../../../apps/web/src/platform-extensions/onboarding/GetStartedCard.example.tsx) |
| `SetupGuidePage` | component | `SetupGuidePage(props?: { showActivation?; footer? }): ReactElement` | Route `/admin/settings/setup` | experimental | [example](../../../../apps/web/src/App.tsx) |
| `GettingStartedPage` | component | `GettingStartedPage(): ReactElement` | Route `/settings/getting-started` | experimental | [example](../../../../apps/web/src/App.tsx) |
| `ActivationMetrics` | component | `ActivationMetrics(): ReactElement` | The Activation section (a section of the Setup guide, not a card) | experimental | [example](../../../../apps/web/src/__tests__/platform/onboarding.test.tsx) |
| `FeatureUnavailableNotice` | component | `FeatureUnavailableNotice(props: { feature: string; detail? }): ReactElement` | Replace a control whose feature is not set up | experimental | [example](../../../../apps/web/src/__tests__/platform/onboarding.test.tsx) |
| `GettingStartedMenuItem` | component | `GettingStartedMenuItem(props: { onDone? }): ReactElement \| null` | The "Getting started" item of the app's user menu | experimental | [example](../../../../apps/web/src/components/navigation/UserMenu.tsx) |
| `setupGuideSettingsPage` | component | `PlatformSettingsPage<never>` | The admin card and route (`system_settings:read`) | experimental | [example](../../../../apps/web/src/config/adminSections.tsx) |
| `gettingStartedSettingsPage` | component | `PlatformSettingsPage<never>` | The user card and route (no permission) | experimental | [example](../../../../apps/web/src/config/userSettingsSections.tsx) |

Supporting exports (experimental): `ONBOARDING_INERT`, `PLATFORM_FEATURE_NOTICES`, `featureNoticeFor`, `registeredFeatureNotices`, `GETTING_STARTED_LABEL`, `ONBOARDING_TIER_LABELS`, `onboardingStatusWord`, `ACTIVATION_WINDOWS`, `formatRate`, `formatHours`, the copy constants and the props and return types.

## Data

None. The state is the API's; the stored half is the `onboarding` user-settings namespace.

## Permissions and settings

Declares none; reads the viewer's through the platform host. `user_settings:read` decides whether the provider fetches at all. The Setup guide card declares `system_settings:read` (the admin block's and the metrics' permission); Getting started declares none. `FeatureUnavailableNotice` shows "Set it up" to holders of the notice's `adminPermission`: `ai_config:read` (`/admin/settings/ai`), `storage_config:read` (`/admin/settings/storage`), `push:read` (`/admin/settings/push`), plus what the app registers. Writes the `onboarding` user-settings namespace (`welcomeSeenAt`, `checklistDismissedAt`, `adminDismissedAt`, `skipped`, app fields).

## UI

- **Pages:** `SetupGuidePage` (`/admin/settings/setup`: the admin steps in Required / Recommended / Optional groups, Re-check with `refresh=true`, Open the Doctor, the Activation section) and `GettingStartedPage` (`/settings/getting-started`: the user steps with Skip, "Show the welcome again").
- **Slots:** `WelcomeDialog` `slots.adminPane` and `slots.userPane`, each given `{ descriptionId, appName, setExtra }`; what a pane passes to `setExtra` is stored with the "seen" write.
- **Registry entries:** `setupGuideSettingsPage` (admin, General, appended, before any Danger Zone group) and `gettingStartedSettingsPage` (user, Account, appended, before any Danger Zone group).
- **Theme:** the app's MUI theme styles every part; no tokens of its own.

## Infra

None.

## Observability

None of its own: the provider's requests are the app transport's. The Activation section shows aggregates only.

## Security notes

The permission checks here only choose what to show; the API enforces its own gates (the admin block, the metrics, `PATCH /api/user-settings`). The notice's "Set it up" link is to an admin route the app gates itself. No per-user metric is fetched or rendered.

## Conformance suite

None in the web package. The reference app's `apps/web/src/__tests__/config/platformPages.test.ts` checks each descriptor is one card and one route with the exact permission, and that any Danger Zone group stays last; the API slice carries the onboarding conformance suite.

## Upgrade notes

New in #745. From EvoPath: its `useOnboarding` and `OnboardingProvider` map one to one (`markWelcomeSeen(goal)` becomes `markWelcomeSeen({ goal })`), `group` becomes `tier`, `label` becomes `title`, its goal chips become a `WelcomeDialog` `userPane`, its Today card embeds `OnboardingChecklist`. From kvox: its three-pane welcome comes through the slots; `SetupChecklist` and `GettingStartedPage` are replaced by the packaged pages.

## Troubleshooting

- **Nothing onboarding appears.** No `OnboardingProvider` above (the hook is inert), or the viewer lacks `user_settings:read`.
- **The welcome reopens after closing.** The write failed (see `error`); the dialog stays closed for the session but the stored state did not change.
- **`FeatureUnavailableNotice` throws "no notice is registered".** Register the feature with `registerFeatureNotice` at module scope.

## Links

- API: [`@marinoscar/platform-api/onboarding`](../../../platform-api/src/onboarding/README.md). Contract: [`@marinoscar/platform-contract/onboarding`](../../../platform-contract/src/onboarding/README.md).
- Spec: [onboarding.md](../../../../docs/specs/onboarding.md), [settings-ui.md](../../../../docs/specs/settings-ui.md).
