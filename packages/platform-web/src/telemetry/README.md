# @marinoscar/platform-web/telemetry

`@marinoscar/platform-web/telemetry`: the telemetry UI: the Telemetry settings page, the SQL Explorer with its AI assistant, and the Dashboard, in two entry points of one slice. `/telemetry/headless` holds the client, the hooks, the config provider and route guard, the app adapters, the theme-token contract and pure helpers, with no component; `/telemetry/ui` holds the three route components and the admin registry cards, and each page also has a subpath of its own (`/telemetry/ui/settings-page`, `/explorer-page`, `/dashboard-page`) so a lazy route keeps its own chunk. Depends on the `core` slice and, for the generated store form, the `settings` slice (`packages/platform-slices.json`): it reads the app through `usePlatformHost()`.

An app that registers its own telemetry store gets its settings form with no web code either: the settings page draws a Store section from the descriptor the API serves ([API README, "Replacing the store"](../../../platform-api/src/telemetry/README.md#replacing-the-store-rung-2); the reference app's [`memory` store](../../../../apps/api/src/platform-extensions/telemetry/memory-store.ts) is the worked example, its page test [`memory-store-section.test.tsx`](../../../../apps/web/src/__tests__/examples/telemetry/memory-store-section.test.tsx)).

An app gets its own dashboard group with no web code: the dashboard renders whatever groups the API reports, titled from the group's own metadata (the reference app's `activity` group, [`activity.metric-group.ts`](../../../../apps/api/src/platform-extensions/telemetry/activity.metric-group.ts), adds an "App activity" section this way).

## Purpose and scope

Does: render and drive the telemetry routes of `@marinoscar/platform-api/telemetry` (config and status, the GreptimeDB connection, the settings and write-only secrets of a registered telemetry store, the telemetry services stack, read-only SQL query, schema and export, the assistant stream, the dashboard's summary, timeseries, top lists, events, filters and metric groups). The wire types and limits come from `@marinoscar/platform-contract/telemetry`, imported as types and from the zod-free constants module only. A metric group the API reports renders as a dashboard section titled from its metadata, so an app group (the reference app's `activity`, EvoPath's `coach`) needs no web code. A title override belongs in the group's `label` and `title`, never in the web app.

Does not: decide anything (the API's SQL guard, row caps and permission checks are the gate; the browser presents and collects), own the registry or the routes (the app places the cards and routes them behind its own permission gate), create a theme (the app passes its themes through `withTelemetryTokens`), or own the AI switch and model catalogue (the app hands them in through `TelemetryWebAdapters` until the AI slice is packaged).

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { TelemetryConfigProvider, RequireTelemetryEnabled, withTelemetryTokens } from '@marinoscar/platform-web/telemetry/headless';
import { telemetryAdminCards } from '@marinoscar/platform-web/telemetry/ui';
const TelemetryDashboardPage = lazy(() => import('@marinoscar/platform-web/telemetry/ui/dashboard-page'));
```

`/telemetry/ui` needs the optional peers `@mui/x-charts` (dashboard charts), `@mui/x-data-grid` (explorer results), `@uiw/react-codemirror` and `@codemirror/lang-sql` (the explorer's editor, lazy-loaded), besides the required package peers (`@mui/material`, `@emotion/*`, `react`, `react-dom`) and the optional `@mui/icons-material` and `react-router-dom`. `/telemetry/headless` needs `react`, `react-router-dom` (the guard's redirect) and `@mui/material/styles` (the token contract) only; it imports no MUI component module (an ESLint rule and `test/telemetry/boundaries.test.ts` enforce it). Both use `@marinoscar/platform-contract`, whose peer `zod` the app installs; it is not bundled.

## Quick start

The reference app binds the slice in five places:

```tsx
// apps/web/src/App.tsx: the providers (the config provider sits ABOVE the
// platform host, which reads the feature it answers, so it takes the transport)
<TelemetryConfigProvider api={appPlatformApi}>
  <TelemetryWebAdaptersProvider adapters={appTelemetryAdapters}>
    <AppPlatformHostProvider><Layout /></AppPlatformHostProvider>
  </TelemetryWebAdaptersProvider>
</TelemetryConfigProvider>

// apps/web/src/App.tsx: one route per card, behind the app's permission gate
<Route path="/admin/settings/telemetry/dashboard" element={
  <RequirePermission permission="telemetry:query" fallback={<Navigate to="/" replace />}>
    <RequireTelemetryEnabled><TelemetryDashboardPage /></RequireTelemetryEnabled>
  </RequirePermission>
} />

// apps/web/src/config/adminSections.tsx: the Observability cards, in place
cards: [...telemetryAdminCards, { ...doctorSettingsPage.card, Icon: doctorSettingsPage.Icon }],

// apps/web/src/theme/index.ts
export const lightTheme = withTelemetryTokens(createTheme({ ... }));

// apps/web/src/platform/telemetryAdapters.ts: AI on/off, the model catalogue, the spinner
export const appTelemetryAdapters: TelemetryWebAdapters = { useAiEnabled, useAssistantModels, Spinner: LoadingSpinner };
```

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `TelemetryConfigProvider` `api` | `PlatformApiClient` | the platform host's | The transport for `GET /telemetry/config`; required when mounted above `PlatformHostProvider`. |
| `TelemetryWebAdaptersProvider` `adapters` | `TelemetryWebAdapters` | `DEFAULT_TELEMETRY_WEB_ADAPTERS` (AI off, no models, no spinner) | What the pages need from the app beyond the host. Keep it a module constant. |
| `RequireTelemetryEnabled` `fallback` | `ReactNode` | `<Navigate to="/" replace />` | Rendered while telemetry is off. |
| `RequireTelemetryEnabled` `loading` | `ReactNode` | the adapter's `Spinner`, else nothing | Rendered while the first answer is in flight. |
| `useTelemetryStack` options | `{ activeIntervalMs?, idleIntervalMs? }` | 3 s while a deploy runs, 30 s otherwise | Poll intervals; `0` disables polling. |

The app's transport must implement `postBlob` (the export) and `postSse` (the assistant stream) of `PlatformApiClient`; without them the export and the assistant report an error instead of failing silently.

### Theme tokens

Colours that carry meaning come from `palette.status.{ok,warn,crit,info,neutral}` and chart series from `palette.chart.series` (the token contract, shipped here with its MUI module augmentation). `withTelemetryTokens(theme)` fills only the tokens the app has not set, from the theme's own palette, and returns a copy: `ok` = `success.main`, `warn` = `warning.main`, `crit` = `error.main`, `info` = `info.main`, `neutral` = `grey[500]`, `chart.series` = the `.main` of `primary`, `secondary`, `warning`, `success`, `error`, `info`, then `grey[500]`, `text.primary`. Series colours are never used for status, and status colours never as a series. An app value always wins:

```ts
createTheme({ palette: { status: { crit: '#b00020' }, chart: { series: ['#0057b8', '#ffd700'] } } });
```

EvoPath mapping: set `palette.chart.series` from its `theme/chartPalette.ts` series (what its `MetricSeriesChart`, `ApiTimelineChart` and `LogSeverityChart` copies read through `useChartSeries()`) and map its `palette.outline` to `palette.status.neutral`. Its identical `PaletteChart` augmentation merges with this slice's.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `withTelemetryTokens` | theme-token | `withTelemetryTokens(theme: Theme): Theme` | Give the app's themes the telemetry tokens, keeping any the app set | experimental | [example](../../../../apps/web/src/theme/index.ts) |
| `TelemetryStatusTokens` | theme-token | `{ ok; warn; crit; info; neutral }` (`palette.status`) | Restyle what a value means (5xx, error logs, down) | experimental | [example](../../../../apps/web/src/__tests__/theme/telemetryTokens.test.ts) |
| `TelemetryChartTokens` | theme-token | `{ series: string[] }` (`palette.chart`) | Restyle chart series colours | experimental | [example](../../../../apps/web/src/__tests__/theme/telemetryTokens.test.ts) |
| `TelemetryWebAdapters` | option | `{ useAiEnabled(); useAssistantModels(); Spinner? }` | Hand the pages the app's AI switch, model catalogue and spinner | experimental | [example](../../../../apps/web/src/platform/telemetryAdapters.ts) |
| `TelemetryWebAdaptersProvider` | component | `TelemetryWebAdaptersProvider(props: { adapters; children }): ReactElement` | Mount the app's adapters once, next to the `TelemetryConfigProvider` | experimental | [example](../../../../apps/web/src/App.tsx) |
| `telemetryAdminCards` | component | `readonly TelemetryAdminCard[]` | Place the three Observability cards in the app's admin registry | experimental | [example](../../../../apps/web/src/config/adminSections.tsx) |
| `TelemetrySettingsPage` | component | `TelemetrySettingsPage(props?: { slots?: PageSlotsBase }): ReactElement` | Route `/admin/settings/telemetry`; add a banner or a section through the page-slot contract | experimental | [example](../../../../apps/web/src/App.tsx) |
| `TelemetryExplorerPage` | component | `TelemetryExplorerPage(props?: { slots?: PageSlotsBase; starterQueries?: readonly StarterQuery[] }): ReactElement` | Route `/admin/settings/telemetry/explorer`; offer the app's own starter queries beside (or instead of) the platform's | experimental | [example](../../../../apps/web/src/__tests__/examples/telemetry/starter-queries.test.tsx) |
| `TelemetryDashboardPage` | component | `TelemetryDashboardPage(props?: { slots?: PageSlotsBase }): ReactElement` | Route `/admin/settings/telemetry/dashboard`; add a banner or an app section through the page-slot contract | experimental | [example](../../../../apps/web/src/App.tsx) |
| `registerDashboardPanelView` | registry | `registerDashboardPanelView<Payload>(id: string, View: ComponentType<DashboardPanelViewProps<Payload>>, options?: { frame?: 'page' \| 'self' }): void` | Draw the card of a panel the API registered with `registerDashboardPanel`: the view gets the payload, the window and the layout, never an API client. Call it at boot, from a module the entry point imports (`/telemetry/ui/dashboard-panels` carries no page) | experimental | [example](../../../../apps/web/src/platform-extensions/telemetry/SignupsPanelView.example.tsx) |
| `DashboardPanelViewProps` | component | `{ panel; payload; query; tick; layout; spanMs; host }` | Type the props of a panel view | experimental | [example](../../../../apps/web/src/platform-extensions/telemetry/SignupsPanelView.example.tsx) |
| `dashboardPanelViews` | registry | `dashboardPanelViews(): RegisteredDashboardPanelView[]` | Read the registered views (the platform's `api` and `logs` through the same call), or isolate one in a test | experimental | [example](../../../../apps/web/src/__tests__/examples/telemetry/signups-panel.test.tsx) |
| `MetricUnitFormatsContext` | hook | `Context<MetricUnitFormats>`; `metricUnitFormatsOf(groups)` builds the value | Format a value in an app unit the API served with `/metric-groups` (`useMetricUnitFormats()` reads it) | experimental | [example](../../../../apps/web/src/__tests__/examples/telemetry/activity-group.test.tsx) |

Each page subpath (`/telemetry/ui/settings-page`, `/explorer-page`, `/dashboard-page`) re-exports its page as `default` and by name, for `lazy(() => import(...))` in a chunk of its own.

A metric group's `presentation` and its app units reach the page with `GET dashboard/metric-groups`: the page draws the tiles, charts and tables the presentation names, in its order, with its theme colours, its Top N and its computed ratio columns, and formats a value in an app unit from the descriptor served with the group. Nothing is registered in the browser for a group; a platform group without a served presentation draws its own, with the DOM it always had.

Supporting exports. `/telemetry/headless`: the wire types and display constants of the two services (`TelemetryPublicConfig`, `TelemetryAdminConfig`, `TelemetryConnection*`, `TelemetryStore*`, `TelemetryStack*`, `TelemetryQueryResult`, `TelemetrySchema*`, `TelemetryAssistant*`, `Dashboard*`, `TELEMETRY_EXPORT_*`, `DASHBOARD_*`, ...) and their pure helpers (`dashboardSearchParams`, `sqlList`, `telemetryErrorReason`, `filenameFromContentDisposition`, `downloadBlob`, ...); `createTelemetryClient`, `useTelemetryClient`, `TelemetryClient`; `TelemetryConfigProvider`, `TelemetryConfigContext`, `useTelemetryConfig`, `useTelemetryFeatures`, `isTelemetryOn`, `TELEMETRY_CONFIG_DISABLED`; `RequireTelemetryEnabled`; `TelemetryWebAdaptersProvider`, `useTelemetryWebAdapters`, `DEFAULT_TELEMETRY_WEB_ADAPTERS`; the hooks `useTelemetryAdmin`, `useTelemetryConnection`, `useTelemetryStore`, `useTelemetryStack`, `useTelemetrySchema`, `useTelemetryQuery`, `useTelemetryAssistant`, `useTelemetryAssistantAvailable`, `useTelemetryAssistantModel`, `useDashboard*`; `telemetryTokens`, `useTelemetryTokens`, `TelemetryTokens`; `formatBytes`, `formatDuration`, the three route paths, `explorerSqlUrl`, `METRIC_SECTION_TITLES`, `metricSectionTitle`, `STARTER_QUERIES`, `traceQuery`, `QUERY_HISTORY_KEY`; `DashboardPanelMeta`, `DashboardPanelData`, `useDashboardPanels`, `useDashboardPanel`, `MetricUnitFormats`, `MetricUnitFormatsContext`, `metricUnitFormatsOf`, `useMetricUnitFormats`, `formatMetricValue`. `/telemetry/ui`: `TelemetryAdminCard`, the three page prop and slot types, and the panel-view registry. `/telemetry/ui/dashboard-panels`: the panel-view registry alone (`registerDashboardPanelView`, `getDashboardPanelView`, `dashboardPanelViews`, `DashboardPanelViewProps`).

## Data

None. The slice owns no table; the explorer's query history (`telemetry-explorer:history`) and table top-N choices are per-browser `localStorage` conveniences, and everything else is read through the host's transport.

## Permissions and settings

The cards and routes use the exact strings the telemetry controllers enforce: `Telemetry` requires `telemetry:read` (saving needs `telemetry:write`, gated inside the page) and has no `feature`, because it is where telemetry is switched on; `Telemetry Explorer` and `Telemetry Dashboard` require `telemetry:query` and `feature: 'telemetry'` (a store deployed and collection on). Inside the settings page the model picker needs `ai_config:read` and the services section `system_settings:read` (`system_settings:write` to deploy). The assistant shows only for `ai:use` while AI and the assistant are on (`useTelemetryAssistantAvailable`). All of these only hide controls; the API enforces each.

## UI

Three pages under `/admin/settings/telemetry`, contributed as three admin registry cards in the Observability section (icons `InsightsOutlined`, `TerminalOutlined`, `MonitorHeartOutlined`). Each page takes `slots` of the page-slot contract (`Header`, `BeforeContent`, `Sections`, `AfterContent`; [core README](../core/README.md)), and the explorer a `starterQueries` prop. The dashboard's two headline panels (`api`, `logs`) are views of the same panel-view registry an app uses, so the page draws a registered panel the API lists in the same frame, after the events feed and before the metric sections. The settings page's store-specific part follows the deployment's store (`GET /admin/telemetry/config` names it): for the built-in `greptime` it is the Telemetry services section and the Connection form, DOM-identical to before pluggable stores (`test/telemetry/TelemetrySettingsPage.builtin-dom.test.tsx` holds the snapshot, recorded from the page as it was); for any other registered store it is one Store section, the settings slice's `PluggableConfigForm` over the store's descriptor, saved with `If-Match`, with the store's secrets write-only. Theme tokens `palette.status.*` and `palette.chart.series` (see Configuration). Components stay internal to the slice until a consumer needs one.

## Infra

None. The telemetry stack's compose fragments and collector config are `@marinoscar/platform-infra/telemetry`.

## Observability

None. The pages log and emit nothing; the API traces, logs and audits every telemetry route (`dashboard` reads as `telemetry:dashboard`, statements as `telemetry:query`).

## Security notes

The browser never sees a GreptimeDB or AI key: connection passwords and a registered store's secrets are write-only (sent, never read back; a secret nobody retyped is not sent), the assistant streams from the API, and exports are fetched through the app's authenticated transport. SQL typed in the explorer is sent verbatim and the API's guard decides whether it runs. Error messages are shown as text. A panel view receives data only (`payload`, the window and the layout), never an API client, and its payload is bounded by the API. A group's presentation is data: the browser maps a colour token to the theme and a unit to one of a fixed set of formats, and evaluates nothing the API sent.

## Conformance suite

The web half of the telemetry conformance suite is **check 7, permission parity**, run in the app's web test suite ([`telemetryParity.test.ts`](../../../../apps/web/src/__tests__/config/telemetryParity.test.ts), `npm run test:run --workspace=web`): every `telemetryAdminCards[i].permission` is one of `telemetry:read`, `telemetry:write`, `telemetry:query` or `system_settings:read`; each card is registered once in the admin hub; and its path is a route of `App.tsx` gated on the same permission. The check is a pure function exercised first against broken fixtures (an invented permission, a missing or duplicated route, a route gated differently). The API half (checks 1 to 6) is `runPlatformConformance({ suites: { telemetry } })` ([API README](../../../platform-api/src/telemetry/README.md#conformance-suite)). The package's own `test/telemetry/` covers the slice with `createTestPlatformHost`, and the reference app's `apps/web/src/__tests__/config/platformPages.test.ts` checks card and route registration.

## Upgrade notes

1.0: first release; moved from the app with no change to behaviour, texts, test ids or colours. Delete the app's own copies, import from the two entries, pass `api` to `TelemetryConfigProvider` when it sits above the platform host, mount `TelemetryWebAdaptersProvider`, and add `postBlob` and `postSse` to the app's `PlatformApiClient`. Service functions became methods of `TelemetryClient` with the same names.

| Old app path (`apps/web/src/`) | Import from `@marinoscar/platform-web` |
|---|---|
| `services/telemetry.ts`, `services/telemetryDashboard.ts` | `/telemetry/headless`: `createTelemetryClient`, `useTelemetryClient` |
| `hooks/useTelemetry*.ts` | `/telemetry/headless`: `useTelemetryAdmin`, `useTelemetryConnection`, `useTelemetryStack`, `useTelemetryQuery`, `useDashboard*`, ... |
| `contexts/TelemetryConfigContext.tsx`, `hooks/useTelemetryConfig.ts` | `/telemetry/headless`: `TelemetryConfigProvider`, `useTelemetryConfig` |
| `components/common/RequireTelemetryEnabled.tsx` | `/telemetry/headless`: `RequireTelemetryEnabled` |
| `theme/telemetryTokens.ts`, `theme/augment.ts` | `/telemetry/headless`: `withTelemetryTokens`, `TelemetryTokens` |
| `components/telemetry/**` | `/telemetry/ui` (internal components stay internal) |
| `pages/Admin/TelemetrySettingsPage.tsx`, `TelemetryExplorerPage.tsx`, `TelemetryDashboardPage.tsx` | `/telemetry/ui/settings-page`, `/explorer-page`, `/dashboard-page` (or `TelemetrySettingsPage` ... from `/telemetry/ui`) |
| The three telemetry entries of `config/adminSections.tsx` | `telemetryAdminCards` from `/telemetry/ui` |

## Troubleshooting

Operator problems (a dashboard with no data, a section named "not collected") are in the [telemetry runbook](../../../../docs/runbooks/telemetry.md#12-troubleshooting); developer problems:

| Symptom | Cause and fix |
|---|---|
| `usePlatformHost: no PlatformHostProvider above this component` | Mount `PlatformHostProvider` (from `/core`) around the routes, and in test wrappers. |
| Telemetry routes bounce home although it is on | `TelemetryConfigProvider` above the host was given no `api`; pass the app's transport. |
| The assistant never shows | The adapters are missing (AI reads as off) or the viewer lacks `ai:use`. |
| "The platform host transport has no postBlob / postSse" | The app's `PlatformApiClient` lacks the member; add it (the reference app's `apps/web/src/platform/platformHost.tsx`). |
| A registered panel is listed by the API but not drawn | No view is registered for its id; call `registerDashboardPanelView` at boot, from a module the entry point imports (a bare `import` of a side-effect-free package entry is dropped by the bundler). |
| A tile shows a raw number for an app unit | The group's `units` were not read: render the dashboard page, which provides `MetricUnitFormatsContext`, or provide it from `metricUnitFormatsOf(groups)` in a test. |
| All three pages land in one chunk | Lazy-load each from its page subpath, not from `/telemetry/ui`. |

## Links

- Spec: [docs/specs/telemetry.md](../../../../docs/specs/telemetry.md) and [packaging](../../../../docs/specs/telemetry.md#12-packaging-and-extension-points); runbook: [docs/runbooks/telemetry.md](../../../../docs/runbooks/telemetry.md).
- Platform packages spec: [documentation standard and extension contract](../../../../docs/specs/platform-packages.md).
- Wire contract: [`@marinoscar/platform-contract/telemetry`](../../../platform-contract/src/telemetry/README.md).
- Hosting and registration: [core README](../core/README.md).
- Package README: [platform-web](../../README.md).
