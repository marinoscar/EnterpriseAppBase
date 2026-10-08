# @marinoscar/platform-web/jobs

`@marinoscar/platform-web/jobs`: the browser side of the jobs and nodes slices (issue #854, a follow-up of PP-8.2 under epic #667), in two entry points. `/jobs/headless` holds the behaviour without markup: the job queue and worker-fleet API client over the app's transport, the wire types (derived from `@marinoscar/platform-contract/jobs` and `/nodes`), the data hooks (the job list with its filters including `orgId`, the queue summary, the writes, the insights, the fleet, one node, the node credentials), the visible-tab poll, the adapters and the formatters. `/jobs/ui` holds the Jobs, Job Insights and Worker Nodes admin pages with their header slot, and their registry entries as data. Depends on the `core` slice only (`packages/platform-slices.json`): the hooks call the API through `usePlatformApi()` (or the adapters' client), the pages read permissions from `usePlatformViewer()`.

## Purpose and scope

Does: render the Console's Operations pages "packages own behaviour, apps own appearance": the queue summary, the queue-wide sweeps (retry all failed, reset stuck) and the paginated job list with per-row retry and delete; the queue analytics over a window (percentiles, throughput, the ETA per type with how much of it is measurement, all-time totals) and the reset of the lifetime rollup; the worker fleet with each node's derived health and vitals, and the node credentials (mint and show once, revoke). The app's MUI theme styles them, `slots.Header` replaces each page's title block, and the jobs adapters hand in the app's spinner, its table and, optionally, its own jobs client.

Does not: decide anything. Every permission is enforced by the API (`@marinoscar/platform-api/jobs` and `/nodes`); the pages only hide or disable controls. A node's `health` is derived by the API against the `nodes.staleHeartbeatSeconds` setting and is never recomputed here. The slice does not own the app's registries or routes (the app declares every card in `ADMIN_SECTIONS` and every route in its router, CLAUDE.md Settings UI Pattern), import app context, layout or navigation, or ship a data table (the app's comes in through the adapters; a plain MUI table is the fallback). There is no job-detail view: the API has no `GET /admin/jobs/:id`, and a row's fields are all on the list.

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { JobsWebAdaptersProvider, createJobsApi, useJobs, useWorkerNodes } from '@marinoscar/platform-web/jobs/headless';
import { JobsPage, JobInsightsPage, WorkersPage, jobsAdminSections } from '@marinoscar/platform-web/jobs/ui';
```

`/jobs/headless` needs `react`. Its types reference `zod` (a peer of this package) through the contract schemas. `/jobs/ui` also needs `@mui/material`, `@mui/icons-material`, `@emotion/*` and `react-router-dom` (the pages redirect and navigate). Both depend on `@marinoscar/platform-contract` (installed with this package). Mount `PlatformHostProvider` (from `/core`) above the pages.

## Quick start

The reference app binds the slice in three places:

```tsx
// apps/web/src/platform/jobsAdapters.ts: the app's table, spinner and client
export const appJobsAdapters: JobsWebAdapters = { Spinner: LoadingSpinner, DataTable, api: createJobsApi(appPlatformApi) };

// apps/web/src/App.tsx: the adapters around the signed-in shell, and the routes behind the cards' permissions
<JobsWebAdaptersProvider adapters={appJobsAdapters}><AppPlatformHostProvider>...</AppPlatformHostProvider></JobsWebAdaptersProvider>
const JobsPage = lazy(() => import('@marinoscar/platform-web/jobs/ui').then((m) => ({ default: m.JobsPage })));
<Route path="/admin/settings/jobs" element={
  <RequirePermission permission="jobs:read" fallback={<Navigate to="/" replace />}><JobsPage /></RequirePermission>
} />

// apps/web/src/config/adminSections.tsx: the cards, as data, where they were
{ label: 'Operations', cards: [...jobsAdminSections.operations, databaseBackupCard, broadcastsCard /* ... */] },
```

## Configuration

`JobsWebAdaptersProvider` `adapters` (`JobsWebAdapters`, all optional, a module constant):

| Option | Type | Default | Meaning |
|---|---|---|---|
| `Spinner` | `ComponentType<{ fullScreen? }>` | an MUI `CircularProgress` | The Job Insights page's first load. |
| `DataTable` | `JobsDataTableComponent` | a plain MUI table | The table the job list, the per-type insights, the fleet and the credential list render through. The props are a subset of the reference app's `DataTable`, which is assignable without a cast. The fallback draws no filter menu (the filters still apply through the query) and still confirms destructive row actions. |
| `api` | `JobsApi` | `createJobsApi(usePlatformApi())` | The jobs and fleet calls. |

Page props (all optional; the app's routes render the pages as is):

| Page | Prop | Default | Meaning |
|---|---|---|---|
| all three | `slots.Header` | the `h1` and subtitle | Replaces the title block; receives `{ title, description, readOnly }`. |
| all three | `fallbackPath` | `'/'` | Where a viewer without the page's read permission is sent. |
| `JobsPage` | `insightsPath` | `'/admin/settings/jobs/insights'` | Where the "Job insights" button goes. |

Every hook takes an optional `JobsApi` as its last argument (the adapters' client, else `createJobsApi` over the host's transport). The polls run every `JOBS_POLL_INTERVAL_MS` and `WORKER_NODES_POLL_INTERVAL_MS` (10 s) while the tab is in front; Job Insights does not poll.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `JobsApi` | option | `{ getJobs; getJobStats; retryJob; deleteJob; ...; revokeNodeCredential }` | Route the jobs and fleet calls through the app's own client, or fake them in a test | experimental | [example](../../../../apps/web/src/platform/jobsAdapters.ts) |
| `JobsWebAdapters` | option | `{ Spinner?; DataTable?; api? }` | Hand the jobs pages the app's spinner, table and client | experimental | [example](../../../../apps/web/src/platform/jobsAdapters.ts) |
| `JobsWebAdaptersProvider` | component | `JobsWebAdaptersProvider(props: { adapters; children }): ReactElement` | Mount the adapters once, around the signed-in shell | experimental | [example](../../../../apps/web/src/App.tsx) |
| `useJobs` | hook | `useJobs(api?: JobsApi): UseJobsResult` | Build another view of the job list (one organization's failures, a count) | experimental | [example](../../../../apps/web/src/jobs/examples.tsx) |
| `useJobStats` | hook | `useJobStats(api?: JobsApi): UseJobStatsResult` | Show the queue summary elsewhere | experimental | [example](../../../../apps/web/src/jobs/examples.tsx) |
| `useJobActions` | hook | `useJobActions(onChanged?: () => void, api?: JobsApi): UseJobActionsResult` | Offer retry, delete or the sweeps from another surface | experimental | [example](../../../../apps/web/src/jobs/examples.tsx) |
| `useJobInsights` | hook | `useJobInsights(windowDays: number, api?: JobsApi): UseJobInsightsResult` | Show an ETA or a percentile elsewhere | experimental | [example](../../../../apps/web/src/jobs/examples.tsx) |
| `useWorkerNodes` | hook | `useWorkerNodes(api?: JobsApi): UseWorkerNodesResult` | Build another view of the fleet | experimental | [example](../../../../apps/web/src/jobs/examples.tsx) |
| `useWorkerNode` | hook | `useWorkerNode(id: string \| null, api?: JobsApi): UseWorkerNodeResult` | Show one node (a node page, a dashboard card) | experimental | [example](../../../../apps/web/src/jobs/examples.tsx) |
| `useNodeCredentials` | hook | `useNodeCredentials(api?: JobsApi): UseNodeCredentialsResult` | Build another view of the node credentials | experimental | [example](../../../../apps/web/src/jobs/examples.tsx) |
| `useNodeActions` | hook | `useNodeActions(onChanged?: () => void, api?: JobsApi): UseNodeActionsResult` | Delete a node, or mint or revoke a credential from another surface | experimental | [example](../../../../apps/web/src/jobs/examples.tsx) |
| `useVisiblePolling` | hook | `useVisiblePolling(callback: () => void, intervalMs: number): void` | Re-read a view while the tab is in front, the way the pages do | experimental | [example](../../../../apps/web/src/jobs/examples.tsx) |
| `JobsPage` | component | `JobsPage(props?: JobsPageProps): ReactElement` | Render the `/admin/settings/jobs` route | experimental | [example](../../../../apps/web/src/App.tsx) |
| `JobsPageProps` | slot | `{ insightsPath?; fallbackPath?; slots?: { Header? } }` | Replace the Jobs page's header or its paths | experimental | [example](../../../../apps/web/src/jobs/examples.tsx) |
| `JobInsightsPage` | component | `JobInsightsPage(props?: JobInsightsPageProps): ReactElement` | Render the `/admin/settings/jobs/insights` route | experimental | [example](../../../../apps/web/src/App.tsx) |
| `JobInsightsPageProps` | slot | `{ fallbackPath?; slots?: { Header? } }` | Replace the Job Insights page's header | experimental | [example](../../../../apps/web/src/jobs/examples.tsx) |
| `WorkersPage` | component | `WorkersPage(props?: WorkersPageProps): ReactElement` | Render the `/admin/settings/workers` route | experimental | [example](../../../../apps/web/src/App.tsx) |
| `WorkersPageProps` | slot | `{ fallbackPath?; slots?: { Header? } }` | Replace the Worker Nodes page's header | experimental | [example](../../../../apps/web/src/jobs/examples.tsx) |
| `jobsAdminSections` | component | `{ operations: JobsSettingsCard[] }` | Spread the Jobs, Job Insights and Worker Nodes cards into the app's `ADMIN_SECTIONS` | experimental | [example](../../../../apps/web/src/config/adminSections.tsx) |

Supporting exports (experimental). `/jobs/headless`: `createJobsApi`, `useJobsApi`, `useJobsWebAdapters`, `JobsSpinnerProps`; the wire types `Job`, `JobListParams`, `JobListResponse`, `JobStats`, `JobTypeStats`, `JobStatusCounts`, `JobInsights`, `JobEta`, `JobEtaBasis`, `JobDurationStats`, `JobTypeDurationStats`, `JobLifetimeStats`, `RetryFailedResult`, `ResetStuckResult`, `ResetHistoryResult`, `JobStatusName`, `JobReasonName`, `ProcessedWithin`, `WorkerNode`, `NodeOwner`, `NodeJobCounts`, `NodeStatus`, `NodeHealth`, `NodeVitals`, `NodeVitalsCounters`, `NodeCredential`, `NodeCredentialCreated`, `CreateNodeCredentialInput`, `NodeCredentialStatus`; the constants `NODE_STATUSES`, `NODE_HEALTHS`, `MAX_NODE_CREDENTIAL_DAYS`, `MAX_NODE_CREDENTIAL_NAME_LENGTH`, `JOBS_POLL_INTERVAL_MS`, `WORKER_NODES_POLL_INTERVAL_MS`, `DEFAULT_INSIGHTS_WINDOW_DAYS`, `INSIGHTS_WINDOW_OPTIONS`; the predicates `isJobActionable`, `nodeCredentialStatus`; the formatters `formatDuration`, `formatDateTime`, `shortId`; the `Use*Result` types; and the table types (`JobsDataTableComponent`, `JobsDataTableProps`, `JobsTableColumn`, `JobsTableRowAction`, `JobsTableFilter`, `JobsTableSortState`, `JobsTableEnumValue` and their unions). `/jobs/ui`: `JobsPageHeaderProps`, `JobsSettingsCard`.

### Slots and theme

`slots.Header` on each page replaces the `h1` and subtitle; it receives the card's `title` and `description` and `readOnly` (the viewer lacks `jobs:write`, or `nodes:write` on Worker Nodes). Everything else is styled by the app's theme: palette roles (`text.secondary`, `error.main`, `warning.main`, `text.disabled`), MUI chip colours for statuses and typography variants, never a hard-coded theme.

## Data

None. The browser holds the current page of rows in memory and nothing else; every record is read and written through the API. A minted node token is held only by the reveal dialog's own state, never by a hook.

## Permissions and settings

The registry entries carry the exact strings the controllers enforce: `Jobs` and `Job Insights` `jobs:read` (`jobs/job-admin.controller.ts`), `Worker Nodes` `nodes:read` (`nodes/nodes-admin.controller.ts`, deliberately not `jobs:read`). Writes are gated inside the pages, never by a second card: retry, delete, the sweeps and the rollup reset need `jobs:write`; deleting a node and minting or revoking a credential need `nodes:write` (`POST /node-credentials` is on `node-credential.controller.ts`). Without the write permission the controls are absent and the subtitle says "(read-only)". The settings the pages show (`jobs.stuckThresholdMinutes`, the window the API clamped to) come from the responses, never from a constant here.

## UI

Routes the app mounts: `/admin/settings/jobs` (`JobsPage`), `/admin/settings/jobs/insights` (`JobInsightsPage`, nested under the Jobs path; the app's `settingsPageTitle` longest-prefix rule titles it), `/admin/settings/workers` (`WorkersPage`, the node credentials are a section of it, not a tab or a card). Registry entries: `jobsAdminSections.operations`. Layouts are mobile-first (the summary strips wrap, the sweep buttons stack below `sm`, the vitals dialog goes full screen on a phone); the lists follow whatever breakpoints the app's table has. The pages' DOM and `sx` are the reference app's, unchanged by the move, so the visual baselines are too.

## Infra

None.

## Observability

None. The pages emit no telemetry of their own; the API's job and node spans and metrics are `@marinoscar/platform-api/jobs` and `/nodes`.

## Security notes

- `NodeCredential` has no `token` field: the raw `nod_` token exists only on the create response (`NodeCredentialCreated`), is shown once with a copy button, and is not kept by any hook.
- The fleet routes stay on their two prefixes (`/admin/nodes`, `/node-credentials`): `/api/nodes` is the only prefix a worker token reaches, and the admin routes must stay outside it.
- The pages hide controls; the API refuses. A running job's retry and delete are disabled because the API answers 400, not as a policy of their own.

## Conformance suite

None in the web package for this slice. The API slices' suites cover the routes; the package tests (`packages/platform-web/test/jobs/`) cover the client's paths, the hooks, the column contracts and the pages over a test host, and the reference app's page suites (`apps/web/src/__tests__/pages/Admin/{Jobs,JobInsights,Workers}Page.test.tsx`) render these pages through the app's `DataTable`.

## Upgrade notes

New subpaths in this version. From the reference app's `services/jobs.ts`, `services/nodes.ts`, `hooks/useJobs.ts`, `hooks/useJobInsights.ts`, `hooks/useWorkerNodes.ts`, `pages/Admin/{JobsPage,JobInsightsPage,WorkersPage,jobsTable,workersTable,workerVitals}.tsx` and `components/admin/{NodeCredentials,NodeVitalsDialog,CreateNodeCredentialDialog,NodeCredentialRevealDialog}.tsx` (#854):

- Lazy-load the pages from `@marinoscar/platform-web/jobs/ui` (named exports) and spread `jobsAdminSections.operations` where the three cards were.
- Mount `JobsWebAdaptersProvider` with the app's `DataTable` and spinner (and `createJobsApi(appTransport)`), also in test wrappers.
- Import the types, the hooks, `isJobActionable`, `nodeCredentialStatus` and `formatDuration` / `formatDateTime` / `shortId` from `/jobs/headless`. `Job` now carries `orgId`, and `JobListParams` takes it.
- The hooks take the client as an optional last argument instead of importing service modules; to mock them in a page test, mock `@marinoscar/platform-web/jobs/headless`.
- The pages read permissions from the host viewer instead of the app's `usePermissions`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `useJobsApi: no jobs client` | No `PlatformHostProvider` and no adapters' `api` above the page | Mount the provider (from `/core`) or `JobsWebAdaptersProvider` with an `api`, also in test wrappers |
| The lists render as plain tables without filters | No `DataTable` in the adapters | Hand the app's table to `JobsWebAdaptersProvider` |
| A page redirects to `/` | The viewer lacks `jobs:read` / `nodes:read` in the host's `hasPermission` | Check the host's viewer and the user's roles |
| A mocked hook is ignored in a page test | The test mocks an app module | Mock `@marinoscar/platform-web/jobs/headless` (spread `importOriginal`) |

## Links

- [Package README](../../README.md)
- [The jobs API slice](../../../platform-api/src/jobs/README.md)
- [The nodes API slice](../../../platform-api/src/nodes/README.md)
- [The jobs contract](../../../platform-contract/src/jobs/README.md)
- [The nodes contract](../../../platform-contract/src/nodes/README.md)
- [Settings UI spec](../../../../docs/specs/settings-ui.md)
- [Job queue spec](../../../../docs/specs/job-queue.md)
- [Worker nodes spec](../../../../docs/specs/worker-nodes.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)
