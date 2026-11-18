# @marinoscar/platform-web/webhooks

The webhooks UI (issue #1046, epic #1044), on `@marinoscar/platform-api/webhooks`'s routes and `@marinoscar/platform-contract/webhooks`' shapes. `/headless` holds the client of one scope (`createWebhooksApi`), the hooks (endpoints, one endpoint, a page of deliveries, one delivery, the event catalog, the writes) and pure helpers (status in words, the event picker's wildcard model). `/ui` holds `WebhooksPage` (one page for the `user`, `org` and `system` scopes), its dialogs, the delivery drawer, the "Verifying signatures" panel and the settings cards as data. It depends on the `core` and `datatable` slices (`packages/platform-slices.json`).

## Purpose and scope

Let a user, an organization's administrators or the deployment's administrators send signed events to their own HTTPS receivers, and see what was delivered:
- **One page, three scopes.** `<WebhooksPage scope="user" />` manages the caller's own endpoints (`/api/webhooks`), `scope="org"` the organization's (`/api/org/webhooks`), `scope="system"` the deployment's (`/api/admin/webhooks`). The route shape is the same under each base.
- **The list** shows each endpoint's name, URL host, how many events it subscribes to, its status in words (Active, Disabled, or why the platform switched it off: "Paused after repeated failures", "Owner lost access", "Endpoint gone") and its last success.
- **Create and edit** take a name, an https URL, a description, enabled and the events. The event picker groups the catalog by its `group`, searches it, writes `group.*` for "every event in this group" (when that wildcard selects only that group) and `*` for every event.
- **The secret is shown once**, after create and after a rotation, with a copy button; the page forgets it when the dialog closes.
- **An endpoint's detail** has "Send test event", Edit, "Rotate secret" (confirmed, explaining the 24 hour overlap), Delete (confirmed), and its deliveries in a server-paginated `DataTable` filtered by status and event key. A delivery opens in a drawer with its pretty-printed payload, its request headers (never the signature), the response snippet and Redeliver.

Not here: emitting events, signing, the SSRF guard and delivery (`@marinoscar/platform-api/webhooks`), the wire shapes and `verifyWebhookSignature` (`@marinoscar/platform-contract/webhooks`), and the app's registry entries and routes (the app owns its registries).

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { createWebhooksApi, useWebhookEndpoints } from '@marinoscar/platform-web/webhooks/headless';
import { WebhooksPage, webhooksAdminSections, webhooksUserSettingsSections } from '@marinoscar/platform-web/webhooks/ui';
```

`/ui` needs `react`, `@mui/material`, `@mui/icons-material`, and through the `datatable` slice the optional peer `@mui/x-data-grid`. `/headless` needs `react` only.

## Quick start

The reference app spreads the cards into its registries and routes the page once per scope ([`apps/web/src/config/adminSections.tsx`](../../../../apps/web/src/config/adminSections.tsx), [`apps/web/src/config/userSettingsSections.tsx`](../../../../apps/web/src/config/userSettingsSections.tsx), [`apps/web/src/App.tsx`](../../../../apps/web/src/App.tsx)):

```tsx
{ label: 'Integrations', cards: [...webhooksUserSettingsSections.integrations] },
// Operations: ...webhooksAdminSections.operations; Organizations: ...webhooksAdminSections.organizations

<Route path="/settings/webhooks" element={
  <RequirePermission permission="webhooks:read"><WebhooksPage scope="user" /></RequirePermission>
} />
```

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `WebhooksPage` `scope` | `'user' \| 'org' \| 'system'` | required | Which route family and which permissions the page uses |
| `WebhooksPage` `slots` | `WebhooksPageSlots` | none | The page-slot contract plus the deliveries table's `Columns`, `RowActions`, `DetailPanel` and `Toolbar` |
| `useWebhookDeliveries` `query` | `{ page?, pageSize?, status?, eventKey? }` | the API's first page of 20 | One-based page, page size and filters |
| `useWebhookEventCatalog` `options.enabled` | `boolean` | `true` | `false` skips the request (the page loads the catalog only when the form opens) |

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `createWebhooksApi` | hook | `createWebhooksApi(api: PlatformApiClient, scope: WebhookScope): WebhooksApi` | Call a scope's webhook routes outside the hooks | experimental | [example](../../../../apps/web/src/__tests__/platform/webhooks.test.tsx) |
| `useWebhookEndpoints` | hook | `useWebhookEndpoints(scope): WebhookEndpointsState` | The endpoints the caller may see at a scope | experimental | [example](../../../../apps/web/src/__tests__/platform/webhooks.test.tsx) |
| `useWebhookEndpoint` | hook | `useWebhookEndpoint(scope, id \| null): WebhookEndpointState` | One endpoint | experimental | [example](../../../../apps/web/src/__tests__/platform/webhooks.test.tsx) |
| `useWebhookDeliveries` | hook | `useWebhookDeliveries(scope, endpointId \| null, query?): WebhookDeliveriesState` | A page of an endpoint's deliveries, filtered | experimental | [example](../../../../apps/web/src/__tests__/platform/webhooks.test.tsx) |
| `useWebhookDelivery` | hook | `useWebhookDelivery(scope, deliveryId \| null): WebhookDeliveryState` | One delivery with its payload and headers | experimental | [example](../../../../apps/web/src/__tests__/platform/webhooks.test.tsx) |
| `useWebhookEventCatalog` | hook | `useWebhookEventCatalog(scope, options?: { enabled? }): WebhookEventCatalogState` | The events the caller may subscribe to, grouped | experimental | [example](../../../../apps/web/src/__tests__/platform/webhooks.test.tsx) |
| `useWebhookMutations` | hook | `useWebhookMutations(scope): WebhookMutations` | Create, update, delete, rotate, test and redeliver, errors in words | experimental | [example](../../../../apps/web/src/__tests__/platform/webhooks.test.tsx) |
| `WebhooksPage` | component | `WebhooksPage(props: { scope; slots?: WebhooksPageSlots }): ReactElement` | Route the webhooks page of a scope | experimental | [example](../../../../apps/web/src/App.tsx) |
| `WebhooksPageSlots` | slot | `PageSlotsBase & TableSlots<WebhookDelivery, DataTableColumn<WebhookDelivery>>` | Add a notice or a section, replace the header, or add delivery columns and actions without a fork | experimental | [example](../../../../apps/web/src/__tests__/platform/webhooks.test.tsx) |
| `WebhookEndpointDialog` | component | `WebhookEndpointDialog(props: { open; endpoint; groups; saving?; error?; onSubmit; onClose; ... }): ReactElement` | The create and edit form on a page of your own | experimental | [example](../../../../apps/web/src/__tests__/platform/webhooks.test.tsx) |
| `WebhookEventPicker` | component | `WebhookEventPicker(props: { groups; value; onChange; disabled?; error? }): ReactElement` | Pick event keys, `group.*` and `*` elsewhere | experimental | [example](../../../../apps/web/src/__tests__/platform/webhooks.test.tsx) |
| `WebhookSecretDialog` | component | `WebhookSecretDialog(props: { secret; reason; previousSecretValidUntil?; onClose }): ReactElement` | Show a signing secret once, with a copy button | experimental | [example](../../../../apps/web/src/__tests__/platform/webhooks.test.tsx) |
| `WebhookDeliveryDrawer` | component | `WebhookDeliveryDrawer(props: { scope; deliveryId; canWrite; onRedeliver; redelivering?; onClose }): ReactElement` | Show one delivery with Redeliver | experimental | [example](../../../../apps/web/src/__tests__/platform/webhooks.test.tsx) |
| `WebhookSignatureHelp` | component | `WebhookSignatureHelp(): ReactElement` | The "Verifying signatures" panel on another page | experimental | [example](../../../../apps/web/src/__tests__/platform/webhooks.test.tsx) |
| `webhooksUserSettingsSections` | component | `{ integrations: WebhooksSettingsCard[] }` | The per-user card (`webhooks:read`) | experimental | [example](../../../../apps/web/src/config/userSettingsSections.tsx) |
| `webhooksAdminSections` | component | `{ operations: WebhooksSettingsCard[]; organizations: WebhooksSettingsCard[] }` | The system card (`system_webhooks:read`) and the organization card (`org_webhooks:read`, `feature: 'orgs'`) | experimental | [example](../../../../apps/web/src/config/adminSections.tsx) |

## Data

None. The UI reads and writes `/api/webhooks`, `/api/org/webhooks` and `/api/admin/webhooks` only; it stores nothing in the browser. The tables keep their layout through the datatable slice's preferences (`tableId` `webhook-endpoints-<scope>` and `webhook-deliveries-<scope>`).

## Permissions and settings

Each scope reads with one permission and writes with another, the exact strings of `WEBHOOK_PERMISSIONS` (`WEBHOOK_SCOPE_PERMISSIONS`): `webhooks:read`/`webhooks:write` (an org permission every org role holds; a member sees only their own endpoints), `org_webhooks:read`/`org_webhooks:write` (`org_admin`) and `system_webhooks:read`/`system_webhooks:write` (`admin`). The cards declare the `:read` string; the page draws its write controls (New endpoint, Send test event, Edit, Rotate secret, Delete, Redeliver) only for a holder of the `:write` string, and says "(read-only)" in its heading otherwise. That only hides controls: the API enforces both. The organization card carries `feature: 'orgs'`, like the other organization cards. It reads no setting.

## UI

- **Pages.** `WebhooksPage scope="user"` at `/settings/webhooks` (an `Integrations` group of the user registry), `scope="system"` at `/admin/settings/webhooks` (the `Operations` group) and `scope="org"` at `/admin/settings/organization-webhooks` (the `Organizations` group, multi-organization deployments only).
- **Page slots.** The packaged-page slot contract (`PageSlotsBase`, [Page slots](../core/README.md#page-slots)): `Header` (gets `{ title, description, readOnly, actions: null }`), `BeforeContent`, `Sections` (`top` and `bottom`) and `AfterContent`. The deliveries table takes `Columns`, `RowActions`, `DetailPanel` and `Toolbar`. With no slot the markup is the page's own.
- **Phones.** The tables draw their card lists below 600 px, a row's actions sit in its "Row actions" menu, the form opens full screen and the delivery drawer takes the full width.
- **Status in words.** Endpoints: Active, Disabled, Paused after repeated failures, Owner lost access, Endpoint gone. Deliveries: Queued, Delivering, Delivered, Retrying, Failed. Colour is never the only signal.
- **Accessibility.** Buttons are at least 44 px high, dialogs and the drawer are labelled, every event checkbox is named by its label, and code blocks are focusable for keyboard scrolling.

## Infra

None.

## Observability

None client-side. The API counts deliveries (`app.webhooks.deliveries`) and times them (`app.webhooks.delivery.duration`).

## Security notes

- The signing secret is in the page's state only while its dialog is open, never in a URL, a log or browser storage. Nothing else the API returns carries it.
- The drawer shows the request headers the API returns, which never include `webhook-signature`.
- The form checks only what helps typing (a name, a parsable URL, at least one event). Whether a URL is allowed (https, not a private or internal address) is the API's decision; its refusal is shown in words.

## Conformance suite

None of its own. The app's registry tests (`apps/web/src/__tests__/config/settingsCards.test.ts`, `userSettingsSections.test.ts`) pin the cards' groups and permission strings, and the web conformance suites (`settings-registry-shape`, `settings-card-routes`) check that each card's path is routed under the permission it declares and that the permission is in the API's catalog.

## Upgrade notes

New in #1046.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The page says "(read-only)" | The viewer lacks the scope's `:write` permission | Grant it (`webhooks:write`, `org_webhooks:write` or `system_webhooks:write`) |
| An endpoint shows "Paused after repeated failures" | The receiver kept failing and the circuit breaker switched it off | Fix the receiver, then Edit and save with Enabled on |
| Create says the URL points at a private or internal address | The API's SSRF guard refused it | Use a public https URL, or ask the operator to allow the host |
| The event picker is empty | The caller may subscribe to no event at this scope | Check `GET <base>/events` for the caller |

## Links

- [Package README](../../README.md)
- [Contract: webhooks](../../../platform-contract/src/webhooks/README.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)
