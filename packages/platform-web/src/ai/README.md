# @marinoscar/platform-web/ai

`@marinoscar/platform-web/ai`: the browser side of the AI slice's organization tier (issue #739, PP-8.6), in two entry points. `/ai/headless` holds the behaviour without markup: `useOrgAiKeys` (the active organization's own provider keys, masked, with set and remove over `/api/admin/ai/org-keys`) and `useOrgAiPolicy` (the organization's effective `ai` policy, read-only, from `GET /api/org-settings`). `/ai/ui` holds the Organization AI keys page. Depends on the `core` slice only (`packages/platform-slices.json`): the hooks call the API through the host's `api` (or an injected one), the page reads permissions from `usePlatformViewer()`.

## Purpose and scope

Does: let an organization administrator store, replace and remove the organization's own key per provider (verified by the provider before it is stored; write-only, shown afterwards only by its last four characters), and see the policy that applies to the organization's members (the deployment's, narrowed by the organization's own `ai` overrides).

Does not: decide anything. Every permission is enforced by the API (`org_ai_config:read` to see, `org_ai_config:write` to change, in the active organization); the page only disables controls. The organization's `ai` overrides themselves are edited on the Organization settings page (the settings slice). The other AI pages (AI, AI Models, AI Usage, AI Keys, the Playground) are still the reference app's (`apps/web/src/pages`); moving them is a follow-up.

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { useOrgAiKeys, useOrgAiPolicy } from '@marinoscar/platform-web/ai/headless';
import OrgAiKeysPage, { ORG_AI_KEYS_DESCRIPTION } from '@marinoscar/platform-web/ai/ui';
```

`/ai/headless` needs `react`; `/ai/ui` also `@mui/material` and `@emotion/*`. Both depend on `@marinoscar/platform-contract` (the org-key and policy types). Mount `PlatformHostProvider` (from `/core`) above the page.

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

The page takes no props. Each hook takes `{ api? }`: the transport (default: the platform host's).

| Option | Type | Default | Meaning |
|---|---|---|---|
| `api` | `PlatformApiClient` | the platform host's `api` | The client the hook calls `/admin/ai/org-keys` or `/org-settings` with |

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `OrgAiKeysPage` | component | `OrgAiKeysPage(): ReactElement` | Route the Organization AI keys page behind `org_ai_config:read` | experimental | [example](../../../../apps/web/src/App.tsx) |

## Data

None. The page reads and writes through the API; no browser storage.

## Permissions and settings

Reads `org_ai_config:write` from the viewer to enable the Save and Remove controls. The card and the route gate on `org_ai_config:read`, the literal `@marinoscar/platform-api/ai`'s `org-keys.controller.ts` enforces.

## UI

One page, `OrgAiKeysPage`: an info note on how organization keys are used (a member's own key still comes first), one row per provider (masked status, a key field, Save and Remove), and the effective policy (enabled, key policy, providers on, per-organization caps). The app's MUI theme styles it. Errors are shown in an `alert`; a key the provider rejects reads "The provider rejected this key. Nothing was saved."

## Infra

None. A browser bundle.

## Observability

None of its own: the API logs and audits every key change (`org_ai_config:set_key`, `org_ai_config:delete_key`).

## Security notes

- **Write-only key.** The key is typed, sent once in the `PUT` body and never held after the request; the page shows only the stored hint. No browser storage is used.
- **No client authorization.** Hiding or disabling a control is presentation; the API refuses a caller without the permission in the active organization.

## Conformance suite

None. `test/ai/OrgAiKeysPage.test.tsx` covers the page (listing, read-only mode, set, a rejected key, remove), and the reference app's web conformance suites (`settings-ai-cards`, run from `apps/web/src/__tests__/conformance.test.ts`) and `settingsCards.test.ts` pin the card's permission and feature gate.

## Upgrade notes

New subpaths in this version (#739): `/ai/headless` and `/ai/ui`.

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
