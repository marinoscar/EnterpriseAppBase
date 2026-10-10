# @marinoscar/platform-web/nodes

`@marinoscar/platform-web/nodes`: the browser side of the worker-node fleet (issue #881, a follow-up of #854 under the platform packages program), in two entry points. `/nodes/headless` holds the behaviour without markup: the fleet and node-credential API client over the app's transport, the wire types (derived from the admin schemas of `@marinoscar/platform-contract/nodes`), the data hooks (the fleet, one node, the credentials, the writes), the visible-tab poll, the adapters and the formatters. `/nodes/ui` holds the Worker Nodes admin page (fleet table, vitals dialog, credential section with its create and show-once dialogs), its header slot, and its registry entry as data. Depends on the `core` slice only (`packages/platform-slices.json`): the hooks call the API through `usePlatformApi()` (or the adapters' client), the page reads permissions from `usePlatformViewer()`. The jobs slice depends on this one and re-exports everything it used to own, so an existing `@marinoscar/platform-web/jobs` import keeps working.

## Purpose and scope

Does: render the Console's Worker Nodes page "packages own behaviour, apps own appearance": the fleet with each node's derived health, operator status and job counts, the last self-reported vitals (compact column, full dialog, fleet-wide saturation and low-disk tallies), the delete of a node, and the node credentials (mint with an optional expiry, show the raw `nod_` token once, revoke). The app's MUI theme styles it, `slots.Header` replaces the title block, and the nodes adapters hand in the app's spinner, its table and, optionally, its own nodes client.

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
| `WorkersPage` | `slots.Header` | the `h1` and subtitle | Replaces the title block; receives `{ title, description, readOnly }`. |
| `WorkersPage` | `fallbackPath` | `'/'` | Where a viewer without `nodes:read` is sent. |

Every hook takes an optional `NodesApi` as its last argument (the adapters' client, else `createNodesApi` over the host's transport). The fleet poll runs every `WORKER_NODES_POLL_INTERVAL_MS` (10 s) while the tab is in front.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `NodesApi` | option | `{ getWorkerNodes; getWorkerNode; deleteWorkerNode; getNodeCredentials; createNodeCredential; revokeNodeCredential }` | Route the fleet calls through the app's own client, or fake them in a test | experimental | [example](../../../../apps/web/src/platform/nodesAdapters.ts) |
| `NodesWebAdapters` | option | `{ Spinner?; DataTable?; api? }` | Hand the Worker Nodes page the app's spinner, table and client | experimental | [example](../../../../apps/web/src/platform/nodesAdapters.ts) |
| `NodesWebAdaptersProvider` | component | `NodesWebAdaptersProvider(props: { adapters; children }): ReactElement` | Mount the adapters once, around the signed-in shell | experimental | [example](../../../../apps/web/src/platform/shellProviders.tsx) |
| `useWorkerNodes` | hook | `useWorkerNodes(api?: NodesApi): UseWorkerNodesResult` | Build another view of the fleet (a health chip, a count) | experimental | [example](../../../../apps/web/src/nodes/examples.tsx) |
| `useWorkerNode` | hook | `useWorkerNode(id: string \| null, api?: NodesApi): UseWorkerNodeResult` | Show one node (a node page, a dashboard card) | experimental | [example](../../../../apps/web/src/nodes/examples.tsx) |
| `useNodeCredentials` | hook | `useNodeCredentials(api?: NodesApi): UseNodeCredentialsResult` | Build another view of the node credentials | experimental | [example](../../../../apps/web/src/nodes/examples.tsx) |
| `useNodeActions` | hook | `useNodeActions(onChanged?: () => void, api?: NodesApi): UseNodeActionsResult` | Delete a node, or mint or revoke a credential from another surface | experimental | [example](../../../../apps/web/src/nodes/examples.tsx) |
| `useVisiblePolling` | hook | `useVisiblePolling(callback: () => void, intervalMs: number): void` | Re-read a view while the tab is in front, the way the page does | experimental | [example](../../../../apps/web/src/nodes/examples.tsx) |
| `WorkersPage` | component | `WorkersPage(props?: WorkersPageProps): ReactElement` | Render the `/admin/settings/workers` route | experimental | [example](../../../../apps/web/src/App.tsx) |
| `WorkersPageProps` | slot | `{ fallbackPath?; slots?: { Header? } }` | Replace the Worker Nodes page's header | experimental | [example](../../../../apps/web/src/nodes/examples.tsx) |
| `NodeCredentials` | component | `NodeCredentials(props: NodeCredentialsProps): ReactElement` | Embed the credential table with its create and show-once dialogs in another incident-response surface | experimental | [example](../../../../apps/web/src/nodes/examples.tsx) |
| `nodesAdminSections` | component | `{ operations: NodesSettingsCard[] }` | Spread the Worker Nodes card into the app's `ADMIN_SECTIONS` | experimental | [example](../../../../apps/web/src/config/adminSections.tsx) |

Supporting exports (experimental). `/nodes/headless`: `createNodesApi`, `useNodesApi`, `useNodesWebAdapters`, `NodesSpinnerProps`; the wire types `WorkerNode` (= `AdminNode`), `NodeCredential` (= `AdminNodeCredential`), `NodeCredentialCreated`, `CreateNodeCredentialInput`, `NodeCredentialStatus`, `NodeOwner`, `NodeJobCounts`, `NodeStatus`, `NodeHealth`, `NodeVitals`, `NodeVitalsCounters`; the constants `NODE_STATUSES`, `NODE_HEALTHS`, `MAX_NODE_CREDENTIAL_DAYS`, `MAX_NODE_CREDENTIAL_NAME_LENGTH`, `WORKER_NODES_POLL_INTERVAL_MS`; the predicate `nodeCredentialStatus`; the formatters `formatDuration`, `formatDateTime`, `shortId`; the `Use*Result` types; and the table types (`NodesDataTableComponent`, `NodesDataTableProps`, `NodesTableColumn`, `NodesTableRowAction`, `NodesTableFilter`, `NodesTableSortState`, `NodesTableEnumValue` and their unions). `/nodes/ui`: `NodesPageHeaderProps`, `NodesSettingsCard`, `NodeCredentialsProps`.

### Slots and theme

`slots.Header` replaces the `h1` and subtitle; it receives the card's `title` and `description` and `readOnly` (the viewer lacks `nodes:write`). Everything else is styled by the app's theme: palette roles (`text.secondary`, `error.main`, `warning.main`, `text.disabled`), MUI chip colours for statuses and typography variants, never a hard-coded theme.

## Data

None. The browser holds the fleet in memory and nothing else; every record is read and written through the API. A minted node token is held only by the reveal dialog's own state, never by a hook.

## Permissions and settings

The registry entry carries the exact string the controller enforces: `Worker Nodes` `nodes:read` (`nodes/nodes-admin.controller.ts`, deliberately not `jobs:read`). Writes are gated inside the page, never by a second card: deleting a node and minting or revoking a credential need `nodes:write` (`POST /node-credentials` is on `node-credential.controller.ts`). Without it the controls are absent and the subtitle says "(read-only)". The staleness threshold behind `health` comes from the API's response, never from a constant here.

## UI

Route the app mounts: `/admin/settings/workers` (`WorkersPage`; the node credentials are a section of it, not a tab or a card). Registry entry: `nodesAdminSections.operations`. The layout is mobile-first (the summary strip wraps, the vitals dialog goes full screen on a phone); the tables follow whatever breakpoints the app's table has. The page's DOM and `sx` are unchanged by the move from the jobs slice, so the visual baselines are too.

## Infra

None.

## Observability

None. The page emits no telemetry of its own; the API's node spans and metrics are `@marinoscar/platform-api/nodes`.

## Security notes

- `NodeCredential` has no `token` field: the raw `nod_` token exists only on the create response (`NodeCredentialCreated`), is shown once with a copy button, and is not kept by any hook.
- The fleet routes stay on their two prefixes (`/admin/nodes`, `/node-credentials`): `/api/nodes` is the only prefix a worker token reaches, and the admin routes must stay outside it.
- `WorkerNode` carries `owner` (another user's email) and `jobCounts`; it is the admin view and never the shape a node receives about itself.
- The page hides controls; the API refuses.

## Conformance suite

None in the web package for this slice. The API slice's suites cover the routes and the contract binding (`packages/platform-api/src/nodes/dto/node-admin.dto.spec.ts`); the package tests (`packages/platform-web/test/nodes/`) cover the client's paths, the hooks, the column contracts and the page over a test host, and the reference app's page suite (`apps/web/src/__tests__/pages/Admin/WorkersPage.test.tsx`) renders it through the app's `DataTable`. The real worker cycle (enrol, claim, run, settle) is the CI job `worker-e2e` (`apps/api/scripts/worker-cycle-e2e.mjs`).

## Upgrade notes

New subpaths in this version. Nothing breaks: `@marinoscar/platform-web/jobs/headless` and `/jobs/ui` re-export every worker-fleet name they exported before (`WorkersPage`, the hooks, `WorkerNode`, `NodeCredential`, `createJobsApi`'s fleet members), and `JobsWebAdaptersProvider` feeds the Worker Nodes page. To move over:

- Import the fleet hooks, types and `nodeCredentialStatus` from `/nodes/headless` and `WorkersPage` from `/nodes/ui`.
- Mount `NodesWebAdaptersProvider` next to (outside) the jobs one, with `createNodesApi(appTransport)`.
- To mock the hooks in a page test, mock `@marinoscar/platform-web/nodes/headless` (spread `importOriginal`): the page now reads them from there.
- `WorkerNode` and `NodeCredential` are now the contract's `AdminNode` and `AdminNodeCredential`; `status` and `health` are the closed unions, `lastVitals` is `NodeVitals | null`.

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
