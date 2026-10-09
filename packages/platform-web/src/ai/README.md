# @marinoscar/platform-web/ai

`@marinoscar/platform-web/ai`: the browser side of the AI slice, in two entry points. `/ai/headless` holds the behaviour without markup: the AI wire types and calls over the host transport (`createAiResponse`, `streamAiResponse`, `getAiAdminConfig`, ... each takes the `PlatformApiClient` first), the hooks behind every AI page (`useAiConfig` with `AiConfigProvider`, `useAiAdminConfig`, `useAiModels`, `useAiUsage`, `useUserAiKeys`, `useUsableAiModels`, `useAiChat`, `useAiRun`, `useAiRealtimeSession`, `useMicrophonePermission`, `useAiUserSettings`), the organization tier (`useOrgAiKeys`, `useOrgAiPolicy`, #739) and the slots the app fills (`AiWebAdaptersProvider`). `/ai/ui` holds the `RequireAiEnabled` route guard and the pages: the Organization AI keys page (the default export), the admin AI, AI Models and AI Usage pages, the user AI Keys page and the Playground (#890), each also a subpath of its own for one lazy chunk per route. Depends on `core`, `settings` and `storage` (`packages/platform-slices.json`): the hooks call the API through the host's `api` (or an injected one), the pages read permissions from `usePlatformViewer()`, uploads go through the storage objects client and the default model through the settings slice's `useUserSettings`.

## Purpose and scope

Does: let an organization administrator store, replace and remove the organization's own key per provider (verified by the provider before it is stored; write-only, shown afterwards only by its last four characters), and see the policy that applies to the organization's members (the deployment's, narrowed by the organization's own `ai` overrides).

Does not: decide anything. Every permission is enforced by the API (`org_ai_config:read` to see, `org_ai_config:write` to change, in the active organization); the page only disables controls. The organization's `ai` overrides themselves are edited on the Organization settings page (the settings slice). Which cards exist, with which `permission` and `feature: 'ai'`, stays the app's registries' job (`adminSections.tsx`, `userSettingsSections.tsx`); the pages are bound to the reference app's routes (`/settings/ai`, `/admin/settings/ai/models`, `/admin/settings/jobs`) for their links.

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { useOrgAiKeys, useOrgAiPolicy } from '@marinoscar/platform-web/ai/headless';
import OrgAiKeysPage, { ORG_AI_KEYS_DESCRIPTION } from '@marinoscar/platform-web/ai/ui';
// one chunk per route:
const AiModelsPage = lazy(() => import('@marinoscar/platform-web/ai/ui/models-page'));
```

`/ai/headless` needs `react`; `/ai/ui` also `@mui/material`, `@emotion/*` and `react-router-dom` (the pages redirect and link). Both depend on `@marinoscar/platform-contract` (the org-key and policy types). Mount `PlatformHostProvider` (from `/core`) above the pages. Mount `AiConfigProvider` once around the signed-in shell (it fetches `GET /ai/config` for every `useAiConfig` and `useAiFeatures` below it; it usually sits above the host, so pass it the app's transport as `api`). Mount `AiWebAdaptersProvider` to hand in the app's spinner and responsive table.

## Quick start

The reference app routes the page behind the card's permission and the AI kill switch ([`App.tsx`](../../../../apps/web/src/App.tsx)) and declares the card in its registry ([`adminSections.tsx`](../../../../apps/web/src/config/adminSections.tsx)):

```tsx
const OrgAiKeysPage = lazy(() => import('@marinoscar/platform-web/ai/ui'));

<Route path="/admin/settings/ai/organization-keys" element={
  <RequirePermission permission="org_ai_config:read" fallback={<Navigate to="/" replace />}>
    <RequireAiEnabled><OrgAiKeysPage /></RequireAiEnabled>
  </RequirePermission>
} />

// the AI group of ADMIN_SECTIONS, appended last
{ title: 'Organization AI keys', path: '/admin/settings/ai/organization-keys', permission: 'org_ai_config:read', feature: 'ai', ... }
```

## Configuration

The pages take no props. Each hook takes `{ api? }` (`AiHookOptions`): the transport (default: the platform host's, or a transport whose calls reject with "No platform transport is available"). `AiWebAdaptersProvider` takes `adapters: AiWebAdapters`, a module constant with two optional members: `Spinner` (default an MUI `CircularProgress`) and `DataTable` (default a plain MUI table; the model catalogue and the usage breakdowns draw through it).

| Option | Type | Default | Meaning |
|---|---|---|---|
| `api` | `PlatformApiClient` | the platform host's `api` | The client the hook calls `/admin/ai/org-keys` or `/org-settings` with |

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `OrgAiKeysPage` | component | `OrgAiKeysPage(): ReactElement` | Route the Organization AI keys page behind `org_ai_config:read` | experimental | [example](../../../../apps/web/src/App.tsx) |
| `RequireAiEnabled` | component | `RequireAiEnabled(props: { children; fallback? }): ReactElement` | Gate an AI route on the kill switch, inside `RequirePermission` (import from `/ai/ui/require-ai-enabled` to keep the pages out of the main chunk) | experimental | [example](../../../../apps/web/src/App.tsx) |
| `AiWebAdapters` | option | `{ Spinner?: ComponentType<AiSpinnerProps>; DataTable?: AiDataTableComponent }` | Draw the AI pages' loading state and tables with the app's own components | experimental | [example](../../../../apps/web/src/platform/aiAdapters.ts) |
| `AiWebAdaptersProvider` | component | `AiWebAdaptersProvider(props: { adapters: AiWebAdapters; children }): ReactElement` | Hand the app's adapters to every AI page below it | experimental | [example](../../../../apps/web/src/platform/shellProviders.tsx) |
| `AiConfigProvider` | component | `AiConfigProvider(props: { api?: PlatformApiClient; children }): ReactElement` | Fetch `GET /ai/config` once for the shell, above the host | experimental | [example](../../../../apps/web/src/platform/shellProviders.tsx) |

## Data

None. The page reads and writes through the API; no browser storage.

## Permissions and settings

Reads `org_ai_config:write` from the viewer to enable the Save and Remove controls of the Organization AI keys page; the card and the route gate on `org_ai_config:read`, the literal `@marinoscar/platform-api/ai`'s `org-keys.controller.ts` enforces. The admin pages gate on `ai_config:read` (and show their controls for `ai_config:write`), the user pages on `ai:use`, as the API's controllers do; each page also redirects to `/` without its read permission (defence, not the gate: the route's guard and the API are). The default model is `user_settings.ai.defaultModel`, read and written through the settings slice.

## UI

Six pages. The pages moved in #890 keep the DOM and `sx` they had in the reference app, so its visual baselines are unchanged; the table and the spinner come from the app through the adapters. `AiConfigPage` (`/admin/settings/ai`: switch AI on, the key policy, providers and their keys, limits), `AiModelsPage` (the model catalogue), `AiUsagePage` (usage by user, model, provider, key source and organization), `UserAiKeysPage` (the caller's own keys, default model and usage) and `AiPlaygroundPage` (chat, image, transcription, speech, embeddings and voice).

`OrgAiKeysPage`: `OrgAiKeysPage`: an info note on how organization keys are used (a member's own key still comes first), one row per provider (masked status, a key field, Save and Remove), and the effective policy (enabled, key policy, providers on, per-organization caps). The app's MUI theme styles it. Errors are shown in an `alert`; a key the provider rejects reads "The provider rejected this key. Nothing was saved."

## Infra

None. A browser bundle.

## Observability

None of its own: the API logs and audits every key change (`org_ai_config:set_key`, `org_ai_config:delete_key`).

## Security notes

- **Write-only key.** The key is typed, sent once in the `PUT` body and never held after the request; the page shows only the stored hint. No browser storage is used.
- **The browser never calls a provider.** Every call is to `/api/ai/*` or `/api/admin/ai/*` through the host transport; the only provider secret the browser sees is a realtime session's ephemeral one, minted by `POST /api/ai/realtime/sessions` and used for that call only.
- **No client authorization.** Hiding or disabling a control is presentation; the API refuses a caller without the permission in the active organization.

## Conformance suite

None. `test/ai/` covers the slice without an app (the organization page, the hooks that fetch, the admin pages over mocked hooks and the shared components, against a test host); the reference app keeps the wire tests of every page and hook against its real transport and MSW (`apps/web/src/__tests__/pages/*wire*`, `hooks/useAi*`, `platform/aiClient.test.ts`), and its web conformance suites (`settings-ai-cards`, run from `apps/web/src/__tests__/conformance.test.ts`) and `settingsCards.test.ts` pin each card's permission and feature gate.

## Upgrade notes

New subpaths in #739: `/ai/headless` and `/ai/ui`. In #899: `/ai/ui/require-ai-enabled` (the `RequireAiEnabled` route guard, also exported by `/ai/ui`). In #890: `/ai/ui/config-page`, `/models-page`, `/usage-page`, `/keys-page` and `/playground-page`. The AI calls moved from the reference app's `services/ai.ts`: each now takes the `PlatformApiClient` as its first argument, and the hooks take `{ api? }` last. `PlatformApiClient` gained an optional `postFormData`, and `PlatformRequestOptions` gained `jsonBody` (a DELETE body); an app whose `createPlatformApiClient` is current has both.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The card is missing | AI is off, or the viewer lacks `org_ai_config:read` in the active organization | Switch AI on at `/admin/settings/ai`; grant the permission (the `org_admin` membership role holds it) |
| Save and Remove are disabled | The viewer lacks `org_ai_config:write` | Grant it, or ask an organization administrator |
| "The provider rejected this key." | The provider's verification call refused the key | Check the key with the provider; nothing was stored |
| The policy panel says it is unavailable | The viewer cannot read `GET /api/org-settings` | Grant `org_settings:read`, or ignore: the keys still work |

## Links

- [Package README](../../README.md)
- [API slice](../../../platform-api/src/ai/README.md)
- [Contract](../../../platform-contract/src/ai/README.md)
- [Spec: AI platform](../../../../docs/specs/ai-platform.md)
- [Settings UI spec](../../../../docs/specs/settings-ui.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)
