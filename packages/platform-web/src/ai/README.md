# @marinoscar/platform-web/ai

`@marinoscar/platform-web/ai`: the browser side of the AI slice, in two entry points. `/ai/headless` holds the behaviour without markup: the AI wire types and calls over the host transport (`createAiResponse`, `streamAiResponse`, `getAiAdminConfig`, ... each takes the `PlatformApiClient` first), the hooks behind every AI page (`useAiConfig` with `AiConfigProvider`, `useAiAdminConfig`, `useAiModels`, `useAiUsage`, `useUserAiKeys`, `useUsableAiModels`, `useAiChat`, `useAiRun`, `useAiRealtimeSession`, `useMicrophonePermission`, `useAiUserSettings`), the organization tier (`useOrgAiKeys`, `useOrgAiPolicy`, #739) and the slots the app fills (`AiWebAdaptersProvider`). `/ai/ui` holds the `RequireAiEnabled` route guard, the AI provider card registry (`registerAiProviderCard`, #924), the Playground mode registry (`registerAiPlaygroundMode`, #935) and the pages: the Organization AI keys page (the default export), the admin AI, AI Models and AI Usage pages, the user AI Keys page and the Playground (#890), each also a subpath of its own for one lazy chunk per route. Depends on `core`, `settings`, `storage` and `datatable` (`packages/platform-slices.json`): the hooks call the API through the host's `api` (or an injected one), the pages read permissions from `usePlatformViewer()`, uploads go through the storage objects client and the default model through the settings slice's `useUserSettings`.

## Purpose and scope

Does: let an organization administrator store, replace and remove the organization's own key per provider (verified by the provider before it is stored; write-only, shown afterwards only by its last four characters), and see the policy that applies to the organization's members (the deployment's, narrowed by the organization's own `ai` overrides).

Does not: decide anything. Every permission is enforced by the API (`org_ai_config:read` to see, `org_ai_config:write` to change, in the active organization); the page only disables controls. The organization's `ai` overrides themselves are edited on the Organization settings page (the settings slice). Which cards exist, with which `permission` and `feature: 'ai'`, stays the app's registries' job (`adminSections.tsx`, `userSettingsSections.tsx`); the pages are bound to the reference app's routes (`/settings/ai`, `/admin/settings/ai/models`, `/admin/settings/jobs`) for their links.

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { useOrgAiKeys, useOrgAiPolicy } from '@marinoscar/platform-web/ai/headless';
import OrgAiKeysPage, { ORG_AI_KEYS_DESCRIPTION } from '@marinoscar/platform-web/ai/ui';
// the card registry alone, without the pages (an app's main chunk):
import { registerAiProviderCard } from '@marinoscar/platform-web/ai/ui/provider-cards';
// the playground mode registry alone (an app's main chunk):
import { registerAiPlaygroundMode } from '@marinoscar/platform-web/ai/ui/playground-modes';
// one chunk per route:
const AiModelsPage = lazy(() => import('@marinoscar/platform-web/ai/ui/models-page'));
```

`/ai/headless` needs `react`; `/ai/ui` also `@mui/material`, `@emotion/*` and `react-router-dom` (the pages redirect and link). Both depend on `@marinoscar/platform-contract` (the org-key and policy types). Mount `PlatformHostProvider` (from `/core`) above the pages. Mount `AiConfigProvider` once around the signed-in shell (it fetches `GET /ai/config` for every `useAiConfig` and `useAiFeatures` below it; it usually sits above the host, so pass it the app's transport as `api`). Mount `AiWebAdaptersProvider` to hand in the app's spinner.

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

### A provider an app added

An app or package adds an AI provider on the API side with `registerAiProvider` (`@marinoscar/platform-api/ai`). The web side needs **no code**: `GET /api/admin/ai/config` serves a descriptor for each provider (`descriptors`, one `PluggableDescriptor` per registered provider) and the admin AI page draws every provider that has no registered card with `AiGenericProviderCard`: the Enabled switch, one control per settings field through the settings slice's `PluggableConfigForm` (a select for an enum, a text input for a string, ...), and, when the provider needs a key, a write-only key field with Save key, Test and Remove key against the deployment-key route (`PUT`/`DELETE /api/admin/ai/providers/:provider/key`). Enabled and the settings save with the page's one `PUT /admin/ai/config` as `{ enabled, ...settings }`; the key never enters that form. The endpoint rule (`requiresBaseUrl`) and help texts (`help.key`, `help.baseUrl`) come from the provider's definition through the API. The user and organization key pages list providers from the API too, so the new provider appears there with nothing registered.

To replace the generated card for one provider, register a component for its id at module scope:

```tsx
import { AiGenericProviderCard, registerAiProviderCard } from '@marinoscar/platform-web/ai/ui/provider-cards';

registerAiProviderCard('example-transcribe', (props) => <AiGenericProviderCard {...props} />);
```

The five built-in providers register their bespoke cards through this same registry (an app's registration for an id wins over a built-in's, whichever module loads first). A card receives `AiProviderCardProps`: the provider as the API describes it, the editable `AiProviderFormValue` (`value.settings` holds a provider's own settings), the key actions and their state, and the `descriptor`. A runnable example: [`example-provider-card.test.tsx`](../../../../apps/web/src/__tests__/examples/ai/example-provider-card.test.tsx).

### A capability and a playground mode an app added

An app adds a model capability, an operation and a feature on the API side (`registerAiCapability`, `registerAiOperation`, `registerAiFeature`: the [API slice README](../../../platform-api/src/ai/README.md#adding-a-capability-and-an-operation)). The web needs no code to show it:

- **Labels.** The admin Models page reads `GET /api/admin/ai/capabilities` (`useAiCapabilities`) and offers an app's capability in its **Capability** filter and as **Other capabilities** in the **Edit capabilities** dialog, with the labels the API reports; every capability chip then reads them. A page a viewer without `ai_config:read` sees (the Playground, the user pages) cannot read that route, so register the label at module scope with `registerAiCapabilityLabel('speaker_diarization', 'Diarization')`; without one the chip shows the id.
- **Usage.** The AI Usage page groups by **Feature** and **Operation**, and shows a **Cost** tile and column when the deployment binds a price list (`AiModule.forRoot({ pricing })`).
- **Transcripts.** A transcription run's `output.extras` (a provider's own detail, bounded) is typed as `AiTranscriptionExtras`, and `AiTranscript` draws speaker-labelled `extras.segments` as a **Speakers** list. `AiTranscribeMode` takes a `providerOptions` prop so an app's mode can send a provider option with every request.
- **A Playground mode.** `registerAiPlaygroundMode` at module scope (the six built-in modes register through the same function):

```tsx
import { registerAiPlaygroundMode } from '@marinoscar/platform-web/ai/ui/playground-modes';

registerAiPlaygroundMode({
  id: 'diarize',                        // ^[a-z][a-z0-9-]{0,31}$
  label: 'Diarize',
  operation: 'audio.diarize',           // the usage operation the mode exercises
  capability: 'speaker_diarization',    // models are listed by this capability (default: the operation id)
  Panel: DiarizePanel,                  // receives { models, preferredModel, ready }
});
```

The mode appears after the built-ins, lists the usable models that declare its capability, is disabled with `unavailableReason` when there are none, and its `Panel` is mounted once visited (so its inputs survive a mode switch). A registration with a built-in's id replaces that mode where it stands. The registry file imports no panel, so registering from the main chunk does not pull the playground in; reuse the packaged Transcribe panel with `AiTranscribeMode` from `/ai/ui/playground-page` (lazily). A runnable example: [`example-playground-mode.test.tsx`](../../../../apps/web/src/__tests__/examples/ai/example-playground-mode.test.tsx).

## Configuration

The pages take no props. Each hook takes `{ api? }` (`AiHookOptions`): the transport (default: the platform host's, or a transport whose calls reject with "No platform transport is available"). `AiWebAdaptersProvider` takes `adapters: AiWebAdapters`, a module constant with one optional member: `Spinner` (default an MUI `CircularProgress`). The model catalogue and the usage breakdowns draw through the datatable slice's `DataTable` directly (#899).

| Option | Type | Default | Meaning |
|---|---|---|---|
| `api` | `PlatformApiClient` | the platform host's `api` | The client the hook calls `/admin/ai/org-keys` or `/org-settings` with |

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `OrgAiKeysPage` | component | `OrgAiKeysPage(): ReactElement` | Route the Organization AI keys page behind `org_ai_config:read` | experimental | [example](../../../../apps/web/src/App.tsx) |
| `RequireAiEnabled` | component | `RequireAiEnabled(props: { children; fallback? }): ReactElement` | Gate an AI route on the kill switch, inside `RequirePermission` (import from `/ai/ui/require-ai-enabled` to keep the pages out of the main chunk) | experimental | [example](../../../../apps/web/src/App.tsx) |
| `registerAiProviderCard` | registry | `registerAiProviderCard(id: string, Component: ComponentType<AiProviderCardProps>): void` | Draw one provider's card on the admin AI page with your own component instead of the generated one (import from `/ai/ui/provider-cards` to keep the pages out of the main chunk) | experimental | [example](../../../../apps/web/src/__tests__/examples/ai/example-provider-card.test.tsx) |
| `AiGenericProviderCard` | component | `AiGenericProviderCard(props: AiProviderCardProps): ReactElement` | The card drawn for any provider without a registered card; wrap it in a registered card to add to it | experimental | [example](../../../../apps/web/src/__tests__/examples/ai/example-provider-card.test.tsx) |
| `AiProviderCardProps` | slot | `{ provider; descriptor?; value; onChange; canWrite; errors?; aiEnabled; keyAction; busy; keyError; onSaveKey; onRemoveKey; onTest; ... }` | The props of a registered provider card: the API's view of the provider, its editable form value and the immediate key actions | experimental | [example](../../../../apps/web/src/__tests__/examples/ai/example-provider-card.test.tsx) |
| `AiConfigPageSlots` | slot | `{ ...PageSlotsBase; ProviderCardExtra?: PageSlot<{ provider; canWrite; aiEnabled }> }` | Add a note, link or setting under each provider's card on the admin AI page, or a banner or section around the page, without a fork | experimental | [example](../../../../apps/web/src/__tests__/examples/ai/ai-page-slots.test.tsx) |
| `AiModelsPageSlots` | slot | `{ ...PageSlotsBase; ...TableSlots<AiModel> }` | Add a column, a per-model action, a detail view or toolbar controls to the model catalogue | experimental | [example](../../../../apps/web/src/__tests__/examples/ai/ai-page-slots.test.tsx) |
| `AiUsagePageSlots` | slot | `{ ...PageSlotsBase; ...TableSlots<AiUsageSeriesEntry> }` | Shape the usage breakdown table (a cost column, a drill-down link) or add sections to the usage page | experimental | [example](../../../../apps/web/src/__tests__/examples/ai/ai-page-slots.test.tsx) |
| `UserAiKeysPageSlots` | slot | `PageSlotsBase` | Add a key that is not an AI provider's (a search API) beside the user's AI keys | experimental | [example](../../../../apps/web/src/__tests__/examples/ai/ai-page-slots.test.tsx) |
| `OrgAiKeysPageSlots` | slot | `PageSlotsBase` | Add a banner or a section to the Organization AI keys page | experimental | [example](../../../../apps/web/src/__tests__/examples/ai/ai-page-slots.test.tsx) |
| `AiPlaygroundPageSlots` | slot | `PageSlotsBase` | Add a banner or a section to the AI playground; a custom `Header` receives the "New conversation" button as `actions` | experimental | [example](../../../../apps/web/src/__tests__/examples/ai/ai-page-slots.test.tsx) |
| `registerAiPlaygroundMode` | registry | `registerAiPlaygroundMode(def: AiPlaygroundModeDefinition): void` | Add a mode to the AI Playground, or replace a built-in's panel; call it at module scope (import from `/ai/ui/playground-modes` to keep the pages out of the main chunk) | experimental | [example](../../../../apps/web/src/platform-extensions/ai/diarize-playground-mode.example.tsx) |
| `AiPlaygroundModeDefinition` | registry | `{ id; label; operation; capability?; unavailableReason?; Panel: ComponentType<AiPlaygroundPanelProps> }` | Describe a mode: the operation it exercises, the capability a model needs to be listed and its work area | experimental | [example](../../../../apps/web/src/platform-extensions/ai/diarize-playground-mode.example.tsx) |
| `registerAiCapabilityLabel` | registry | `registerAiCapabilityLabel(id: string, label: string): void` | Give the pages the label of a capability an app registered on the API, for a page a viewer without `ai_config:read` sees | experimental | [example](../../../../apps/web/src/platform-extensions/ai/diarize-playground-mode.example.tsx) |
| `AiWebAdapters` | option | `{ Spinner?: ComponentType<AiSpinnerProps> }` | Draw the AI pages' loading state with the app's own spinner | experimental | [example](../../../../apps/web/src/platform/aiAdapters.ts) |
| `AiWebAdaptersProvider` | component | `AiWebAdaptersProvider(props: { adapters: AiWebAdapters; children }): ReactElement` | Hand the app's adapters to every AI page below it | experimental | [example](../../../../apps/web/src/platform/shellProviders.tsx) |
| `AiConfigProvider` | component | `AiConfigProvider(props: { api?: PlatformApiClient; children }): ReactElement` | Fetch `GET /ai/config` once for the shell, above the host | experimental | [example](../../../../apps/web/src/platform/shellProviders.tsx) |

## Data

None. The page reads and writes through the API; no browser storage.

## Permissions and settings

Reads `org_ai_config:write` from the viewer to enable the Save and Remove controls of the Organization AI keys page; the card and the route gate on `org_ai_config:read`, the literal `@marinoscar/platform-api/ai`'s `org-keys.controller.ts` enforces. The admin pages gate on `ai_config:read` (and show their controls for `ai_config:write`), the user pages on `ai:use`, as the API's controllers do; each page also redirects to `/` without its read permission (defence, not the gate: the route's guard and the API are). The default model is `user_settings.ai.defaultModel`, read and written through the settings slice.

## UI

Six pages (the admin AI page draws each provider with a registered card, or the generated card; see "A provider an app added"). The pages moved in #890 keep the DOM and `sx` they had in the reference app, so its visual baselines are unchanged; the spinner comes from the app through the adapters and the tables from the datatable slice. `AiConfigPage` (`/admin/settings/ai`: switch AI on, the key policy, providers and their keys, limits), `AiModelsPage` (the model catalogue), `AiUsagePage` (usage by user, model, provider, key source and organization), `UserAiKeysPage` (the caller's own keys, default model and usage) and `AiPlaygroundPage` (chat, image, transcription, speech, embeddings and voice).

`OrgAiKeysPage`: `OrgAiKeysPage`: an info note on how organization keys are used (a member's own key still comes first), one row per provider (masked status, a key field, Save and Remove), and the effective policy (enabled, key policy, providers on, per-organization caps). The app's MUI theme styles it. Errors are shown in an `alert`; a key the provider rejects reads "The provider rejected this key. Nothing was saved."

Every page takes one optional `slots` prop ([Page slots](../core/README.md#page-slots)): `Header`, `BeforeContent`, `Sections` (at both ends), `AfterContent`. `AiConfigPage` also takes `ProviderCardExtra` (called once per listed provider, drawn under its card with `{ provider, canWrite, aiEnabled }`: data, never a client); `AiModelsPage` and `AiUsagePage` take the table slots (`Columns`, `RowActions`, `DetailPanel`, `Toolbar`; the usage slots shape the breakdown table, `AiUsageTable` takes the same `slots` for an app that draws it itself). With no slot the markup is unchanged (`test/ai/AiPages.builtin-dom.test.tsx` pins it against a snapshot recorded from the pages before the change).

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

New subpaths in #739: `/ai/headless` and `/ai/ui`. In #899: the AI slice now depends on `datatable` and draws the model catalogue and usage breakdowns with its `DataTable`; `AiWebAdapters.DataTable` and the `AiDataTable*`/`AiTable*` types are gone (the pages' columns are `DataTableColumn`s). `/ai/ui/require-ai-enabled` (the `RequireAiEnabled` route guard, also exported by `/ai/ui`). In #890: `/ai/ui/config-page`, `/models-page`, `/usage-page`, `/keys-page` and `/playground-page`. The AI calls moved from the reference app's `services/ai.ts`: each now takes the `PlatformApiClient` as its first argument, and the hooks take `{ api? }` last. `PlatformApiClient` gained an optional `postFormData`, and `PlatformRequestOptions` gained `jsonBody` (a DELETE body); an app whose `createPlatformApiClient` is current has both.

#935 (PP-14.17): additive. New subpath `/ai/ui/playground-modes` (also exported by `/ai/ui`): `registerAiPlaygroundMode`, `getAiPlaygroundMode`, `listAiPlaygroundModes` and their types. The fixed `AI_PLAYGROUND_MODES` tuple is gone: `listAiPlaygroundModes()` replaces it, and `AiPlaygroundModeId` widens to `Builtin | (string & {})`. `AiModePlaceholder` is removed (a mode now always has a `Panel`). `/ai/headless` gains `useAiCapabilities`, `getAiCapabilities`, `registerAiCapabilityLabel`, the `AiCapabilityDescriptor`, `AiOperationDescriptor`, `AiCapabilitiesResponse`, `AiUsageCost` and `AiTranscriptionExtras` types, `feature` and `operation` in `AI_USAGE_ADMIN_GROUP_BY`, `AiUsageQuery.feature`, `AiUsageReport.priced` and `cost` on a usage entry. `/ai/ui/playground-page` also exports `AiTranscribeMode`. The Models page's DOM is unchanged until an app capability exists; the usage page shows Cost only for a priced report.

#924 (PP-14.6): additive. New subpath `/ai/ui/provider-cards` (also exported by `/ai/ui`): `registerAiProviderCard`, `getAiProviderCard`, `AiGenericProviderCard` and the card prop types. `AiAdminProvider` gained `settings`, `requiresBaseUrl` and `help`, `AiAdminConfig` gained `descriptors`, and `AiProviderSettingsField` is now `string` (the five built-in names are `BuiltinAiProviderSettingsField`); `AiProviderSettingsInput` accepts any provider setting. The endpoint-required rule and the endpoint help text are read from the API, not from the provider id. The built-in cards' markup is unchanged. The ai slice now imports `PluggableConfigForm` through the settings slice's entry (an edge already in `platform-slices.json`).

#942 (PP-14.24): additive. `AiConfigPage`, `AiModelsPage`, `AiUsagePage`, `UserAiKeysPage`, `OrgAiKeysPage` and `AiPlaygroundPage` take an optional `slots` prop (the page-slot contract of `@marinoscar/platform-web/core`); `AiConfigPage` also `ProviderCardExtra`, the model and usage pages the table slots. `AiUsageTable` takes an optional `slots` (`Columns`, `RowActions`, `DetailPanel`). The page types are exported from `/ai/ui` (`AiConfigPageSlots`, `AiProviderCardExtraProps`, ...). A page given no slots renders the markup it always did.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The card is missing | AI is off, or the viewer lacks `org_ai_config:read` in the active organization | Switch AI on at `/admin/settings/ai`; grant the permission (the `org_admin` membership role holds it) |
| Save and Remove are disabled | The viewer lacks `org_ai_config:write` | Grant it, or ask an organization administrator |
| "The provider rejected this key." | The provider's verification call refused the key | Check the key with the provider; nothing was stored |
| A provider an app registered is missing from the admin page | The API did not list it: its module is not imported (`AiModule.forRoot({ providers })`) or the registration ran after bootstrap | Register it at import time, before `AiModule.forRoot()`; see the API slice README |
| A provider shows "Registered, not configurable yet" | An adapter was registered without a provider definition (`registerAiProvider`) | Register a definition; the page then draws the generated card |
| The policy panel says it is unavailable | The viewer cannot read `GET /api/org-settings` | Grant `org_settings:read`, or ignore: the keys still work |

## Links

- [Package README](../../README.md)
- [API slice](../../../platform-api/src/ai/README.md)
- [Contract](../../../platform-contract/src/ai/README.md)
- [Spec: AI platform](../../../../docs/specs/ai-platform.md)
- [Settings UI spec](../../../../docs/specs/settings-ui.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)
