# @marinoscar/platform-web/nodes

`@marinoscar/platform-web/nodes`: the browser side of the worker-node fleet (issue #881, a follow-up of #854 under the platform packages program), in two entry points. `/nodes/headless` holds the behaviour without markup: the fleet and node-credential API client over the app's transport, the wire types (derived from the admin schemas of `@marinoscar/platform-contract/nodes`), the data hooks (the fleet, one node, the credentials, the writes), the visible-tab poll, the adapters and the formatters. `/nodes/ui` holds the Worker Nodes admin page (fleet table, vitals dialog, credential section with its create and show-once dialogs), its header slot, and its registry entry as data. Depends on the `core` slice only (`packages/platform-slices.json`): the hooks call the API through `usePlatformApi()` (or the adapters' client), the page reads permissions from `usePlatformViewer()`. The jobs slice depends on this one and re-exports everything it used to own, so an existing `@marinoscar/platform-web/jobs` import keeps working.

## Purpose and scope

Does: render the Console's Worker Nodes page "packages own behaviour, apps own appearance": the fleet with each node's derived health, operator status and job counts, the last self-reported vitals (compact column, full dialog, fleet-wide saturation and low-disk tallies), the machine the node runs on and its power (a battery or plug badge on the fleet row; host CPU, memory, load and OS in the dialog, #1045), the node's recent events (a paged timeline in the dialog), the delete of a node, and the node credentials (mint with an optional expiry, show the raw `nod_` token once, revoke). The app's MUI theme styles it, the page-slot contract (`slots`, [Page slots](../core/README.md#page-slots)) lets the app add to or replace parts of it, and the nodes adapters hand in the app's spinner, its table and, optionally, its own nodes client.

Does not: decide anything. Every permission is enforced by the API (`@marinoscar/platform-api/nodes`); the page only hides or disables controls. A node's `health` is derived by the API against the `nodes.staleHeartbeatSeconds` setting and is never recomputed here. The slice does not own the app's registries or routes (the app declares the card in `ADMIN_SECTIONS` and the route in its router, CLAUDE.md Settings UI Pattern), import app context, layout or navigation, or ship a data table (the app's comes in through the adapters; a plain MUI table is the fallback). It does not run or enrol a node: that is `@marinoscar/platform-cli/node`.

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { NodesWebAdaptersProvider, createNodesApi, useWorkerNodes } from '@marinoscar/platform-web/nodes/headless';
import { WorkersPage, nodesAdminSections } from '@marinoscar/platform-web/nodes/ui';
```

`/nodes/headless` needs `react`. Its types reference `zod` (a peer of this package) through the contract schemas. `/nodes/ui` also needs `@mui/material`, `@mui/icons-material`, `@emotion/*` and `react-router-dom` (the page redirects). Both depend on `@marinoscar/platform-contract` (installed with this package). Mount `PlatformHostProvider` (from `/core`) above the page.

## Quick start

The reference app binds the slice in three places:

```tsx
// apps/web/src/platform/nodesAdapters.ts: the app's table, spinner and client
export const appNodesAdapters: NodesWebAdapters = { Spinner: LoadingSpinner, DataTable, api: createNodesApi(appPlatformApi) };

// apps/web/src/platform/shellProviders.tsx: the adapters around the signed-in shell
<NodesWebAdaptersProvider adapters={appNodesAdapters}>{shell}</NodesWebAdaptersProvider>

// apps/web/src/App.tsx: the route, behind the card's permission string
const WorkersPage = lazy(() => import('@marinoscar/platform-web/nodes/ui').then((m) => ({ default: m.WorkersPage })));
<Route path="/admin/settings/workers" element={
  <RequirePermission permission="nodes:read" fallback={<Navigate to="/" replace />}><WorkersPage /></RequirePermission>
} />
```

The card itself is `nodesAdminSections.operations`; the app keeps spreading `jobsAdminSections.operations`, which ends with that same card, so the Operations order is Jobs, Job Insights, Worker Nodes.

## Configuration

`NodesWebAdaptersProvider` `adapters` (`NodesWebAdapters`, all optional, a module constant):

| Option | Type | Default | Meaning |
|---|---|---|---|
| `Spinner` | `ComponentType<{ fullScreen? }>` | an MUI `CircularProgress` | The page's first load. |
| `DataTable` | `NodesDataTableComponent` | a plain MUI table | The table the fleet and the credential list render through. The props are a subset of the reference app's `DataTable`, which is assignable without a cast. The fallback draws no filter menu and still confirms destructive row actions. |
| `api` | `NodesApi` | `createNodesApi(usePlatformApi())` | The fleet and credential calls. |

`JobsWebAdaptersProvider` (the jobs slice) mounts a `NodesWebAdaptersProvider` below itself with the same three members, so an app that only wired the jobs adapters needs nothing more; a `NodesWebAdaptersProvider` mounted above it wins.

Page props (all optional; the app's route renders the page as is):

| Page | Prop | Default | Meaning |
|---|---|---|---|
| `WorkersPage` | `slots` | none | The page-slot contract plus `VitalsPanel`; see [Slots](#slots-and-theme). |
| `WorkersPage` | `fallbackPath` | `'/'` | Where a viewer without `nodes:read` is sent. |

Every hook takes an optional `NodesApi` as its last argument (the adapters' client, else `createNodesApi` over the host's transport). The fleet poll runs every `WORKER_NODES_POLL_INTERVAL_MS` (10 s) while the tab is in front.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `NodesApi` | option | `{ getWorkerNodes; getWorkerNode; deleteWorkerNode; getNodeCredentials; createNodeCredential; revokeNodeCredential; listNodeEvents }` | Route the fleet calls through the app's own client, or fake them in a test | experimental | [example](../../../../apps/web/src/platform/nodesAdapters.ts) |
| `NodesWebAdapters` | option | `{ Spinner?; DataTable?; api? }` | Hand the Worker Nodes page the app's spinner, table and client | experimental | [example](../../../../apps/web/src/platform/nodesAdapters.ts) |
| `NodesWebAdaptersProvider` | component | `NodesWebAdaptersProvider(props: { adapters; children }): ReactElement` | Mount the adapters once, around the signed-in shell | experimental | [example](../../../../apps/web/src/platform/shellProviders.tsx) |
| `useWorkerNodes` | hook | `useWorkerNodes(api?: NodesApi): UseWorkerNodesResult` | Build another view of the fleet (a health chip, a count) | experimental | [example](../../../../apps/web/src/nodes/examples.tsx) |
| `useWorkerNode` | hook | `useWorkerNode(id: string \| null, api?: NodesApi): UseWorkerNodeResult` | Show one node (a node page, a dashboard card) | experimental | [example](../../../../apps/web/src/nodes/examples.tsx) |
| `useNodeCredentials` | hook | `useNodeCredentials(api?: NodesApi): UseNodeCredentialsResult` | Build another view of the node credentials | experimental | [example](../../../../apps/web/src/nodes/examples.tsx) |
| `useNodeActions` | hook | `useNodeActions(onChanged?: () => void, api?: NodesApi): UseNodeActionsResult` | Delete a node, or mint or revoke a credential from another surface | experimental | [example](../../../../apps/web/src/nodes/examples.tsx) |
| `useNodeEvents` | hook | `useNodeEvents(nodeId: string \| null, query?: NodeEventsQuery, api?: NodesApi): UseNodeEventsResult` | Show a node's events elsewhere (a node page, a "last critical event" chip); `loadMore` appends the next page | experimental | [example](../../../../apps/web/src/nodes/examples.tsx) |
| `useVisiblePolling` | hook | `useVisiblePolling(callback: () => void, intervalMs: number): void` | Re-read a view while the tab is in front, the way the page does | experimental | [example](../../../../apps/web/src/nodes/examples.tsx) |
| `registerNodeVital` | registry | `registerNodeVital(def: { key: string; label: string; unit: 'count' \| 'percent' \| 'bytes' \| 'milliseconds' \| 'seconds' \| string }): void` | Word an app-defined `vitals.extra` key in the vitals dialog (label and unit); an unregistered key still shows, by its key. Call at module scope, before the page renders | experimental | [example](../../../../apps/web/src/platform-extensions/nodes/transcode.vitals.ts) |
| `WorkersPage` | component | `WorkersPage(props?: WorkersPageProps): ReactElement` | Render the `/admin/settings/workers` route | experimental | [example](../../../../apps/web/src/App.tsx) |
| `WorkersPageProps` | slot | `{ fallbackPath?; slots?: WorkersPageSlots }` | Replace the Worker Nodes page's header or its fallback path | experimental | [example](../../../../apps/web/src/nodes/examples.tsx) |
| `WorkersPageSlots` | slot | `PageSlotsBase & TableSlots<WorkerNode, NodesTableColumn<WorkerNode>> & { Header?; VitalsPanel?: PageSlot<{ node }> }` | Add a banner, a section, a column, a per-node action, a detail view, toolbar controls or a section of the vitals dialog to the Worker Nodes page | experimental | [example](../../../../apps/web/src/platform-extensions/nodes/CopyHostnameAction.example.tsx) |
| `NodeCredentials` | component | `NodeCredentials(props: NodeCredentialsProps): ReactElement` | Embed the credential table with its create and show-once dialogs in another incident-response surface | experimental | [example](../../../../apps/web/src/nodes/examples.tsx) |
| `nodesAdminSections` | component | `{ operations: NodesSettingsCard[] }` | Spread the Worker Nodes card into the app's `ADMIN_SECTIONS` | experimental | [example](../../../../apps/web/src/config/adminSections.tsx) |

Supporting exports (experimental). `/nodes/headless`: `createNodesApi`, `useNodesApi`, `useNodesWebAdapters`, `NodesSpinnerProps`; the wire types `WorkerNode` (= `AdminNode`), `NodeCredential` (= `AdminNodeCredential`), `NodeCredentialCreated`, `CreateNodeCredentialInput`, `NodeCredentialStatus`, `NodeOwner`, `NodeJobCounts`, `NodeStatus`, `NodeHealth`, `NodeVitals`, `NodeVitalsCounters`; the constants `NODE_STATUSES`, `NODE_HEALTHS`, `MAX_NODE_CREDENTIAL_DAYS`, `MAX_NODE_CREDENTIAL_NAME_LENGTH`, `WORKER_NODES_POLL_INTERVAL_MS`; the predicate `nodeCredentialStatus`; the formatters `formatDuration`, `formatDateTime`, `shortId`; the app-vitals helpers `nodeVitalFor`, `registeredNodeVitals`, `nodeVitalRows` and `formatNodeVital` (with `NodeVitalDef` and `NodeVitalUnit`) and the capability reader `nodeCapabilityItems` (bounded, text only; `MAX_LISTED_CAPABILITIES`, `MAX_CAPABILITY_TEXT_LENGTH`); the host and power types `NodeHostVitals` and `NodePower`, and `describeNodePower` (the badge's words and level, `NodePowerDescription`; `NODE_BATTERY_WARNING_PERCENT` = 20, `NODE_BATTERY_CRITICAL_PERCENT` = 10); the event types `WorkerNodeEvent` (= `AdminNodeEvent`), `WorkerNodeEventList`, `NodeEventSeverity`, `NodeEventsQuery`, the constant `NODE_EVENT_TYPES`, and the event wording `nodeEventLabel`, `humanizeNodeEventType`, `nodeEventSummary` (`MAX_NODE_EVENT_SUMMARY_ATTRS`); the `Use*Result` types; and the table types (`NodesDataTableComponent`, `NodesDataTableProps`, `NodesTableColumn`, `NodesTableRowAction`, `NodesTableFilter`, `NodesTableSortState`, `NodesTableEnumValue` and their unions). `/nodes/ui`: `NodesPageHeaderProps`, `NodesSettingsCard`, `NodeCredentialsProps`, `NodeVitalsPanelSlotProps`.

### Slots and theme

The page takes the page-slot contract of the web core ([Page slots](../core/README.md#page-slots)): `Header`, `BeforeContent`, `Sections` (rendered at both ends, with `position`) and `AfterContent`, plus `TableSlots` over the fleet table.

| Slot | Receives | Drawn |
|---|---|---|
| `Header` | `{ title, description, readOnly, actions }` (`actions` is `null`) | Replaces the `h1` and subtitle. `readOnly` means the viewer lacks `nodes:write`. |
| `BeforeContent`, `Sections` `top` | none, `{ position }` | Under the header, above the fleet summary. |
| `Sections` `bottom`, `AfterContent` | `{ position }`, none | After the credentials section. |
| `Columns(base)` | the fleet columns (`NodesTableColumn<WorkerNode>`), the slot columns included | Returns the columns to draw. Runs last. |
| `RowActions` | `{ row }` (a `WorkerNode`) | An extra `More actions` column. "View vitals" and "Delete node" are untouched. |
| `DetailPanel` | `{ row }` | An extra `Details` column of detail priority. |
| `Toolbar` | none | A row above the fleet table. |
| `VitalsPanel` | `{ node }` (the node as the fleet poll last read it) | A `section` labelled "Additional vitals" after the counters, the capabilities and the Events timeline in the "View vitals" dialog, for a node with and without vitals. |

Everything else is styled by the app's theme: palette roles (`text.secondary`, `error.main`, `warning.main`, `text.disabled`), MUI chip colours for statuses and typography variants, never a hard-coded theme.

### Host vitals, power and events (#1045)

A node whose server advertised `node_host_vitals` sends `vitals.host` (the MACHINE: system-wide CPU 0..100, logical cores, load averages, memory, OS release, arch, machine uptime) and `vitals.power` (source, battery charge, charging, low-power mode), and reports events on its heartbeat. The page draws them; it never turns one into a verdict (health stays the API's).

- **Power badge** on the fleet row's name line (so it reaches the grid, the expander and the phone card without a new column): a battery with its charge on `battery`, a plug on `ac`, nothing for `unknown` or absent. Warning colour at 20% or under, error colour at 10% or under; the state is always in the icon and in the accessible label ("On battery, 42%, discharging"), so colour is never the only cue. A node that is not healthy has its badge greyed.
- **Host machine** section of the vitals dialog (only when the node sent `host` or a known power source): "Host CPU" and "Host memory used" meters (used = total minus available, else minus free), load averages (1, 5, 15 min), operating system and arch, host uptime, power in words. An absent field reads "—", never zero.
- **Events** section of the vitals dialog: `GET /api/admin/nodes/:id/events`, newest first, 20 per page with "Load more". Each row: a severity chip (Info, Warning, Critical, in words), the type's label (`NODE_EVENT_TYPES` have one; an unknown type is humanized, `transcode.queue_full` reads "Transcode: queue full"), a one-line attribute summary ("AC → Battery (64%)", "18% (threshold 20%)", "Asleep for 2h 03m", "4.5% free (1 GB)"; otherwise up to four `key: value` pairs), and a relative time on the node's clock with the absolute occurred and received times in the tooltip. The first page re-reads with the fleet poll while it is the only page shown. An older server answers the route with a 404, which the section shows as its error line; the rest of the dialog is unaffected.

## Data

None. The browser holds the fleet in memory and nothing else; every record is read and written through the API. A minted node token is held only by the reveal dialog's own state, never by a hook.

## Permissions and settings

The registry entry carries the exact string the controller enforces: `Worker Nodes` `nodes:read` (`nodes/nodes-admin.controller.ts`, deliberately not `jobs:read`). Writes are gated inside the page, never by a second card: deleting a node and minting or revoking a credential need `nodes:write` (`POST /node-credentials` is on `node-credential.controller.ts`). Without it the controls are absent and the subtitle says "(read-only)". Reading a node's events (`GET /api/admin/nodes/:id/events`, `nodes-admin.controller.ts`) is `nodes:read`, like the node detail route: the Events section needs no second permission. The staleness threshold behind `health` comes from the API's response, never from a constant here.

## UI

Route the app mounts: `/admin/settings/workers` (`WorkersPage`; the node credentials are a section of it, not a tab or a card). Registry entry: `nodesAdminSections.operations`. The layout is mobile-first (the summary strip wraps, the vitals dialog goes full screen on a phone); the tables follow whatever breakpoints the app's table has. The page's DOM and `sx` are unchanged by the move from the jobs slice, so the visual baselines are too.

## Infra

None.

## Observability

None. The page emits no telemetry of its own; the API's node spans and metrics are `@marinoscar/platform-api/nodes`.

## Security notes

- `NodeCredential` has no `token` field: the raw `nod_` token exists only on the create response (`NodeCredentialCreated`), is shown once with a copy button, and is not kept by any hook.
- The fleet routes stay on their two prefixes (`/admin/nodes`, `/node-credentials`): `/api/nodes` is the only prefix a worker token reaches, and the admin routes must stay outside it.
- `listNodeEvents` calls the ADMIN route, `GET /admin/nodes/:id/events` (Admin role and `nodes:read`, like every fleet route of the page), never the owner-scoped `GET /api/nodes/:id/events` on the prefix a worker token reaches: the page shows other users' nodes.
- `WorkerNode` carries `owner` (another user's email) and `jobCounts`; it is the admin view and never the shape a node receives about itself.
- Node events and host vitals are self-reported by the node: attribute values are printed as bounded plain text (at most four pairs, each value cut at 64 characters), never as markup, and never decide anything.
- The page hides controls; the API refuses.

## Conformance suite

None in the web package for this slice. The API slice's suites cover the routes and the contract binding (`packages/platform-api/src/nodes/dto/node-admin.dto.spec.ts`); the package tests (`packages/platform-web/test/nodes/`) cover the client's paths, the hooks, the column contracts and the page over a test host, and the reference app's page suite (`apps/web/src/__tests__/pages/Admin/WorkersPage.test.tsx`) renders it through the app's `DataTable`. The real worker cycle (enrol, claim, run, settle) is the CI job `worker-e2e` (`apps/api/scripts/worker-cycle-e2e.mjs`).

## Upgrade notes

#1045 (host vitals, power, events): `NodesApi` gains `listNodeEvents(nodeId, query?)` (`GET /admin/nodes/:id/events`). An app that hands the adapters `createNodesApi(...)` (or the jobs client, which spreads it) needs nothing; an app with its OWN `NodesApi` implementation adds the member. The fleet row's name cell carries the power badge only for a node that reports `power`, so the markup of every other row, and the page's built-in DOM baseline, is unchanged; the vitals dialog adds the Host machine section only for a node that reports host vitals, and the Events section for every node (the page passes it; a `NodeVitalsDialog` rendered on its own reads no events).

PP-14.23: the Worker Nodes page takes the page-slot contract (`BeforeContent`, `Sections`, `AfterContent`, `TableSlots`, `VitalsPanel`). An existing `slots.Header` keeps working unchanged: it receives the same `title`, `description` and `readOnly`, and `NodesPageHeaderProps` gains `actions` (`null`). With no slot the markup is unchanged (`test/nodes/WorkersPage.builtin-dom.test.tsx`).

New subpaths in this version. Nothing breaks: `@marinoscar/platform-web/jobs/headless` and `/jobs/ui` re-export every worker-fleet name they exported before (`WorkersPage`, the hooks, `WorkerNode`, `NodeCredential`, `createJobsApi`'s fleet members), and `JobsWebAdaptersProvider` feeds the Worker Nodes page. To move over:

- Import the fleet hooks, types and `nodeCredentialStatus` from `/nodes/headless` and `WorkersPage` from `/nodes/ui`.
- Mount `NodesWebAdaptersProvider` next to (outside) the jobs one, with `createNodesApi(appTransport)`.
- To mock the hooks in a page test, mock `@marinoscar/platform-web/nodes/headless` (spread `importOriginal`): the page now reads them from there.
- `WorkerNode` and `NodeCredential` are now the contract's `AdminNode` and `AdminNodeCredential`; `status` and `health` are the closed unions, `lastVitals` is `NodeVitals | null`.
- The vitals dialog prints `vitals.extra` in an "App vitals" table (labels and units from `registerNodeVital`; an unregistered key shows by its key) and, below the vitals, a read-only list of the capabilities the node's probe reported (`probe.capabilities`, with a version where the probe captured one). Both are bounded and rendered as plain text; the DOM is unchanged for a node that reports neither.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `useNodesApi: no nodes client` | No `PlatformHostProvider` and no adapters' `api` above the page | Mount the provider (from `/core`) or `NodesWebAdaptersProvider` with an `api`, also in test wrappers |
| The lists render as plain tables without filters | No `DataTable` in the adapters | Hand the app's table to `NodesWebAdaptersProvider` |
| The page redirects to `/` | The viewer lacks `nodes:read` in the host's `hasPermission` | Check the host's viewer and the user's roles |
| A mocked hook is ignored in a page test | The test mocks `@marinoscar/platform-web/jobs/headless` | Mock `@marinoscar/platform-web/nodes/headless` |

## Links

- [Package README](../../README.md)
- [The jobs web slice](../jobs/README.md)
- [The nodes API slice](../../../platform-api/src/nodes/README.md)
- [The nodes contract](../../../platform-contract/src/nodes/README.md)
- [Settings UI spec](../../../../docs/specs/settings-ui.md)
- [Worker nodes spec](../../../../docs/specs/worker-nodes.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)
