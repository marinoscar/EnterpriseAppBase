# @marinoscar/platform-web/alerts

The alerts UI (issue #1047, epic #1044), on `@marinoscar/platform-api/alerts`'s routes (`/api/admin/alerts`) and `@marinoscar/platform-contract/alerts`' shapes. `/headless` holds the client (`createAlertsApi`), the hooks (rules, one rule, the kinds, a page of incidents, one incident, the firing summary polled every 30 seconds, the metric catalog the editor picks from, the writes), the rule editor's draft model and alerts in words. `/ui` holds `AlertsPage` (Rules and Incidents tabs), the rule editor, the dry-run result, the incident drawer, `FiringAlertsBanner` for the telemetry dashboard and the admin card as data. It depends on the `core` and `datatable` slices (`packages/platform-slices.json`).

## Purpose and scope

Let the deployment's administrators decide what they want to be told about, and see what fired:
- **Rules.** A table with each rule's enable switch, name (with "Built-in" for a starter rule), kind, severity, last evaluation and last error. "New rule" and a row's Edit open the editor; Test runs a dry run and lists what the rule observes right now (nothing is stored, nothing is sent).
- **The editor** picks the kind first (fixed once the rule exists), then shows the kind's form: `metric_threshold` (metric picked from the telemetry store's table list or typed, aggregation, window, comparator, threshold, up to three group-by attributes and five filters), `node_event` (event types from `NODE_EVENT_TYPES` of `@marinoscar/platform-contract/nodes` or a `prefix.*`, least severity, node ids, required attributes, recovery events and the auto-resolve delay), `verdict` (least level), `node_offline` and `telemetry_unavailable` (nothing to configure); an app's own kind is edited as JSON. Then severity, `for`, cooldown, notification channels and the webhook toggle. A built-in rule can be edited and disabled, never deleted: the editor draws no Delete for it.
- **Incidents.** Filtered by state and severity, server-paginated, each opening a drawer with its labels, timeline, last value and summary, and Acknowledge.
- **The banner.** `FiringAlertsBanner` shows how many alerts are firing by severity and links to the Incidents tab. It draws nothing while nothing fires.

Not here: evaluating rules, the incident state machine, notifications and webhooks (`@marinoscar/platform-api/alerts`), the wire shapes (`@marinoscar/platform-contract/alerts`), and the app's registry entry and route (the app owns its registries). The telemetry slice does not depend on this one: the app passes the banner to the dashboard's `BeforeContent` slot.

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { createAlertsApi, useAlertSummary } from '@marinoscar/platform-web/alerts/headless';
import { AlertsPage, FiringAlertsBanner, alertsAdminCards } from '@marinoscar/platform-web/alerts/ui';
```

`/ui` needs `react`, `@mui/material`, `@mui/icons-material`, `react-router-dom` (the page keeps its tab in the URL; the banner links with the router), and through the `datatable` slice the optional peer `@mui/x-data-grid`. `/headless` needs `react` only.

## Quick start

The reference app spreads the card into its Observability section, routes the page and puts the banner on the telemetry dashboard ([`apps/web/src/config/adminSections.tsx`](../../../../apps/web/src/config/adminSections.tsx), [`apps/web/src/App.tsx`](../../../../apps/web/src/App.tsx)):

```tsx
// adminSections.tsx, Observability
cards: [...telemetryAdminCards, doctorCard, ...alertsAdminCards],

<Route path="/admin/settings/alerts" element={
  <RequirePermission permission="alerts:read"><AlertsPage /></RequirePermission>
} />
<TelemetryDashboardPage slots={{ BeforeContent: () => <FiringAlertsBanner /> }} />
```

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `AlertsPage` `slots` | `AlertsPageSlots` | none | The page-slot contract (`Header`, `BeforeContent`, `Sections`, `AfterContent`) |
| `AlertsPage` `channels` | `readonly string[]` | `email`, `browser`, `push` | The notification channel ids the editor offers (an app with its own channel adds it) |
| `FiringAlertsBanner` `to` | `string` | `/admin/settings/alerts?tab=incidents` | Where "View incidents" goes |
| `FiringAlertsBanner` `intervalMs` | `number` | `30000` | The summary's poll interval |
| `useAlertSummary` `options` | `{ enabled?, intervalMs? }` | enabled, 30 s | `intervalMs: 0` turns polling off; polling stops while the tab is hidden |
| `useAlertIncidents` `query` | `{ state?, severity?, ruleId?, page?, pageSize? }` | the API's first page of 20 | One-based page, page size and filters |

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `createAlertsApi` | hook | `createAlertsApi(api: PlatformApiClient): AlertsApi` | Call the alerts routes outside the hooks | experimental | [example](../../../../apps/web/src/__tests__/platform/alerts.test.tsx) |
| `useAlertRules` | hook | `useAlertRules(query?: AlertRulesQuery): AlertRulesState` | The rules, filtered | experimental | [example](../../../../apps/web/src/__tests__/platform/alerts.test.tsx) |
| `useAlertRule` | hook | `useAlertRule(id \| null): AlertRuleState` | One rule | experimental | [example](../../../../apps/web/src/__tests__/platform/alerts.test.tsx) |
| `useAlertKinds` | hook | `useAlertKinds(options?: { enabled? }): AlertKindsState` | The registered rule kinds | experimental | [example](../../../../apps/web/src/__tests__/platform/alerts.test.tsx) |
| `useAlertIncidents` | hook | `useAlertIncidents(query?: AlertIncidentsQuery): AlertIncidentsState` | A page of incidents, filtered | experimental | [example](../../../../apps/web/src/__tests__/platform/alerts.test.tsx) |
| `useAlertIncident` | hook | `useAlertIncident(id \| null): AlertIncidentState` | One incident | experimental | [example](../../../../apps/web/src/__tests__/platform/alerts.test.tsx) |
| `useAlertSummary` | hook | `useAlertSummary(options?: { enabled?; intervalMs? }): AlertSummaryState` | The firing counts, polled while the tab is visible | experimental | [example](../../../../apps/web/src/__tests__/platform/alerts.test.tsx) |
| `useAlertMetricCatalog` | hook | `useAlertMetricCatalog(options?: { enabled? }): AlertMetricCatalogState` | The metrics a metric rule may name | experimental | [example](../../../../apps/web/src/__tests__/platform/alerts.test.tsx) |
| `useAlertMutations` | hook | `useAlertMutations(): AlertMutations` | Create, update, toggle, delete, test and acknowledge, errors in words | experimental | [example](../../../../apps/web/src/__tests__/platform/alerts.test.tsx) |
| `AlertsPage` | component | `AlertsPage(props?: { slots?: AlertsPageSlots; channels? }): ReactElement` | Route the Alerts page | experimental | [example](../../../../apps/web/src/App.tsx) |
| `AlertsPageSlots` | slot | `PageSlotsBase` | Add a notice or a section, or replace the header, without a fork | experimental | [example](../../../../apps/web/src/__tests__/platform/alerts.test.tsx) |
| `AlertRuleDialog` | component | `AlertRuleDialog(props: { open; rule; kinds; metrics?; readOnly?; onSubmit; onTest?; onDelete?; onClose; ... }): ReactElement` | The rule editor on a page of your own | experimental | [example](../../../../apps/web/src/__tests__/platform/alerts.test.tsx) |
| `AlertRuleTestResult` | component | `AlertRuleTestResult(props: { result: AlertRuleTestResponse }): ReactElement` | Show a dry run's observations | experimental | [example](../../../../apps/web/src/__tests__/platform/alerts.test.tsx) |
| `AlertIncidentDrawer` | component | `AlertIncidentDrawer(props: { incidentId; canWrite; onAcknowledge; acknowledging?; onClose }): ReactElement` | Show one incident with Acknowledge | experimental | [example](../../../../apps/web/src/__tests__/platform/alerts.test.tsx) |
| `FiringAlertsBanner` | component | `FiringAlertsBanner(props?: { to?; intervalMs? }): ReactElement \| null` | Show what is firing on the telemetry dashboard or any page | experimental | [example](../../../../apps/web/src/App.tsx) |
| `alertsAdminCards` | component | `readonly AlertsAdminCard[]` | The Observability card (`alerts:read`) | experimental | [example](../../../../apps/web/src/config/adminSections.tsx) |

## Data

None. The UI reads and writes `/api/admin/alerts` and reads `/api/admin/telemetry/schema` for the metric picker; it stores nothing in the browser. The tables keep their layout through the datatable slice's preferences (`tableId` `alert-rules` and `alert-incidents`).

## Permissions and settings

Reads need `alerts:read`, writes `alerts:write`, the exact strings of `ALERT_PERMISSIONS` (system permissions of the `admin` role). The card declares `alerts:read` and carries no `feature` (node rules work with telemetry off). The page draws its write controls (New rule, the enable switch, Edit, Test, Delete, Acknowledge) only for a holder of `alerts:write`, and says "(read-only)" in its heading otherwise; a read-only viewer opens a rule in a disabled form. The banner draws nothing for a viewer without `alerts:read`. The metric picker's list needs `telemetry:query`; without it (or with telemetry off) the picker takes a typed name. That only hides controls: the API enforces every permission. It reads no setting.

## UI

- **Pages.** `AlertsPage` at `/admin/settings/alerts` (the `Observability` group). Its two tabs are parallel content inside the one destination; `?tab=incidents` selects the second.
- **Page slots.** The packaged-page slot contract (`PageSlotsBase`, [Page slots](../core/README.md#page-slots)): `Header` (gets `{ title, description, readOnly, actions: null }`), `BeforeContent`, `Sections` (`top` and `bottom`) and `AfterContent`. With no slot the markup is the page's own.
- **Phones.** The tables draw their card lists below 600 px, a row's actions sit in its "Row actions" menu, the editor opens full screen, its paired fields stack, and the incident drawer takes the full width.
- **Words, not colour.** Severities (Critical, Warning, Info), states (Pending, Firing, Resolved) and dry-run observations (Breached, OK) are labelled chips.
- **Accessibility.** Buttons are at least 44 px high, dialogs and the drawer are labelled, each enable switch is named "Enable/Disable <rule>", and the tabs carry their panel relation.

## Infra

None.

## Observability

None client-side. The API counts transitions (`app.alerts.transitions`) and gauges firing incidents (`app.alerts.firing`).

## Security notes

- The editor checks the draft against the contract's schemas only to spare a round trip; the API validates every body again and decides.
- The dry run never stores or sends anything; the result panel says so.
- No key, secret or token is handled by this slice.

## Conformance suite

None of its own. The app's registry tests (`apps/web/src/__tests__/config/settingsCards.test.ts`) pin the card's group, position and permission string, and the web conformance suites (`settings-registry-shape`, `settings-card-routes`) check that its path is routed under the permission it declares and that the permission is in the API's catalog.

## Upgrade notes

New in #1047.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The page says "(read-only)" | The viewer lacks `alerts:write` | Grant it |
| The metric picker says the list is not available | Telemetry is off, the store is unreachable, or the viewer lacks `telemetry:query` | Type the metric name, or fix the store |
| A rule shows a last error | Its last evaluation failed (for example, no table for the metric yet) | Open the rule and press Test to see the error now |
| Delete is missing on a rule | It is a built-in rule | Disable it instead |
| The banner never shows | Nothing is firing, or the viewer lacks `alerts:read` | Check the Incidents tab |

## Links

- [Package README](../../README.md)
- [Contract: alerts](../../../platform-contract/src/alerts/README.md)
- [API: alerts](../../../platform-api/src/alerts/README.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)
